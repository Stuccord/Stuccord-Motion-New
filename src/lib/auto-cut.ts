// Auto-cut: finds the pauses in a clip's sound so they can be cut out.
//
// Works on the clip's waveform (loudness every 50 ms, the one the timeline
// draws), so nothing new is downloaded when it's already on screen. A pause
// is a stretch quieter than the clip's speech by a preset amount, at least
// the preset's length; a little of it is kept on each side so words aren't
// clipped. All times are in ms into the clip's file.

import type { Waveform } from "@/lib/clip-strips";

export type PausePreset = "gentle" | "normal" | "tight";

export const PAUSE_PRESETS: Record<
  PausePreset,
  { label: string; hint: string; minPauseMs: number; padMs: number; dropDb: number }
> = {
  gentle: {
    label: "Gentle",
    hint: "Cuts pauses over 1 s, keeps plenty of breathing room",
    minPauseMs: 1000,
    padMs: 250,
    dropDb: 18,
  },
  normal: {
    label: "Normal",
    hint: "Cuts pauses over 0.6 s",
    minPauseMs: 600,
    padMs: 150,
    dropDb: 20,
  },
  tight: {
    label: "Tight",
    hint: "Cuts pauses over 0.35 s, for fast-paced videos",
    minPauseMs: 350,
    padMs: 80,
    dropDb: 22,
  },
};

export type Range = { fromMs: number; toMs: number };

/** Pieces shorter than this are cut too (a blip between two pauses). */
const MIN_KEEP_MS = 200;
/** A loud blip this short inside a pause (a click, a breath) doesn't end it. */
const BLIP_MS = 100;
/** Speech quieter than this (dBFS of the loudest moment) means no speech at all. */
const NO_SPEECH_DB = -45;

const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-5));

/**
 * The pauses to cut inside `range` (the clip's visible part of its file),
 * already shrunk by the padding. Empty when there's nothing to cut, the clip
 * has no sound, or it's all quiet.
 */
export function findPauses(wave: Waveform, range: Range, preset: PausePreset): Range[] {
  const { minPauseMs, padMs, dropDb } = PAUSE_PRESETS[preset];
  const b = wave.bucketMs;
  const first = Math.max(0, Math.floor(range.fromMs / b));
  const last = Math.min(wave.peaks.length, Math.ceil(range.toMs / b));
  if (last - first < 2) return [];

  // How loud speech is in this clip: most buckets with speech are near it.
  const levels: number[] = [];
  for (let i = first; i < last; i++) levels.push(toDb(wave.peaks[i]));
  const sorted = [...levels].sort((x, y) => x - y);
  const speechDb = sorted[Math.floor(sorted.length * 0.9)];
  if (speechDb < NO_SPEECH_DB) return [];
  const threshold = speechDb - dropDb;

  const quiet = levels.map((db) => db < threshold);
  // Short loud blips inside quiet stretches count as quiet.
  const blip = Math.max(1, Math.round(BLIP_MS / b));
  for (let i = 0; i < quiet.length;) {
    if (quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < quiet.length && !quiet[j]) j++;
    if (i > 0 && j < quiet.length && j - i <= blip) for (let k = i; k < j; k++) quiet[k] = true;
    i = j;
  }

  const out: Range[] = [];
  for (let i = 0; i < quiet.length;) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < quiet.length && quiet[j]) j++;
    const from = Math.max(range.fromMs, (first + i) * b);
    const to = Math.min(range.toMs, (first + j) * b);
    if (to - from >= minPauseMs) {
      // Padding only on the side next to speech (none at the clip's ends).
      const cutFrom = from <= range.fromMs ? range.fromMs : from + padMs;
      const cutTo = to >= range.toMs ? range.toMs : to - padMs;
      if (cutTo - cutFrom >= 100)
        out.push({ fromMs: Math.round(cutFrom), toMs: Math.round(cutTo) });
    }
    i = j;
  }
  return out;
}

/**
 * What's left of `range` once the pauses are cut, as the pieces to keep (in
 * order). Pieces too short to be useful are cut as well. Null when there's
 * nothing left (the clip would disappear) or nothing to cut.
 */
export function keepRanges(range: Range, pauses: Range[]): Range[] | null {
  if (pauses.length === 0) return null;
  const keep: Range[] = [];
  let at = range.fromMs;
  for (const p of [...pauses].sort((x, y) => x.fromMs - y.fromMs)) {
    if (p.fromMs - at >= MIN_KEEP_MS) keep.push({ fromMs: at, toMs: p.fromMs });
    at = Math.max(at, p.toMs);
  }
  if (range.toMs - at >= MIN_KEEP_MS) keep.push({ fromMs: at, toMs: range.toMs });
  return keep.length > 0 ? keep : null;
}

/** Total length of some ranges, in ms. */
export const totalMs = (ranges: Range[]) => ranges.reduce((s, r) => s + (r.toMs - r.fromMs), 0);
