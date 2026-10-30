// Music and SFX for the live timeline preview, played along with the
// timeline player's clock and mixed like the cloud export
// (render-worker/server.js: buildAudioMixArgs): the music where the A2 row
// shows it, at the Music volume, quieter while the voice is on, faded in at
// the start and out at the end; each SFX once at its time (or just before
// each cut). Voiceovers (the VO track) play at their time whatever the
// Music switch says, with the music quieter under them. Motion Explainer sounds
// play at their times whatever the Music switch says (they have their own);
// its built-in music beds play, like music, only with the switch on and only
// when no song has been added.

import { useCallback, useEffect, useRef } from "react";
import { musicBars, sfxPlays, voiceoverSpans } from "@/lib/timeline-layout";
import type { ClipRow } from "./types";

// The export's levels: music at volume/100 × 0.5 of the voice, SFX at 0.8,
// and roughly an 8 dB dip under speech.
const MUSIC_MAX = 0.5;
const SFX_GAIN = 0.8;
const DUCK = 0.4;
const FADE_IN_MS = 1000;
const FADE_OUT_MS = 1500;
const SFX_LEAD_MS = 150;
// How far a song may drift from the playhead before it's moved back.
const MAX_DRIFT_S = 0.3;

type Options = {
  /** Music and SFX clips (A2). */
  audioClips: ClipRow[];
  /** Voiceover clips (VO): each plays once from where it's placed. */
  voiceClips?: ClipRow[];
  /** Signed links to the files, by storage path. */
  urls: Record<string, string>;
  lengthMs: (clip: ClipRow) => number;
  /** Where the video ends (ms): the music stops there. */
  endMs: number;
  /** Where each cut is (ms), for SFX that play on cuts. */
  cutsMs: number[];
  /** The Music switch: off silences music and SFX, like the export. */
  enabled: boolean;
  /** 0-100, the Music volume slider. */
  volume: number;
  muted: boolean;
  /** Whether the voice (a main-track video) is on at a time, for ducking. */
  voiceAt: (timeMs: number) => boolean;
  /**
   * Motion Explainer sounds (each once at its time) and built-in music beds
   * (looped over their stretches, when there are no songs). A ref, since the
   * editor works them out after this hook runs; read on every tick.
   */
  auto?: { current: AutoAudio };
};

export type AutoAudio = {
  sfx: { key: string; url: string; atMs: number; gain: number }[];
  music: { key: string; url: string; startMs: number; endMs: number }[];
};

/** The built-in beds are 32 s loops (render-worker/make-sounds.mjs). */
const BED_LOOP_S = 32;

