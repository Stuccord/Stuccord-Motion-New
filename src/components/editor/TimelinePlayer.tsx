// Plays the timeline itself, without rendering: the main track (A-roll, or
// B-roll when there's no A-roll) with its trims and gaps, B-roll and images
// on top at their times, each fitted to the frame like the exports (whole,
// over a blurred copy, when its shape differs) and images slowly zooming.
//
// It acts like a <video> element to the editor (play, pause, currentTime,
// duration, playbackRate, paused, ended), so the transport, the timeline
// playhead and the keyboard shortcuts drive it the same way.

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { IMAGE_ZOOM, isImageFilename } from "@/lib/media-kind";
import { layoutTrack } from "@/lib/timeline-layout";
import { parseTransform, transformedBox, type ClipTransform } from "@/lib/clip-transform";
import { TransformBox, type BoxTarget } from "./TransformBox";
import { loadPersonSegmenter, type PersonSegmenter } from "@/lib/person-segmenter";
import { BEHIND_BLUR, BEHIND_DARKEN } from "@/motion/cutout";
import { useLocalClips } from "@/lib/clip-download";
import type { ClipRow } from "./types";
import { isFootagePreviewUrl } from "@/lib/footage-preview";
import type { PreviewCutout } from "@/lib/cutout-preview";

/** What the editor can do with the player (a subset of HTMLVideoElement). */
export type TimelinePlayerHandle = {
  readonly paused: boolean;
  readonly ended: boolean;
  currentTime: number;
  readonly duration: number;
  playbackRate: number;
  play: () => Promise<void>;
  pause: () => void;
};

type Props = {
  aRoll: ClipRow[];
  bRoll: ClipRow[];
  /** Signed links to the clips' files, by storage path. */
  urls: Record<string, string>;
  /** A clip's length on the timeline (ms). */
  lengthMs: (clip: ClipRow) => number;
  /** The frame's shape (width / height). */
  frameRatio: number;
  muted: boolean;
  /** Whether the clips' own sound is lowered at a time (under a voiceover). */
  duckAt?: (timeMs: number) => boolean;
  /** The playhead moved (seconds); called a few times a second while playing. */
  onTime?: (seconds: number) => void;
  /** The length of the edit (seconds), when it's known or changes. */
  onDuration?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Every frame while playing and after each seek (for music and SFX). */
  onTick?: (timeMs: number, playing: boolean, rate: number) => void;
  /** Drawn over the picture at the current time (captions, hook). */
  renderOverlay?: (timeMs: number) => React.ReactNode;
  /** How much the picture (not the overlay) is zoomed in at a time; 1 or none: not zoomed. */
  pictureScale?: (timeMs: number) => number;
  /**
   * How far the picture moves aside at a time (fractions of the frame), for
   * a Notes page beside the speaker; null or none: not moved.
   */
  pictureShift?: (timeMs: number) => { x: number; y: number } | null;
  /** The point (0-1) the picture zooms around: the speaker, or the upper middle. */
  pictureOrigin?: { x: number; y: number };
  /** The look's colour grade on the footage (a CSS filter), if it has one. */
  pictureFilter?: string;
  /**
   * Graphics behind the speaker: how far in a time is (0 none, 1 full: the
   * room darkened and blurred, the speaker cut out in front), and what's
   * drawn between the room and the speaker.
   */
  behindAt?: (timeMs: number) => number;
  renderBehind?: (timeMs: number) => React.ReactNode;
  /**
   * The worker's cut-outs of the speaker (cutout-preview.ts), by storage
   * path: shown instead of the browser's own where there's one.
   */
  cutouts?: Record<string, PreviewCutout[]>;
  /**
   * A clip's file stopped downloading: get a fresh link for it (by storage
   * path). True: a fresh link is on its way.
   */
  onStall?: (storagePath: string) => boolean;
  /** The selected clip: gets a box with handles when it's on screen. */
  selectedClipId?: string | null;
  /** A clip was pressed in the picture. */
  onSelectClip?: (id: string) => void;
  /** A clip was moved, resized or rotated (null: back to its default fit). */
  onTransform?: (id: string, transform: ClipTransform | null) => void;
};

type Placed = { clip: ClipRow; start: number; end: number; track: "main" | "over" };

const isImage = (c: ClipRow) => isImageFilename(c.filename);