/** Returns the player's tick handler, which keeps the music and SFX in step. */
export function usePreviewAudio(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const lastTick = useRef<{ t: number; playing: boolean }>({ t: 0, playing: false });
  const duckLevel = useRef(1);

  /** One audio element per file, made as needed. */
  const audioFor = (clip: ClipRow) => {
    const url = latest.current.urls[clip.storage_path];
    if (!url) return null;
    let el = elements.current.get(clip.id);
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      elements.current.set(clip.id, el);
    }
    if (el.src !== url) el.src = url;
    return el;
  };

  /** One audio element per built-in sound (by key), made as needed. */
  const audioForUrl = (key: string, url: string) => {
    let el = elements.current.get(key);
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      elements.current.set(key, el);
    }
    if (el.src !== new URL(url, location.href).href) el.src = url;
    return el;
  };

  const stopAll = () => {
    for (const el of elements.current.values()) if (!el.paused) el.pause();
  };

  // Stable: it reads everything through refs.
  const onTick = useCallback((t: number, playing: boolean, rate: number) => {
    const o = latest.current;
    const prev = lastTick.current;
    lastTick.current = { t, playing };
    if (!playing) {
      stopAll();
      return;
    }

    // Voiceovers: the part under the playhead, at full volume.
    const vo = voiceoverSpans(o.voiceClips ?? [], o.lengthMs);
    for (const span of vo) {
      const el = elements.current.get(span.clip.id);
      if (t < span.startMs || t >= span.endMs) {
        if (el && !el.paused) el.pause();
        continue;
      }
      const audio = audioFor(span.clip);
      if (!audio) continue;
      const want = ((span.clip.trim_in_ms ?? 0) + (t - span.startMs)) / 1000;
      audio.muted = o.muted;
      audio.volume = 1;
      audio.playbackRate = rate;
      if (Math.abs(audio.currentTime - want) > MAX_DRIFT_S) audio.currentTime = want;
      if (audio.paused) audio.play().catch(() => {});
    }
    // Motion Explainer sounds: start each one whose time the playhead just
    // passed (only while playing on, not when jumping around).
    const steppedOn = prev.playing && t > prev.t && t - prev.t < 500;
    if (steppedOn) {
      for (const s of o.auto?.current.sfx ?? []) {
        if (s.atMs > prev.t && s.atMs <= t) {
          const audio = audioForUrl(`sfx:${s.key}`, s.url);
          audio.muted = o.muted;
          audio.volume = Math.min(1, Math.max(0, s.gain));
          audio.playbackRate = rate;
          audio.currentTime = Math.max(0, (t - s.atMs) / 1000);
          audio.play().catch(() => {});
        }
      }
    }

    if (!o.enabled) {
      for (const m of o.auto?.current.music ?? []) {
        const el = elements.current.get(`bed:${m.key}`);
        if (el && !el.paused) el.pause();
      }
      for (const c of o.audioClips) {
        const el = elements.current.get(c.id);
        if (el && !el.paused) el.pause();
      }
      return;
    }
    const voiceoverOn = vo.some((s) => t >= s.startMs && t < s.endMs);

    const songs = o.audioClips.filter((c) => c.role !== "sfx");
    const sfx = o.audioClips.filter((c) => c.role === "sfx");

    // Music: the piece of song at the playhead, at the right point in it.
    const bars = musicBars(songs, o.lengthMs, o.endMs);
    const bar = bars.find((b) => t >= b.startMs && t < b.startMs + b.lengthMs);
    // Duck under the voice, easing so it doesn't jump.
    const duckTarget = o.voiceAt(t) || voiceoverOn ? DUCK : 1;
    duckLevel.current += (duckTarget - duckLevel.current) * 0.15;
    const fade = Math.min(1, t / FADE_IN_MS, Math.max(0, o.endMs - t) / FADE_OUT_MS);
    const musicVolume =
      (Math.min(100, Math.max(0, o.volume)) / 100) * MUSIC_MAX * duckLevel.current * fade;
    // The built-in beds, only when no song was added.
    for (const m of o.auto?.current.music ?? []) {
      const el = elements.current.get(`bed:${m.key}`);
      if (songs.length || t < m.startMs || t >= m.endMs) {
        if (el && !el.paused) el.pause();
        continue;
      }
      const audio = audioForUrl(`bed:${m.key}`, m.url);
      audio.loop = true;
      const want = ((t - m.startMs) / 1000) % BED_LOOP_S;
      audio.muted = o.muted;
      audio.volume = Math.min(1, Math.max(0, musicVolume));
      audio.playbackRate = rate;
      if (Math.abs(audio.currentTime - want) > MAX_DRIFT_S) audio.currentTime = want;
      if (audio.paused) audio.play().catch(() => {});
    }

    for (const song of songs) {
      const el = elements.current.get(song.id);
      if (!bar || bar.clip.id !== song.id) {
        if (el && !el.paused) el.pause();
        continue;
      }
      const audio = audioFor(song);
      if (!audio) continue;
      const want = (t - bar.startMs) / 1000;
      audio.muted = o.muted;
      audio.volume = Math.min(1, Math.max(0, musicVolume));
      audio.playbackRate = rate;
      if (Math.abs(audio.currentTime - want) > MAX_DRIFT_S) audio.currentTime = want;
      if (audio.paused) audio.play().catch(() => {});
    }

    // SFX: start each one whose time the playhead just passed (only while
    // playing on, not when jumping around).
    const stepped = prev.playing && t > prev.t && t - prev.t < 500;
    if (stepped) {
      for (const p of sfxPlays(sfx, o.cutsMs)) {
        const at = p.onCut ? p.atMs - SFX_LEAD_MS : p.atMs;
        if (at > prev.t && at <= t) {
          const audio = audioFor(p.clip);
          if (!audio) continue;
          audio.muted = o.muted;
          audio.volume = SFX_GAIN;
          audio.playbackRate = rate;
          audio.currentTime = Math.max(0, (t - at) / 1000);
          audio.play().catch(() => {});
        }
      }
    }
  }, []);

  // Mute and the Music switch apply straight away, even while paused (the
  // next frame starts any voiceover again).
  useEffect(() => {
    for (const el of elements.current.values()) el.muted = options.muted;
    if (!options.enabled) stopAll();
  }, [options.muted, options.enabled]);

  // Silence everything when the editor closes.
  useEffect(
    () => () => {
      for (const el of elements.current.values()) {
        el.pause();
        el.removeAttribute("src");
      }
      elements.current.clear();
    },
    [],
  );

  return onTick;
}