export const TimelinePlayer = forwardRef<TimelinePlayerHandle, Props>(function TimelinePlayer(
  {
    aRoll,
    bRoll,
    urls,
    lengthMs,
    frameRatio,
    muted,
    duckAt,
    onTime,
    onDuration,
    onPlayingChange,
    onTick,
    renderOverlay,
    pictureScale,
    pictureShift,
    pictureOrigin,
    pictureFilter,
    behindAt,
    renderBehind,
    cutouts,
    onStall,
    selectedClipId = null,
    onSelectClip,
    onTransform,
  },
  ref,
) {
  // The tracks as the export plays them: the main track, and B-roll on top.
  // Laid out again only when a clip's place, length, file or transform
  // changes (the editor hands over new arrays on every render).
  const layoutKey = JSON.stringify(
    [aRoll, bRoll].map((list) =>
      list.map((c) => [
        c.id,
        c.start_ms ?? null,
        lengthMs(c),
        c.storage_path,
        c.filename,
        c.transform ?? null,
      ]),
    ),
  );
  const placed = useMemo(() => {
    const main = aRoll.length > 0 ? aRoll : bRoll;
    const over = aRoll.length > 0 ? bRoll : [];
    const place = (clips: ClipRow[], track: Placed["track"]) => {
      const { starts } = layoutTrack(clips, lengthMs);
      return clips.map((clip) => {
        const start = starts.get(clip.id) ?? 0;
        return { clip, start, end: start + lengthMs(clip), track };
      });
    };
    return { main: place(main, "main"), over: place(over, "over") };
    // layoutKey stands for aRoll, bRoll and lengthMs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);
  // The main track's end, and the video's: it runs until the last clip on
  // either track ends (B-roll past the main track plays on, with its sound).
  const mainEndMs = placed.main.length ? placed.main[placed.main.length - 1].end : 0;
  const endMs = Math.max(
    mainEndMs,
    placed.over.length ? placed.over[placed.over.length - 1].end : 0,
  );

  // The playhead (ms): a ref for the clock, state for drawing.
  const timeRef = useRef(0);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const endedRef = useRef(false);
  const rateRef = useRef(1);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  // The saved cut-outs' videos, by link: kept loaded between stretches so
  // one is ready the moment its stretch starts.
  const cutoutVideos = useRef(new Map<string, HTMLVideoElement>());
  const cutoutLinks = Object.values(cutouts ?? {})
    .flat()
    .map((c) => c.url)
    .sort()
    .join(" ");
  useEffect(() => {
    const want = new Set(cutoutLinks ? cutoutLinks.split(" ") : []);
    const have = cutoutVideos.current;
    for (const [url, el] of have) {
      if (want.has(url)) continue;
      el.pause();
      el.removeAttribute("src");
      el.load();
      have.delete(url);
    }
    for (const url of want) {
      if (have.has(url)) continue;
      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.src = url;
      have.set(url, el);
    }
  }, [cutoutLinks]);
  useEffect(
    () => () => {
      for (const el of cutoutVideos.current.values()) {
        el.pause();
        el.removeAttribute("src");
      }
      cutoutVideos.current.clear();
    },
    [],
  );

  // Latest values for the stable handle and the clock.
  const latest = useRef({
    placed,
    endMs,
    mainEndMs,
    muted,
    duckAt,
    onTime,
    onPlayingChange,
    onTick,
  });
  latest.current = { placed, endMs, mainEndMs, muted, duckAt, onTime, onPlayingChange, onTick };

  const activeAt = (list: Placed[], t: number) => list.find((p) => t >= p.start && t < p.end);
  const findPlaced = (id: string) =>
    latest.current.placed.main.find((p) => p.clip.id === id) ??
    latest.current.placed.over.find((p) => p.clip.id === id);

  /** Puts every loaded video where it should be for time `time`. */
  const sync = useCallback((time: number) => {
    // At the very end, the last frame stays on screen.
    const t = Math.min(time, Math.max(0, latest.current.endMs - 1));
    // Under a voiceover the clips are quieter, like the export (about 10 dB).
    const volume = latest.current.duckAt?.(t) ? 0.32 : 1;
    for (const [id, el] of videos.current) {
      const p = findPlaced(id);
      if (!p) continue;
      const active = t >= p.start && t < p.end;
      const trimIn = (p.clip.trim_in_ms ?? 0) / 1000;
      const target = trimIn + Math.max(0, Math.min(t, p.end - 1) - p.start) / 1000;
      el.playbackRate = rateRef.current;
      // B-roll is silent over the main track, heard once the main track ends.
      el.muted = (p.track === "over" && t < latest.current.mainEndMs) || latest.current.muted;
      if (el.volume !== volume) el.volume = volume;
      if (active && playingRef.current) {
        if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        const want = active ? target : trimIn;
        if (Math.abs(el.currentTime - want) > 0.04) el.currentTime = want;
      }
    }
    // findPlaced reads `latest`.
  }, []);

  const lastReport = useRef(0);
  const report = useCallback((t: number, force = false) => {
    const now = performance.now();
    if (force || now - lastReport.current > 60) {
      lastReport.current = now;
      latest.current.onTime?.(t / 1000);
    }
    latest.current.onTick?.(t, playingRef.current, rateRef.current);
  }, []);

  const seek = useCallback(
    (ms: number) => {
      const t = Math.max(0, Math.min(latest.current.endMs, ms));
      timeRef.current = t;
      endedRef.current = false;
      setTimeMs(t);
      sync(t);
      report(t, true);
    },
    [sync, report],
  );

  const setPlayingBoth = (value: boolean) => {
    playingRef.current = value;
    setPlaying(value);
    latest.current.onPlayingChange?.(value);
  };

  useImperativeHandle(
    ref,
    () => ({
      get paused() {
        return !playingRef.current;
      },
      get ended() {
        return endedRef.current;
      },
      get currentTime() {
        return timeRef.current / 1000;
      },
      set currentTime(seconds: number) {
        seek(seconds * 1000);
      },
      get duration() {
        return latest.current.endMs / 1000;
      },
      get playbackRate() {
        return rateRef.current;
      },
      set playbackRate(rate: number) {
        rateRef.current = rate;
        sync(timeRef.current);
      },
      play: async () => {
        if (latest.current.endMs <= 0) return;
        if (timeRef.current >= latest.current.endMs - 30) seek(0);
        endedRef.current = false;
        setPlayingBoth(true);
        sync(timeRef.current);
      },
      pause: () => {
        setPlayingBoth(false);
        sync(timeRef.current);
        report(timeRef.current, true);
      },
    }),
    // The handle reads refs; it never needs replacing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The clock. While a main-track video plays, follow its own time (so the
  // picture and the voice stay together); in gaps and on images, wall time.
  // A video that is still loading holds the playhead.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const { placed: pl, endMs: end } = latest.current;
      let t = timeRef.current;
      const m = activeAt(pl.main, t);
      const el = m && !isImage(m.clip) ? videos.current.get(m.clip.id) : undefined;
      if (el && !el.paused && !el.ended && el.readyState >= 2) {
        const fromVideo = m!.start + (el.currentTime * 1000 - (m!.clip.trim_in_ms ?? 0));
        // Ignore a video that hasn't caught up with a seek yet.
        t = Math.abs(fromVideo - t) < 400 ? Math.max(t, fromVideo) : t + dt * rateRef.current;
      } else if (el && el.readyState < 2 && !el.ended && !el.error) {
        // Loading: wait for it. (One that can't play doesn't hold the playhead.)
      } else {
        t += dt * rateRef.current;
      }
      if (t >= end) {
        timeRef.current = end;
        endedRef.current = true;
        setTimeMs(end);
        setPlayingBoth(false);
        sync(end);
        report(end, true);
        return;
      }
      const crossed = (m && t >= m.end) || activeAt(pl.main, t) !== m;
      timeRef.current = t;
      setTimeMs(t);
      // Each frame: keep the videos in step (cheap when nothing changes).
      if (crossed || Math.floor(now / 250) !== Math.floor((now - dt) / 250)) sync(t);
      report(t);
      raf = requestAnimationFrame(tick);
    };
    sync(timeRef.current);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // sync and report are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // The edit's length changed: report it, keep the playhead inside it.
  useEffect(() => {
    onDuration?.(endMs / 1000);
    if (timeRef.current > endMs) seek(endMs);
    // onDuration is a prop callback; rerunning when it changes isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endMs]);
  // Clips moved or changed: put the videos where they now belong.
  useEffect(() => sync(timeRef.current), [placed, sync]);

  // Mute follows the speaker button.
  useEffect(() => sync(timeRef.current), [muted, sync]);

  // Stop everything when the player goes away.
  useEffect(
    () => () => {
      for (const el of videos.current.values()) el.pause();
    },
    [],
  );

  // On screen: the clip at the playhead on each track, plus the next one
  // (loaded but hidden) so the cut to it is quick.
  // At the very end, the last frame stays on screen.
  const t = Math.min(timeMs, Math.max(0, endMs - 1));
  const withNext = (list: Placed[]) => {
    const i = list.findIndex((p) => p.end > t);
    return i < 0 ? [] : list.slice(i, i + 2);
  };
  const layers = [...withNext(placed.main), ...withNext(placed.over)];
  const mainActive = activeAt(placed.main, t);

  // Every video file, downloaded once into memory: clips play from that copy
  // once it's in (no more internet for cuts and replays), from the link
  // meanwhile.
  const local = useLocalClips(
    [...placed.main, ...placed.over]
      .map((p) => p.clip)
      .filter((c) => !isImage(c))
      // A preview copy isn't the size saved with the clip (the original's).
      .map((c) => (isFootagePreviewUrl(urls[c.storage_path]) ? { ...c, size_bytes: null } : c)),
    urls,
    (path) => onStall?.(path),
    1,
  );
  const playUrl = (clip: ClipRow) =>
    (!isImage(clip) && local[clip.storage_path]?.url) || urls[clip.storage_path];

  // Each file's own size, for its box in the frame.
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  // The frame's height on screen (px), for the size of the room's blur.
  const frameEl = useRef<HTMLDivElement>(null);
  const [frameH, setFrameH] = useState(0);
  useEffect(() => {
    const el = frameEl.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setFrameH(el.clientHeight));
    ro.observe(el);
    setFrameH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  // A transform being dragged (shown, not saved yet), or just saved and not
  // back from the server yet.
  const [draft, setDraft] = useState<{ id: string; t: ClipTransform | null } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );
  const transformOf = (clip: ClipRow) =>
    draft?.id === clip.id ? draft.t : parseTransform(clip.transform);
  // The saved transform came back: stop showing the draft.
  const draftClip = draft
    ? [...placed.main, ...placed.over].find((p) => p.clip.id === draft.id)?.clip
    : undefined;
  const savedKey = JSON.stringify(parseTransform(draftClip?.transform));
  useEffect(() => {
    if (draft && JSON.stringify(draft.t) === savedKey) setDraft(null);
    // Only when the saved value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // The picture's zoom, and how far into a behind graphic this time is.
  const scale = pictureScale?.(t) ?? 1;
  const shift = pictureShift?.(t) ?? null;
  // Zoomed first, then moved aside (the export does the same, in that order).
  const zoomStyle: React.CSSProperties | undefined =
    scale !== 1 || shift
      ? {
          transform: `${shift ? `translate(${shift.x * 100}%, ${shift.y * 100}%) ` : ""}scale(${scale})`,
          transformOrigin: `${(pictureOrigin?.x ?? 0.5) * 100}% ${(pictureOrigin?.y ?? 0.4) * 100}%`,
        }
      : undefined;
  const behind = behindAt?.(t) ?? 0;

  // What the box can grab: the clips showing now, top-most first.
  const targets: BoxTarget[] = [activeAt(placed.over, t), mainActive]
    .filter((p): p is Placed => p != null && Boolean(urls[p.clip.storage_path]))
    .map((p) => {
      const size = sizes[p.clip.storage_path];
      const tr = transformOf(p.clip);
      const fitsDifferently =
        size != null && Math.abs(Math.log(size.w / size.h / frameRatio)) >= 0.03;
      return {
        id: p.clip.id,
        srcW: size?.w ?? 0,
        srcH: size?.h ?? 0,
        transform: tr,
        // An untransformed clip over its blurred copy covers the whole frame.
        fillsFrame: !tr && fitsDifferently,
      };
    });

  return (
    // The picture is clipped to the frame (with its rounded corners); the
    // handles aren't.
    <div className="absolute inset-0 rounded-[inherit]">
      <div ref={frameEl} className="absolute inset-0 bg-black overflow-hidden rounded-[inherit]">
        {/* The picture, zoomed when a Motion Explainer zoom is on (around the
            upper middle, where a face usually is), and darkened and blurred
            while a graphic is behind the speaker. */}
        <div
          className="absolute inset-0"
          style={{
            ...zoomStyle,
            filter:
              [
                pictureFilter,
                behind > 0
                  ? `blur(${(behind * BEHIND_BLUR * frameH).toFixed(2)}px) brightness(${(1 - behind * BEHIND_DARKEN).toFixed(3)})`
                  : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          }}
        >
          {layers.map((p) => {
            const active = t >= p.start && t < p.end;
            const url = playUrl(p.clip);
            if (!url) return null;
            const download = local[p.clip.storage_path];
            return (
              <Layer
                key={`${p.track}:${p.clip.id}`}
                placed={p}
                url={url}
                downloadProgress={download?.state === "downloading" ? download.progress : undefined}
                active={active}
                timeMs={t}
                frameRatio={frameRatio}
                transform={transformOf(p.clip)}
                videoRef={(el) => {
                  if (el) videos.current.set(p.clip.id, el);
                  else videos.current.delete(p.clip.id);
                }}
                onSize={(w, h) =>
                  setSizes((old) =>
                    old[p.clip.storage_path]?.w === w && old[p.clip.storage_path]?.h === h
                      ? old
                      : { ...old, [p.clip.storage_path]: { w, h } },
                  )
                }
                onReady={() => sync(timeRef.current)}
                onStall={() => onStall?.(p.clip.storage_path) ?? false}
              />
            );
          })}
        </div>
        {mainActive && !urls[mainActive.clip.storage_path] && (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-neutral-500">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </span>
          </div>
        )}
        {renderBehind?.(t)}
        {/* The speaker, cut out of each video showing, in front of what's
            behind them (the same places and zoom as the picture). */}
        {behind > 0 && (
          <div
            className="absolute inset-0 z-[8] pointer-events-none"
            style={{ ...zoomStyle, filter: pictureFilter }}
          >
            {layers.map((p) => {
              if (isImage(p.clip) || t < p.start || t >= p.end) return null;
              const look = layerLook(
                p,
                sizes[p.clip.storage_path] ?? null,
                transformOf(p.clip),
                frameRatio,
              );
              return (
                <CutoutLayer
                  key={`${p.track}:${p.clip.id}`}
                  getVideo={() => videos.current.get(p.clip.id) ?? null}
                  getCutout={(sec) => {
                    const ms = sec * 1000;
                    const c = cutouts?.[p.clip.storage_path]?.find(
                      (x) => ms >= x.fromMs && ms < x.toMs,
                    );
                    const el = c ? cutoutVideos.current.get(c.url) : undefined;
                    return c && el ? { el, fromSec: c.fromMs / 1000 } : null;
                  }}
                  style={look.style}
                  box={look.box}
                  fit={look.fit}
                />
              );
            })}
          </div>
        )}
        {renderOverlay?.(t)}
      </div>
      {onTransform && (
        <TransformBox
          targets={targets}
          selectedId={selectedClipId}
          enabled={!playing}
          onSelect={(id) => onSelectClip?.(id)}
          onDraft={(id, tr) => {
            if (draftTimer.current) clearTimeout(draftTimer.current);
            setDraft({ id, t: tr });
          }}
          onCommit={(id, tr) => {
            setDraft({ id, t: tr });
            // If the save fails, show the saved value again after a while.
            if (draftTimer.current) clearTimeout(draftTimer.current);
            draftTimer.current = setTimeout(() => setDraft(null), 8000);
            onTransform(id, tr);
          }}
        />
      )}
    </div>
  );
});

/**
 * Where a clip's picture goes in the frame (CSS). Untransformed: the whole
 * frame, as before. Moved, resized or rotated: its box (see clip-transform).
 */
function boxStyle(
  transform: ClipTransform | null,
  size: { w: number; h: number } | null,
  frameRatio: number,
): React.CSSProperties {
  if (!transform) return { inset: 0 };
  // In units of the frame's height (the frame is frameRatio wide).
  const b = transformedBox(size?.w ?? 0, size?.h ?? 0, frameRatio, 1, transform);
  return {
    left: `${((b.cx - b.w / 2) / frameRatio) * 100}%`,
    top: `${(b.cy - b.h / 2) * 100}%`,
    width: `${(b.w / frameRatio) * 100}%`,
    height: `${b.h * 100}%`,
    transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
    overflow: "hidden",
  };
}

/**
 * Where a clip goes in the frame: its stacking, its box, how it fits the box,
 * and whether its blurred copy fills the frame behind it.
 */
function layerLook(
  p: Placed,
  size: { w: number; h: number } | null,
  transform: ClipTransform | null,
  frameRatio: number,
) {
  const mismatched =
    size != null &&
    size.w > 0 &&
    size.h > 0 &&
    Math.abs(Math.log(size.w / size.h / frameRatio)) >= 0.03;
  const style: React.CSSProperties = { zIndex: p.track === "over" ? 2 : 1 };
  // Behind the picture: its blurred copy, filling the frame. A main clip
  // keeps it when moved or resized; a B-roll clip that's been moved or
  // resized shows the main video around it instead.
  const blurBehind = transform ? p.track === "main" : mismatched;
  const box = boxStyle(transform, size, frameRatio);
  // In its own box the picture fills it (the box has the right shape).
  const fit = transform || !mismatched ? "object-cover" : "object-contain";
  return { style, blurBehind, box, fit };
}

// The cut-out is drawn at most this wide (px); the mask itself is smaller.
const CUTOUT_MAX_WIDTH = 960;
/**
 * The mask's edge once scaled up to the cut-out's size (0-255): below
 * EDGE_LO is room, above EDGE_HI the speaker. The segmenter works at 256 px,
 * so scaled up its soft edge is a band ~15-20 px wide at 1080 that takes in
 * a strip of the bright, undarkened wall beside the speaker: a glowing halo
 * over the darkened room. Keeping only its surest part pulls the edge in
 * onto the speaker (the export's own matte is far finer; see cutout.js).
 */
const EDGE_LO = 200;
const EDGE_HI = 250;
/**
 * The speaker's outermost pixels are darkened like the room behind them
 * (by BEHIND_DARKEN, fading out over this share of the cut-out's height
 * inward): what's left of the wall in the edge then sinks into the dark
 * room instead of showing as a thin light line, as the export does.
 */
const EDGE_DARKEN_REACH = 0.003;

/** Darkens the cut-out's edge (`cut`, already masked) from its mask `m`; `blur` is scratch. */
function darkenEdge(cut: HTMLCanvasElement, m: HTMLCanvasElement, blur: HTMLCanvasElement) {
  const w = cut.width;
  const h = cut.height;
  if (blur.width !== w || blur.height !== h) {
    blur.width = w;
    blur.height = h;
  }
  const bg = blur.getContext("2d", { willReadFrequently: true });
  const cg = cut.getContext("2d", { willReadFrequently: true });
  if (!bg || !cg) return;
  bg.globalCompositeOperation = "copy";
  bg.filter = `blur(${Math.max(1, h * EDGE_DARKEN_REACH).toFixed(1)}px)`;
  bg.drawImage(m, 0, 0, w, h);
  bg.filter = "none";
  const inside = bg.getImageData(0, 0, w, h).data;
  const img = cg.getImageData(0, 0, w, h);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const f = 1 - BEHIND_DARKEN * (1 - inside[i + 3] / 255);
    if (f >= 0.999) continue;
    px[i] *= f;
    px[i + 1] *= f;
    px[i + 2] *= f;
  }
  cg.putImageData(img, 0, 0);
}

/** The mask scaled to w x h with its edge tightened (EDGE_LO/EDGE_HI), into `out`. */
function tightMask(mask: HTMLCanvasElement, out: HTMLCanvasElement, w: number, h: number) {
  if (out.width !== w || out.height !== h) {
    out.width = w;
    out.height = h;
  }
  const g = out.getContext("2d", { willReadFrequently: true });
  if (!g) return false;
  g.globalCompositeOperation = "copy";
  g.imageSmoothingQuality = "high";
  g.drawImage(mask, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const px = img.data;
  const span = EDGE_HI - EDGE_LO;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    if (a <= EDGE_LO) px[i] = 0;
    else if (a >= EDGE_HI) px[i] = 255;
    else {
      const t = (a - EDGE_LO) / span;
      px[i] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return true;
}

/** A saved cut-out's video playing stretch from `fromSec` of its clip's file. */
type CutoutSource = { el: HTMLVideoElement; fromSec: number };

/**
 * Keeps a saved cut-out's video on the clip's frame: the same frame while
 * paused, playing along (re-seeking when it drifts) while playing. True
 * when it shows that frame now (to be drawn).
 */
function followVideo(cut: CutoutSource, video: HTMLVideoElement): boolean {
  const { el } = cut;
  const target = video.currentTime - cut.fromSec;
  if (target < 0 || el.readyState < 2 || !el.videoWidth) {
    if (el.readyState < 1 && el.preload !== "auto") el.preload = "auto";
    return false;
  }
  if (el.seeking) return false;
  const drift = el.currentTime - target;
  if (!video.paused) {
    // A frame or so out: a touch slower or faster until it's back on it.
    const nudge = drift > 1 / 60 ? 0.96 : drift < -1 / 60 ? 1.04 : 1;
    const rate = video.playbackRate * nudge;
    if (el.playbackRate !== rate) el.playbackRate = rate;
    if (Math.abs(drift) > 0.12) {
      el.currentTime = target;
      return false;
    }
    if (el.paused) el.play().catch(() => {});
    return true;
  }
  if (!el.paused) el.pause();
  // Within half a frame (30 fps) is the same frame.
  if (Math.abs(drift) > 1 / 60) {
    el.currentTime = target;
    return false;
  }
  return true;
}

/**
 * The saved cut-out's edge work, in pixels of a 1920-high picture, as the
 * export's (cutout.js) but with a deeper sure core: the preview works on a
 * smaller picture and a half-size core, and the export's 2 px left a thin
 * light line here (measured and seen at the cheek, 2026-11-26).
 */
const EDGE_CORE_PX = 8;
const EDGE_INNER_REACH_PX = 8;
const EDGE_SOFT_PX = 2;
/** The matte's wobble smoothed over this much, then made crisp (cutout.js MATTE_SMOOTH_PX / MATTE_CRISP). */
const MATTE_SMOOTH_PX = 1.5;
const MATTE_LO = 110;
const MATTE_HI = 210;
/** An edge pixel may be this much brighter than the speaker just inside (cutout.js EDGE_ALLOW). */
const EDGE_ALLOW = 4;

/** A canvas at w x h, cleared, for drawing with `filter`. */
function sized(c: HTMLCanvasElement, w: number, h: number) {
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.globalCompositeOperation = "copy";
  g.filter = "none";
  return g;
}

/**
 * Draws a saved cut-out's frame into `out` (w x h) with the export's edge
 * (cutout.js behindFilters): the matte (`el`'s right half) smoothed and made
 * crisp, and near the edge each pixel at most a touch brighter than the
 * speaker just inside it (the inside colour: the picture blurred over the
 * sure core), so no wall caught in the edge shows as a ring. `work`: 5
 * scratch canvases. The video's frame is read once (the costly part).
 */
function drawSavedCutout(
  el: HTMLVideoElement,
  out: HTMLCanvasElement,
  w: number,
  h: number,
  work: HTMLCanvasElement[],
) {
  const sw = Math.max(2, Math.round(w / 2));
  const sh = Math.max(2, Math.round(h / 2));
  const unit = sh / 1920; // px of the small canvases per px at 1920 high
  const [core, inner, soft, frame, smooth] = work;
  // The frame once: picture (left) and matte (right), w x h each.
  const fg = sized(frame, w * 2, h);
  fg.drawImage(el, 0, 0, el.videoWidth, el.videoHeight, 0, 0, w * 2, h);
  const f = fg.getImageData(0, 0, w * 2, h).data;
  // The matte's wobble smoothed out (made crisp in the loop below).
  const mg = sized(smooth, w, h);
  mg.filter = `blur(${Math.max(0.3, (MATTE_SMOOTH_PX * h) / 1920).toFixed(2)}px)`;
  mg.drawImage(frame, w, 0, w, h, 0, 0, w, h);
  mg.filter = "none";
  const ma = mg.getImageData(0, 0, w, h).data;
  const span = MATTE_HI - MATTE_LO;
  // The sure core: the matte blurred, kept where it stays at 84% or more
  // (in by about EDGE_CORE_PX, as the export's erosion).
  const cg = sized(core, sw, sh);
  cg.filter = `blur(${Math.max(0.5, EDGE_CORE_PX * unit).toFixed(2)}px)`;
  cg.drawImage(frame, w, 0, w, h, 0, 0, sw, sh);
  cg.filter = "none";
  const ci = cg.getImageData(0, 0, sw, sh);
  const cd = ci.data;
  for (let i = 0; i < cd.length; i += 4) {
    cd[i + 3] = cd[i] > 214 ? 255 : 0;
    cd[i] = cd[i + 1] = cd[i + 2] = 255;
  }
  cg.putImageData(ci, 0, 0);
  // The colour just inside: the picture over the core, blurred (the canvas
  // keeps it premultiplied, so reading it back divides by the blurred core).
  const ig = sized(inner, sw, sh);
  ig.drawImage(frame, 0, 0, w, h, 0, 0, sw, sh);
  ig.globalCompositeOperation = "destination-in";
  ig.drawImage(core, 0, 0);
  ig.globalCompositeOperation = "copy";
  ig.filter = `blur(${Math.max(0.5, EDGE_INNER_REACH_PX * unit).toFixed(2)}px)`;
  ig.drawImage(inner, 0, 0);
  ig.filter = "none";
  const inn = ig.getImageData(0, 0, sw, sh).data;
  // Off the core (a soft step): where the inside colour is used.
  const sg = sized(soft, sw, sh);
  sg.filter = `blur(${Math.max(0.5, EDGE_SOFT_PX * unit).toFixed(2)}px)`;
  sg.drawImage(core, 0, 0);
  sg.filter = "none";
  const sc = sg.getImageData(0, 0, sw, sh).data;
  const og = out.getContext("2d", { willReadFrequently: true });
  if (!og) return;
  const img = og.createImageData(w, h);
  const px = img.data;
  const kx = sw / w;
  const ky = sh / h;
  const frow = w * 8; // a row of the frame (both halves)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, (y * ky) | 0) * sw;
    const fy = y * frow;
    for (let x = 0, o = y * w * 4; x < w; x++, o += 4) {
      const pi = fy + x * 4; // picture
      // The smoothed matte (grey: its R) made crisp: its soft outer part,
      // mostly wall, dropped.
      const sm = ma[o];
      if (sm <= MATTE_LO) continue;
      const al = sm >= MATTE_HI ? 255 : (((sm - MATTE_LO) * 255) / span) | 0;
      px[o + 3] = al;
      px[o] = f[pi];
      px[o + 1] = f[pi + 1];
      px[o + 2] = f[pi + 2];
      const s4 = (sy + Math.min(sw - 1, (x * kx) | 0)) * 4;
      const wt = 1 - sc[s4 + 3] / 255;
      if (wt <= 0.004 || !inn[s4 + 3]) continue;
      for (let c = 0; c < 3; c++) {
        const v = px[o + c];
        const m = inn[s4 + c] + EDGE_ALLOW;
        if (m < v) px[o + c] = v + (m - v) * wt;
      }
    }
  }
  og.putImageData(img, 0, 0);
}

/**
 * A video's speaker, cut out of its current frame, in the same place as the
 * video: from the worker's saved cut-out (getCutout: the export's matte)
 * where there is one ready, else by the browser's person segmenter.
 * Redrawn whenever the frame changes.
 */
function CutoutLayer({
  getVideo,
  getCutout,
  style,
  box,
  fit,
}: {
  getVideo: () => HTMLVideoElement | null;
  /** The saved cut-out holding this time of the clip's file (seconds), if any. */
  getCutout?: (sourceSec: number) => CutoutSource | null;
  style: React.CSSProperties;
  box: React.CSSProperties;
  fit: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [segmenter, setSegmenter] = useState<PersonSegmenter | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPersonSegmenter().then((s) => alive && setSegmenter(s));
    return () => {
      alive = false;
    };
  }, []);
  const getVideoRef = useRef(getVideo);
  getVideoRef.current = getVideo;
  const getCutoutRef = useRef(getCutout);
  getCutoutRef.current = getCutout;
  useEffect(() => {
    const out = canvas.current;
    if (!out) return;
    const mask = document.createElement("canvas");
    const tight = document.createElement("canvas");
    const edgeBlur = document.createElement("canvas");
    const edgeWork = [0, 1, 2, 3, 4].map(() => document.createElement("canvas"));
    let shown: { video: HTMLVideoElement; time: number; saved: boolean } | null = null;
    let segmenterBroke = false;
    let raf = 0;
    const size = (vw: number, vh: number, most = CUTOUT_MAX_WIDTH) => {
      const k = Math.min(1, Math.min(CUTOUT_MAX_WIDTH, Math.max(240, most)) / vw);
      const w = Math.round(vw * k);
      const h = Math.round(vh * k);
      if (out.width !== w || out.height !== h) {
        out.width = w;
        out.height = h;
      }
      return { w, h };
    };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = getVideoRef.current();
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      // Read back every frame (darkenEdge): kept in memory, not on the GPU.
      const g = out.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      // The saved cut-out, when it has this frame.
      const cut = getCutoutRef.current?.(video.currentTime) ?? null;
      if (cut && followVideo(cut, video)) {
        const time = cut.el.currentTime;
        if (shown?.saved && shown.video === cut.el && shown.time === time) return;
        try {
          // At the size it's shown (sharp on this screen), at most the file's.
          const shownW = out.getBoundingClientRect().width * (window.devicePixelRatio || 1);
          const { w, h } = size(cut.el.videoWidth / 2, cut.el.videoHeight, shownW);
          drawSavedCutout(cut.el, out, w, h, edgeWork);
          shown = { video: cut.el, time, saved: true };
        } catch (e) {
          // A frame that can't be read: the browser's cut-out instead.
          console.warn("[preview] The saved cut-out couldn't be drawn:", e);
        }
        return;
      }
      // A saved cut-out on its way to this frame: keep the last one a moment.
      if (cut && shown?.saved) return;
      if (!segmenter || segmenterBroke) return;
      // Only when the frame changed (playing, or a seek).
      if (shown && !shown.saved && shown.video === video && shown.time === video.currentTime)
        return;
      try {
        if (!segmenter.maskInto(video, mask)) return;
      } catch (e) {
        // A frame that can't be read (or a failing segmenter): stop trying;
        // the graphics stay behind the room, without the cut-out.
        console.warn("[preview] The speaker cut-out stopped:", e);
        segmenterBroke = true;
        return;
      }
      shown = { video, time: video.currentTime, saved: false };
      const { w, h } = size(video.videoWidth, video.videoHeight);
      g.globalCompositeOperation = "copy";
      g.drawImage(video, 0, 0, w, h);
      // Keep only the person: the mask scaled up with its edge tightened
      // (tightMask), else as it is.
      g.globalCompositeOperation = "destination-in";
      g.imageSmoothingQuality = "high";
      const tightened = tightMask(mask, tight, w, h);
      g.drawImage(tightened ? tight : mask, 0, 0, w, h);
      g.globalCompositeOperation = "source-over";
      if (tightened) darkenEdge(out, tight, edgeBlur);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      // Its saved cut-out stops with it (paused, kept loaded).
      const v = getVideoRef.current();
      const cut = v ? getCutoutRef.current?.(v.currentTime) : null;
      cut?.el.pause();
    };
  }, [segmenter]);
  return (
    <div className="absolute inset-0" style={style}>
      <div className="absolute" style={box}>
        <canvas ref={canvas} className={cn("absolute inset-0 w-full h-full", fit)} />
      </div>
    </div>
  );
}

/** One clip in the player: a video or an image, fitted to the frame. */
function Layer({
  placed: p,
  url,
  active,
  timeMs,
  frameRatio,
  transform,
  videoRef,
  onSize,
  onReady,
  onStall,
  downloadProgress,
}: {
  placed: Placed;
  url: string;
  /** How far the file's one-time download is (0-1), while it's on its way. */
  downloadProgress?: number;
  active: boolean;
  timeMs: number;
  frameRatio: number;
  /** Moved, resized or rotated; null: the default fit. */
  transform: ClipTransform | null;
  videoRef: (el: HTMLVideoElement | null) => void;
  onSize: (w: number, h: number) => void;
  onReady: () => void;
  onStall: () => boolean;
}) {
  const [size, setSizeState] = useState<{ w: number; h: number } | null>(null);
  const setSize = (next: { w: number; h: number }) => {
    setSizeState(next);
    onSize(next.w, next.h);
  };
  const look = layerLook(p, size, transform, frameRatio);
  const style: React.CSSProperties = {
    ...look.style,
    visibility: active ? "visible" : "hidden",
  };
  const { blurBehind, box, fit } = look;

  if (isImage(p.clip)) {
    // The slow push-in, by where the playhead is in the clip.
    const progress = Math.min(1, Math.max(0, (timeMs - p.start) / Math.max(1, p.end - p.start)));
    const zoom = 1 + IMAGE_ZOOM * progress;
    return (
      <div className="absolute inset-0" style={style}>
        {blurBehind && (
          <img
            src={url}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl brightness-75"
          />
        )}
        <div className="absolute" style={box}>
          <img
            src={url}
            alt=""
            className={cn("absolute inset-0 w-full h-full", fit)}
            style={{ transform: `scale(${zoom})` }}
            onLoad={(e) =>
              setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
        </div>
      </div>
    );
  }
  return (
    <VideoLayer
      url={url}
      style={style}
      blurBehind={blurBehind}
      box={box}
      fit={fit}
      frameRatio={frameRatio}
      active={active}
      videoRef={videoRef}
      onSize={(w, h) => {
        setSize({ w, h });
        onReady();
      }}
      onStall={onStall}
      downloadProgress={downloadProgress}
    />
  );
}

/** A video in the player, in its box, with its blurred copy behind it when asked. */
function VideoLayer({
  url,
  style,
  blurBehind,
  box,
  fit,
  frameRatio,
  active,
  videoRef,
  onSize,
  onStall,
  downloadProgress,
}: {
  url: string;
  /** How far the file's one-time download is (0-1), while it's on its way. */
  downloadProgress?: number;
  style: React.CSSProperties;
  blurBehind: boolean;
  box: React.CSSProperties;
  fit: string;
  frameRatio: number;
  active: boolean;
  videoRef: (el: HTMLVideoElement | null) => void;
  onSize: (w: number, h: number) => void;
  /**
   * The download stalled: ask for a fresh link (the old one may have
   * expired). True: one is on its way (the video reloads when it comes).
   */
  onStall: () => boolean;
}) {
  const el = useRef<HTMLVideoElement | null>(null);
  const onStallRef = useRef(onStall);
  onStallRef.current = onStall;
  const activeRef = useRef(active);
  activeRef.current = active;
  const bg = useRef<HTMLCanvasElement>(null);
  // The link the video plays from. A renewed link (they're renewed every 50
  // minutes, and the old one still works for 10 more) is taken up only when
  // it won't interrupt anything: the clip isn't on screen, or its video
  // isn't playing well anyway (still loading, stalled, or failed). Taking it
  // up reloads the video, which would restart a clip that's playing fine.
  const [link, setLink] = useState(url);
  // Retries from the same link (no fresh one coming) add a harmless
  // `retry=n` to it: a new address, so the browser makes a new request
  // instead of waiting on the stuck one (which it may never give up on).
  const [attempt, setAttempt] = useState(0);
  const src = attempt ? `${link}${link.includes("?") ? "&" : "?"}retry=${attempt}` : link;
  // Shown over the frame: still loading (or buffering), or the browser can't
  // play it. Read from the video itself (not from single events, which a
  // paused video may never send again after a seek), checked on its events
  // and every second while it isn't ready.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Reloads after a stalled download (none of it arriving for a while).
  const [retrying, setRetrying] = useState(false);
  // When data last arrived (or the clip came on screen), for the stall check.
  const lastProgress = useRef(performance.now());
  // Reloads since the video last played well (they wait longer each time).
  const reloads = useRef(0);
  // The file's copy in memory (once downloaded) is taken up also while the
  // clip is on screen but paused: it loads at once, and nothing can stall
  // after that.
  useEffect(() => {
    if (url === link) return;
    const video = el.current;
    const playingWell = video != null && !video.error && video.readyState >= 2 && !retrying;
    const inMemory = url.startsWith("blob:");
    if (!active || !playingWell || (inMemory && video?.paused)) {
      setLink(url);
      setAttempt(0);
    }
  }, [url, link, active, status, retrying]);
  // Coming on screen: give the download a fresh 8 s before calling it stalled
  // (while hidden it only loaded the start, so nothing arrived for a while).
  useEffect(() => {
    if (active) lastProgress.current = performance.now();
  }, [active]);
  // The file's one-time download is on its way (see the stall check below).
  const downloading = useRef(false);
  downloading.current = downloadProgress != null;
  // A load stopped for the download, which then can't finish (the file is
  // too big to hold): load from the link again.
  useEffect(() => {
    const video = el.current;
    if (downloadProgress == null && video && !video.getAttribute("src") && src) {
      video.setAttribute("src", src);
      video.load();
    }
  }, [downloadProgress, src]);
  useEffect(() => {
    const video = el.current;
    if (!video) return;
    let buffering = false;
    lastProgress.current = performance.now();
    const refresh = () => {
      const next = video.error
        ? "error"
        : video.readyState < 2 || (buffering && !video.paused)
          ? "loading"
          : "ready";
      setStatus(next);
      if (next === "ready") {
        reloads.current = 0;
        setRetrying(false);
      }
    };
    const onWaiting = () => {
      buffering = true;
      refresh();
    };
    const onFlowing = () => {
      buffering = false;
      refresh();
    };
    const onProgress = () => {
      lastProgress.current = performance.now();
      refresh();
    };
    const onLoadStart = () => {
      buffering = false;
      lastProgress.current = performance.now();
      refresh();
    };
    const flowing = ["playing", "canplay", "canplaythrough", "seeked", "pause"];
    const checks = ["loadedmetadata", "loadeddata", "timeupdate", "seeking", "emptied", "error"];
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("progress", onProgress);
    video.addEventListener("loadstart", onLoadStart);
    for (const ev of flowing) video.addEventListener(ev, onFlowing);
    for (const ev of checks) video.addEventListener(ev, refresh);
    const timer = setInterval(() => {
      refresh();
      // On screen, waiting for the picture (none yet, or playing and out of
      // it) with nothing arriving: the download has stalled. On a shaky
      // connection one request can hang for good without failing, or the
      // link has expired. Ask for a fresh link, which reloads the video when
      // it comes; when none is coming (one was asked for moments ago), load
      // again with a new request. The player puts it back in place. Waits
      // 8 s the first time, then longer (up to 30 s), and keeps trying.
      // A hidden clip (the next one) isn't checked: it only loads its start,
      // and a reload for it would also reload the clip on screen when both
      // come from the same file.
      const waitingForPicture = video.readyState < 2 || (buffering && !video.paused);
      const starved =
        activeRef.current && !video.error && waitingForPicture && video.networkState !== 3;
      const patience = Math.min(8000 + reloads.current * 4000, 30_000);
      if (
        starved &&
        downloading.current &&
        performance.now() - lastProgress.current > 8000 &&
        !video.src.startsWith("blob:")
      ) {
        // Stalled while the file's one-time download is on its way: stop
        // this load (on a slow connection it only takes bandwidth from the
        // download) and play from memory when the download is in.
        if (video.getAttribute("src")) {
          console.warn("[preview] Video download stalled; waiting for the full download", {
            at: video.currentTime.toFixed(1),
          });
          setRetrying(false);
          video.removeAttribute("src");
          video.load();
        }
        lastProgress.current = performance.now();
      } else if (starved && performance.now() - lastProgress.current > patience) {
        reloads.current++;
        lastProgress.current = performance.now();
        setRetrying(true);
        console.warn("[preview] Video download stalled; retrying with a fresh link", {
          try: reloads.current,
          readyState: video.readyState,
          networkState: video.networkState,
          buffered: video.buffered.length
            ? `${video.buffered.start(0).toFixed(1)}-${video.buffered.end(video.buffered.length - 1).toFixed(1)}s`
            : "none",
          at: video.currentTime.toFixed(1),
        });
        // A copy in memory can't stall on the network: just load it again.
        if (video.src.startsWith("blob:")) video.load();
        else if (!onStallRef.current()) setAttempt((n) => n + 1);
      }
    }, 1000);
    refresh();
    return () => {
      clearInterval(timer);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("loadstart", onLoadStart);
      for (const ev of flowing) video.removeEventListener(ev, onFlowing);
      for (const ev of checks) video.removeEventListener(ev, refresh);
    };
  }, [src]);
  // The blurred copy: the video drawn small into a canvas each frame it shows.
  useEffect(() => {
    const video = el.current;
    const canvas = bg.current;
    const g = canvas?.getContext("2d");
    if (!blurBehind || !active || !video || !canvas || !g) return;
    const draw = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      const s = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const dw = video.videoWidth * s;
      const dh = video.videoHeight * s;
      try {
        g.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } catch {
        /* frame not ready */
      }
    };
    let handle: number | null = null;
    let raf = 0;
    if ("requestVideoFrameCallback" in video) {
      const onFrame = () => {
        draw();
        handle = video.requestVideoFrameCallback(onFrame);
      };
      handle = video.requestVideoFrameCallback(onFrame);
    } else {
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    const onSeeked = () => draw();
    video.addEventListener("seeked", onSeeked);
    draw();
    return () => {
      if (handle != null) video.cancelVideoFrameCallback(handle);
      cancelAnimationFrame(raf);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [blurBehind, active]);

  return (
    <div className="absolute inset-0" style={style}>
      {blurBehind && (
        <canvas
          ref={bg}
          aria-hidden
          width={frameRatio >= 1 ? 64 : Math.round(64 * frameRatio)}
          height={frameRatio >= 1 ? Math.round(64 / frameRatio) : 64}
          className="absolute inset-0 w-full h-full scale-110 blur-xl brightness-75"
        />
      )}
      <div className="absolute" style={box}>
        <video
          ref={(v) => {
            el.current = v;
            videoRef(v);
          }}
          src={src}
          // Read with CORS (storage allows it), so the speaker cut-out can
          // read its frames; without it they're locked to other code.
          crossOrigin="anonymous"
          // The clip on screen loads in full; the next one (hidden) only its
          // start, so it doesn't share the connection with the one playing.
          preload={active ? "auto" : "metadata"}
          playsInline
          muted
          className={cn("absolute inset-0 w-full h-full", fit)}
          onLoadedMetadata={(e) => onSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
        />
      </div>
      {status !== "ready" && (
        <div className="absolute inset-0 z-10 grid place-items-center p-4 text-center pointer-events-none">
          {status === "loading" ? (
            <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {retrying ? "Still loading, trying again…" : "Loading video…"}
              {downloadProgress != null && downloadProgress > 0 && (
                <span className="tabular-nums">{Math.round(downloadProgress * 100)}%</span>
              )}
            </span>
          ) : (
            <span className="text-[11px] leading-snug text-neutral-400 max-w-[16rem]">
              This clip can&apos;t play in the browser preview. The export will still include it.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
