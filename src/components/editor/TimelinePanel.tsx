import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Scissors,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  MousePointer2,
  Magnet,
  Plus,
  Minus,
  Maximize2,
  Film,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ClipRow } from "./types";
import { formatTimecode as formatPlaybackTime } from "./PlaybackControls";
import { clampZoom, sliderToZoom, zoomToSlider } from "./timeline-zoom";
import { thumbnailKey } from "@/lib/video-thumbnail";

/* ---------- shared types ---------- */
export interface HistoryItem {
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  description: string;
}

/* ---------- helpers ---------- */
export function clipVisibleMs(c: ClipRow): number {
  const inMs = c.trim_in_ms ?? 0;
  const outMs = c.trim_out_ms ?? c.duration_ms ?? null;
  if (outMs != null) return Math.max(200, outMs - inMs);
  return 5000;
}

/** File name without its extension (a name with no extension is kept). */
const baseName = (filename: string) => filename.replace(/\.[^.]+$/, "");

function clipSourceMs(c: ClipRow): number | null {
  return c.duration_ms ?? null;
}

/** Ruler label: m:ss, or h:mm:ss from an hour. */
function formatRulerTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// Empty space after the last clip, room for the END label.
const TRACK_TAIL_PX = 80;

/* ---------- toolbar micro-components ---------- */
function ToolBtn({
  icon: Icon,
  title,
  accent,
  active,
  className,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  title: string;
  accent?: boolean;
  active?: boolean;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={title}
            onClick={onClick}
            disabled={disabled}
            className={cn(
              "w-8 h-8 grid place-items-center rounded-md transition-colors shrink-0",
              active
                ? "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30"
                : accent
                ? "text-neutral-200 hover:text-violet-300 hover:bg-white/[0.06]"
                : "text-neutral-400 hover:text-white hover:bg-white/[0.06]",
              disabled &&
                "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-neutral-400",
              className,
            )}
          >
            <Icon className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="text-[11px] bg-[#161622] text-neutral-200 border-white/10 font-mono"
        >
          {title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-white/[0.08] mx-0.5 shrink-0" />;
}

/* ---------- track row ---------- */
// Video tracks hold clips; slim tracks (voice, captions, music) hold labels.
const TRACK_HEIGHT = { clip: 56, slim: 34 } as const;

function TrackRow({
  label,
  name,
  note,
  size = "clip",
  innerWidth,
  contentHandlers,
  contentRef,
  children,
}: {
  label: string;
  name: string;
  /** A short line under the track name, e.g. what the track is for. */
  note?: string;
  size?: keyof typeof TRACK_HEIGHT;
  innerWidth: number;
  /** Pointer handlers for the track's content area (click/drag to seek). */
  contentHandlers?: React.HTMLAttributes<HTMLDivElement>;
  /** The track's content area (where its clips sit), e.g. to find drop targets. */
  contentRef?: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const height = TRACK_HEIGHT[size];
  return (
    <div
      className="flex border-b border-white/[0.05] hover:bg-white/[0.015] transition-colors"
      style={{ height }}
    >
      <div
        data-track-header
        className="w-24 sm:w-28 shrink-0 border-r border-white/[0.06] bg-[#0d0d14] px-2.5 flex flex-col justify-center sticky left-0 z-[25]"
      >
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[11px] font-mono font-bold text-violet-400">{label}</span>
          <span className="text-[9px] text-neutral-500 uppercase tracking-wider truncate">
            {name}
          </span>
        </div>
        {note && <span className="text-[8.5px] text-neutral-600 truncate">{note}</span>}
      </div>
      <div ref={contentRef} className="relative" style={{ width: innerWidth }} {...contentHandlers}>
        {children}
      </div>
    </div>
  );
}

/* ---------- clip block ---------- */
function TimelineClip({
  clip,
  index,
  pxPerSec,
  offsetMs,
  selected,
  dragOffset,
  onSelect,
  onBodyPointerDown,
  onTrim,
  snapBoundariesMs,
  clipStartMs,
  tone,
  thumbnail,
  cutAtMs,
}: {
  clip: ClipRow;
  index: number;
  pxPerSec: number;
  offsetMs: number;
  selected: boolean;
  /** Pointer movement while this clip is being dragged to a new position. */
  dragOffset: { x: number; y: number } | null;
  onSelect: () => void;
  /** Press on the clip body (not a trim handle): may start a drag. */
  onBodyPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onTrim: (id: string, trimInMs: number, trimOutMs: number | null) => void;
  snapBoundariesMs: number[];
  clipStartMs: number;
  tone: "primary" | "teal";
  /** A frame from the clip (data URL), repeated along the block. */
  thumbnail?: string;
  /** Where in this clip the exported video ends (ms); the rest is cut. */
  cutAtMs?: number | null;
}) {
  const sourceMs = clipSourceMs(clip);
  const trimIn = clip.trim_in_ms ?? 0;
  const trimOut = clip.trim_out_ms ?? sourceMs ?? trimIn + clipVisibleMs(clip);
  // Trim points shown while dragging a handle, and after release until the
  // saved values come back (so the clip doesn't flick back to its old size).
  const [localTrimIn, setLocalTrimIn] = useState<number | null>(null);
  const [localTrimOut, setLocalTrimOut] = useState<number | null>(null);
  const effIn = localTrimIn ?? trimIn;
  const effOut = localTrimOut ?? trimOut;
  const visibleMs = Math.max(200, effOut - effIn);
  const widthPx = (visibleMs / 1000) * pxPerSec;
  // While the left handle moves, the clip's left edge follows it and its
  // right edge stays put; the track re-packs once the trim is saved.
  const leftShiftMs = localTrimIn != null ? localTrimIn - trimIn : 0;
  const leftPx = ((offsetMs + leftShiftMs) / 1000) * pxPerSec;

  // Saved trim arrived (or the save failed): drop the local preview.
  useEffect(() => {
    setLocalTrimIn(null);
    setLocalTrimOut(null);
  }, [clip.trim_in_ms, clip.trim_out_ms]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const gradient =
    tone === "primary"
      ? "from-violet-500/45 to-violet-500/20 border-violet-500/50"
      : "from-teal-500/40 to-cyan-500/20 border-teal-400/40";

  function snapTo(valueMs: number): number {
    if (snapBoundariesMs.length === 0) return valueMs;
    const SNAP_THRESHOLD_PX = 8;
    let closest = valueMs;
    let closestDist = Infinity;
    for (const boundary of snapBoundariesMs) {
      const relBoundary = boundary - clipStartMs + trimIn;
      const dist = Math.abs(((relBoundary - valueMs) * pxPerSec) / 1000);
      if (dist < SNAP_THRESHOLD_PX && dist < closestDist) {
        closestDist = dist;
        closest = relBoundary;
      }
    }
    return closest;
  }

  function beginTrim(edge: "left" | "right", e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startClientX = e.clientX;
    const startIn = trimIn;
    const startOut = trimOut;
    // Never past the end of the file. If its length isn't known yet (it's
    // measured when the editor opens), the clip can only be shortened.
    const maxOut = sourceMs ?? startOut;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    // Latest values, kept outside React state so release saves exactly once.
    let nextIn = startIn;
    let nextOut = startOut;

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startClientX;
      const deltaMs = Math.round((dx / pxPerSec) * 1000);
      if (edge === "left") {
        nextIn = snapTo(Math.max(0, Math.min(startOut - 200, startIn + deltaMs)));
        setLocalTrimIn(nextIn);
      } else {
        nextOut = snapTo(Math.max(startIn + 200, Math.min(maxOut, startOut + deltaMs)));
        setLocalTrimOut(nextOut);
      }
    }

    function stopListening() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    }

    // The browser took the pointer away (e.g. a touch became a scroll).
    function onCancel() {
      stopListening();
      setLocalTrimIn(null);
      setLocalTrimOut(null);
    }

    function onUp() {
      stopListening();
      // A press without movement (or back to where it started) changes nothing.
      if (nextIn === startIn && nextOut === startOut) {
        setLocalTrimIn(null);
        setLocalTrimOut(null);
        return;
      }
      // Keep showing the new trim until it's saved; give up after a while
      // in case the save fails, so the clip shows its real size again.
      resetTimer.current = setTimeout(() => {
        setLocalTrimIn(null);
        setLocalTrimOut(null);
      }, 8000);
      onTrim(clip.id, nextIn, sourceMs != null && nextOut >= sourceMs ? null : nextOut);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return (
    <div
      data-timeline-clip
      onPointerDown={onBodyPointerDown}
      onClick={onSelect}
      // Stop the browser's own image/text drag and the long-press menu.
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => dragOffset && e.preventDefault()}
      style={{
        position: "absolute",
        left: leftPx,
        width: Math.max(20, widthPx),
        top: 5,
        bottom: 5,
        transform: dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
      }}
      className={cn(
        "rounded-md border bg-gradient-to-br cursor-grab overflow-hidden group select-none transition-shadow",
        gradient,
        selected && "ring-2 ring-violet-400 shadow-[0_0_20px_-4px_rgba(139,92,246,0.5)]",
        dragOffset &&
          "z-30 opacity-70 cursor-grabbing shadow-[0_8px_24px_rgba(0,0,0,0.5)] pointer-events-none",
      )}
    >
      {/* Trim handles: always shown on the selected clip, on hover otherwise.
          touch-none lets a finger drag them instead of scrolling. */}
      {(["left", "right"] as const).map((edge) => (
        <div
          key={edge}
          onPointerDown={(e) => beginTrim(edge, e)}
          className={cn(
            "absolute top-0 bottom-0 w-3.5 cursor-ew-resize z-10 flex items-center justify-center touch-none transition",
            edge === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
            selected
              ? "bg-violet-400/35 opacity-100 hover:bg-violet-400/55"
              : "bg-black/35 opacity-0 group-hover:opacity-100",
          )}
          title={edge === "left" ? "Drag to trim the start" : "Drag to trim the end"}
        >
          <span className="w-[3px] h-6 bg-white/90 rounded-full" />
        </div>
      ))}

      {/* Thumbnail strip, dimmed so the label stays readable */}
      {thumbnail && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-45 pointer-events-none"
          style={{
            backgroundImage: `url(${thumbnail})`,
            backgroundSize: "auto 100%",
            backgroundRepeat: "repeat-x",
          }}
        />
      )}

      {/* Part past the end of the exported video: cut */}
      {cutAtMs != null && (
        <div
          className="absolute inset-y-0 right-0 pointer-events-none border-l border-dashed border-white/50"
          style={{
            left: (cutAtMs / 1000) * pxPerSec,
            background:
              "repeating-linear-gradient(135deg, rgba(0,0,0,0.55) 0 4px, rgba(0,0,0,0.25) 4px 8px)",
          }}
          title="Cut: this part runs past the end of the video"
        />
      )}

      {/* Label */}
      <div className="absolute inset-0 px-4 py-1 flex flex-col justify-between text-[9px] pointer-events-none [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-1 text-white/95 font-mono font-semibold truncate">
          <Film className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">
            {String(index + 1).padStart(2, "0")} · {baseName(clip.filename)}
          </span>
        </div>
        <div className="flex items-center justify-between text-white/75 font-mono tabular-nums">
          <span>{formatPlaybackTime(visibleMs / 1000)}</span>
          {sourceMs != null && sourceMs - visibleMs >= 50 && (
            <span className="text-white/45 truncate" title="Length of the original file">
              of {formatPlaybackTime(sourceMs / 1000)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- slim track labels ---------- */
// A labelled bar on a slim track (voice, caption phrase, music clip).
function TrackLabel({
  leftPx,
  widthPx,
  text,
  title,
  className,
}: {
  leftPx: number;
  widthPx: number;
  text: string;
  title?: string;
  className: string;
}) {
  return (
    <div
      className={cn(
        "absolute top-1 bottom-1 rounded px-1.5 flex items-center text-[9.5px] leading-none truncate pointer-events-none border",
        className,
      )}
      style={{ left: leftPx, width: Math.max(4, widthPx - 1) }}
      title={title ?? text}
    >
      <span className="truncate">{text}</span>
    </div>
  );
}

/* ---------- TimelineTracks ---------- */
type Track = "aroll" | "broll";

/** A caption phrase on the timeline: its text and where it's shown. */
export type CaptionPhrase = { key: string; text: string; startMs: number; endMs: number };

type TimelineTracksProps = {
  aRoll: ClipRow[];
  bRoll: ClipRow[];
  videoClips: ClipRow[];
  selectedClipId: string | null;
  onSelect: (id: string) => void;
  onTrim: (id: string, trimInMs: number, trimOutMs: number | null) => void;
  captions: boolean;
  music: boolean;
  pxPerSec: number;
  snapEnabled: boolean;
  currentTimeMs: number;
  onSeekMs: (clipId: string, absMs: number, atTimelineMs: number) => void;
  reorderMut: {
    mutate: (data: { order: { id: string; ordinal: number; role?: string }[] }) => void;
  };
  pushToHistory: (item: HistoryItem) => void;
  /** Sets the zoom (px per second). */
  onZoomTo: (pxPerSec: number) => void;
  /** Changes when the Fit button is pressed. */
  fitRequest: number;
  /** Caption phrases on the timeline (from the saved transcripts). */
  captionPhrases: CaptionPhrase[];
  /** Uploaded music and SFX clips. */
  audioClips: ClipRow[];
  /** Clip thumbnails by thumbnailKey(clip). */
  thumbnails: Record<string, string>;
};

function TimelineTracks({
  aRoll,
  bRoll,
  videoClips,
  selectedClipId,
  onSelect,
  onTrim,
  captions,
  music,
  pxPerSec,
  snapEnabled,
  currentTimeMs,
  onSeekMs,
  reorderMut,
  pushToHistory,
  onZoomTo,
  fitRequest,
  captionPhrases,
  audioClips,
  thumbnails,
}: TimelineTracksProps) {
  // Clip being dragged to a new position (with how far the pointer moved),
  // and the track and position among that track's other clips it would land.
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ track: Track; index: number } | null>(null);
  const trackEls = useRef<Record<Track, HTMLDivElement | null>>({ aroll: null, broll: null });
  // A drag ends with a click on whatever is under the pointer; don't let it
  // select a clip.
  const suppressClick = useRef(false);

  const aLayout = useMemo(() => {
    const offsets = new Map<string, number>();
    let cur = 0;
    for (const c of aRoll) {
      offsets.set(c.id, cur);
      cur += clipVisibleMs(c);
    }
    return { offsets, totalMs: Math.max(cur, 10000) };
  }, [aRoll]);

  const bLayout = useMemo(() => {
    const offsets = new Map<string, number>();
    let cur = 0;
    for (const c of bRoll) {
      offsets.set(c.id, cur);
      cur += clipVisibleMs(c);
    }
    return { offsets, totalMs: Math.max(cur, 5000) };
  }, [bRoll]);

  const totalMs = Math.max(aLayout.totalMs, bLayout.totalMs);

  // Where the exported video ends: the end of the main track (the A-roll,
  // or the B-roll when there is no A-roll). B-roll past it is cut.
  const mainClips = aRoll.length > 0 ? aRoll : bRoll;
  const mainLayout = aRoll.length > 0 ? aLayout : bLayout;
  const programEndMs = mainClips.reduce((sum, c) => sum + clipVisibleMs(c), 0);
  // The music row as the export mixes it: music files one after another,
  // looped to the end of the video; one SFX per cut, cycling through files.
  const musicFiles = audioClips.filter((c) => c.role !== "sfx");
  const sfxFiles = audioClips.filter((c) => c.role === "sfx");
  const musicEndMs =
    programEndMs > 0 ? programEndMs : musicFiles.reduce((t, c) => t + clipVisibleMs(c), 0);
  const musicBars: {
    key: string;
    clip: ClipRow;
    startMs: number;
    lengthMs: number;
    loop: boolean;
  }[] = [];
  for (let at = 0, n = 0; musicFiles.length > 0 && at < musicEndMs && n < 500; n++) {
    const clip = musicFiles[n % musicFiles.length];
    const lengthMs = Math.min(clipVisibleMs(clip), musicEndMs - at);
    musicBars.push({
      key: `${clip.id}:${n}`,
      clip,
      startMs: at,
      lengthMs,
      loop: n >= musicFiles.length,
    });
    at += lengthMs;
  }
  const sfxMarks = sfxFiles.length
    ? mainClips.slice(1).map((c, k) => {
        const cutMs = mainLayout.offsets.get(c.id) ?? 0;
        const clip = sfxFiles[k % sfxFiles.length];
        return {
          key: `${c.id}:sfx`,
          clip,
          cutMs,
          startMs: Math.max(0, cutMs - 150),
          lengthMs: Math.max(200, clipVisibleMs(clip)),
        };
      })
    : [];
  const cutAtFor = (c: ClipRow) => {
    if (aRoll.length === 0) return null;
    const start = bLayout.offsets.get(c.id) ?? 0;
    return start + clipVisibleMs(c) > programEndMs ? Math.max(0, programEndMs - start) : null;
  };
  const trackWidthPx = Math.max(600, (totalMs / 1000) * pxPerSec + TRACK_TAIL_PX);

  const ruler = useMemo(() => {
    const seconds = totalMs / 1000;
    // Labelled ticks at least ~60px apart, with a few small ticks between.
    const step =
      pxPerSec >= 120
        ? 1
        : pxPerSec >= 60
          ? 2
          : pxPerSec >= 30
            ? 5
            : pxPerSec >= 12
              ? 10
              : pxPerSec >= 4
                ? 30
                : 60;
    const minor = step >= 30 ? step / 6 : step >= 10 ? step / 5 : 1;
    // Labels that would sit under the END marker's label are left out.
    const endPx = (programEndMs / 1000) * pxPerSec;
    const ticks: { t: number; label: string; major: boolean }[] = [];
    for (let t = 0; t <= seconds + step; t += minor) {
      const major = t % step === 0;
      const px = t * pxPerSec;
      const underEnd = programEndMs > 0 && px > endPx - 16 && px < endPx + 72;
      ticks.push({ t, label: major && !underEnd ? formatRulerTime(t) : "", major });
    }
    return ticks;
  }, [totalMs, pxPerSec, programEndMs]);

  const playheadPx = (currentTimeMs / 1000) * pxPerSec;

  // Trim snap points: the edges of every clip where it actually sits (A-roll
  // and B-roll each start at 0:00 on their own track) and the playhead.
  // Each clip leaves out its own edges and any point sitting on them (on a
  // packed track the next clip starts exactly where this one ends), so a
  // handle isn't held in place.
  const snapPoints = useMemo(() => {
    if (!snapEnabled) return [];
    const pts: { ms: number; clipId: string | null }[] = [{ ms: currentTimeMs, clipId: null }];
    for (const [clips, layout] of [
      [aRoll, aLayout],
      [bRoll, bLayout],
    ] as const) {
      for (const c of clips) {
        const off = layout.offsets.get(c.id) ?? 0;
        pts.push({ ms: off, clipId: c.id }, { ms: off + clipVisibleMs(c), clipId: c.id });
      }
    }
    return pts;
  }, [snapEnabled, currentTimeMs, aRoll, bRoll, aLayout, bLayout]);
  const snapPointsFor = (c: ClipRow, startMs: number) => {
    const endMs = startMs + clipVisibleMs(c);
    return snapPoints
      .filter(
        (p) => p.clipId !== c.id && Math.abs(p.ms - startMs) > 1 && Math.abs(p.ms - endMs) > 1,
      )
      .map((p) => p.ms);
  };

  // Moves the playhead to a timeline time. The clip under it on the main
  // track (the A-roll, or the B-roll when there's no A-roll) is reported with
  // the matching time in its source file, so the editor can seek either the
  // rendered preview or that clip.
  function seekTimeline(atTimelineMs: number) {
    const main = aRoll.length > 0 ? aRoll : bRoll;
    const layout = aRoll.length > 0 ? aLayout : bLayout;
    let ms = Math.max(0, atTimelineMs);
    let target: ClipRow | undefined;
    for (const c of main) {
      const start = layout.offsets.get(c.id) ?? 0;
      if (ms < start + clipVisibleMs(c)) {
        target = c;
        break;
      }
    }
    // Past the end: stay on the last frame of the last clip.
    if (!target && main.length > 0) {
      target = main[main.length - 1];
      ms = (layout.offsets.get(target.id) ?? 0) + clipVisibleMs(target) - 1;
    }
    if (!target) return onSeekMs("", 0, ms);
    const start = layout.offsets.get(target.id) ?? 0;
    onSeekMs(target.id, (target.trim_in_ms ?? 0) + (ms - start), ms);
  }

  // Click or drag anywhere along the ruler, or on empty track space, to move
  // the playhead. The element's left edge is timeline 0:00; it scrolls with
  // the tracks, so its on-screen position already includes the scroll.
  const scrubbing = useRef(false);
  function timelineMsAt(e: React.PointerEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) / pxPerSec) * 1000;
  }
  const scrubHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // On a track, presses on clips are for selecting, trimming and dragging.
      if ((e.target as HTMLElement).closest("[data-timeline-clip]")) return;
      scrubbing.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seekTimeline(timelineMsAt(e));
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (scrubbing.current) seekTimeline(timelineMsAt(e));
    },
    onPointerUp: () => {
      scrubbing.current = false;
    },
    onPointerCancel: () => {
      scrubbing.current = false;
    },
  };

  // Keep the playhead in view while it moves (playback, scrubbing, seeking):
  // when it leaves the visible area, page the view so it sits a quarter in.
  // Zooming alone doesn't count, so zooming at the pointer isn't undone.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const lastFollowedMs = useRef(currentTimeMs);
  useEffect(() => {
    if (currentTimeMs === lastFollowedMs.current) return;
    lastFollowedMs.current = currentTimeMs;
    const el = scrollRef.current;
    if (!el) return;
    const gutter = el.querySelector<HTMLElement>("[data-track-header]")?.offsetWidth ?? 96;
    const visibleWidth = el.clientWidth - gutter;
    if (visibleWidth <= 0) return;
    const margin = 24;
    if (playheadPx < el.scrollLeft || playheadPx > el.scrollLeft + visibleWidth - margin) {
      el.scrollLeft = Math.max(0, playheadPx - visibleWidth * 0.25);
    }
  }, [playheadPx, currentTimeMs]);

  // When the zoom changes, keep one point of the timeline at the same place
  // on screen: where the pointer was for Ctrl/⌘ + scroll, the start for Fit,
  // otherwise the playhead if it's in view, else the middle of the view.
  const gutterWidth = (el: HTMLElement) =>
    el.querySelector<HTMLElement>("[data-track-header]")?.offsetWidth ?? 96;
  const zoomAnchor = useRef<{ ms: number; viewX: number } | null>(null);
  const prevPxPerSec = useRef(pxPerSec);
  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const oldPx = prevPxPerSec.current;
    prevPxPerSec.current = pxPerSec;
    const anchorRequest = zoomAnchor.current;
    zoomAnchor.current = null;
    if (!el || oldPx === pxPerSec) return;
    const visible = el.clientWidth - gutterWidth(el);
    let anchor = anchorRequest;
    if (!anchor) {
      const playheadViewX = (currentTimeMs / 1000) * oldPx - el.scrollLeft;
      anchor =
        playheadViewX >= 0 && playheadViewX <= visible
          ? { ms: currentTimeMs, viewX: playheadViewX }
          : { ms: ((el.scrollLeft + visible / 2) / oldPx) * 1000, viewX: visible / 2 };
    }
    el.scrollLeft = Math.max(0, (anchor.ms / 1000) * pxPerSec - anchor.viewX);
    // Only zoom changes matter here; the playhead is read as it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerSec]);

  // Ctrl/⌘ + scroll wheel (or a trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const viewX = Math.max(0, e.clientX - r.left - gutterWidth(el));
      const px = pxPerSecRef.current;
      const next = clampZoom(px * Math.exp(-e.deltaY * 0.0015));
      if (next === px) return;
      zoomAnchor.current = { ms: ((el.scrollLeft + viewX) / px) * 1000, viewX };
      onZoomTo(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoomTo]);

  // Fit: zoom so the whole video fills the visible width, from its start.
  const lastFitRequest = useRef(fitRequest);
  useEffect(() => {
    if (fitRequest === lastFitRequest.current) return;
    lastFitRequest.current = fitRequest;
    const el = scrollRef.current;
    if (!el) return;
    const contentMs = Math.max(
      aRoll.reduce((sum, c) => sum + clipVisibleMs(c), 0),
      bRoll.reduce((sum, c) => sum + clipVisibleMs(c), 0),
    );
    if (contentMs <= 0) return;
    const visible = el.clientWidth - gutterWidth(el) - TRACK_TAIL_PX;
    const next = clampZoom((visible / contentMs) * 1000);
    if (next === pxPerSecRef.current) {
      el.scrollLeft = 0;
      return;
    }
    zoomAnchor.current = { ms: 0, viewX: 0 };
    onZoomTo(next);
  }, [fitRequest, aRoll, bRoll, onZoomTo]);

  const trackClips = (track: Track) => (track === "aroll" ? aRoll : bRoll);
  const trackLayout = (track: Track) => (track === "aroll" ? aLayout : bLayout);

  /**
   * Where a dragged clip would land under the pointer: the track row it's
   * over, and its position among that track's other clips, decided by which
   * side of each clip's midpoint the pointer is on. Null outside the tracks.
   */
  function dropTargetAt(clientX: number, clientY: number, draggedId: string) {
    for (const track of ["aroll", "broll"] as const) {
      const el = trackEls.current[track];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top || clientY > r.bottom) continue;
      const ms = ((clientX - r.left) / pxPerSec) * 1000;
      const layout = trackLayout(track);
      let index = 0;
      for (const c of trackClips(track)) {
        if (c.id === draggedId) continue;
        if (ms > (layout.offsets.get(c.id) ?? 0) + clipVisibleMs(c) / 2) index++;
      }
      return { track, index };
    }
    return null;
  }

  /** Timeline x (px) of the insertion line for a drop target. */
  function insertionPx(target: { track: Track; index: number }, draggedId: string) {
    const layout = trackLayout(target.track);
    const others = trackClips(target.track).filter((c) => c.id !== draggedId);
    if (others.length === 0) return 0;
    const ms =
      target.index < others.length
        ? (layout.offsets.get(others[target.index].id) ?? 0)
        : (layout.offsets.get(others[others.length - 1].id) ?? 0) +
          clipVisibleMs(others[others.length - 1]);
    return (ms / 1000) * pxPerSec;
  }

  /** Moves a clip to a position on a track (changing its role if the track changes). */
  function moveClip(draggedId: string, toTrack: Track, index: number) {
    const draggedClip = videoClips.find((c) => c.id === draggedId);
    if (!draggedClip) return;

    const newRole =
      toTrack === "broll" ? "broll" : draggedClip.role === "broll" ? "aroll" : draggedClip.role;

    const newARoll = aRoll.filter((c) => c.id !== draggedId);
    const newBRoll = bRoll.filter((c) => c.id !== draggedId);
    const dest = toTrack === "aroll" ? newARoll : newBRoll;
    dest.splice(Math.min(index, dest.length), 0, { ...draggedClip, role: newRole });

    // Dropped back where it was: nothing to save or undo.
    const same = (a: ClipRow[], b: ClipRow[]) =>
      a.length === b.length && a.every((c, i) => c.id === b[i].id);
    if (same(newARoll, aRoll) && same(newBRoll, bRoll)) return;

    const combined = [
      ...newARoll.map((c, i) => ({
        id: c.id,
        ordinal: i,
        role: c.role as string,
      })),
      ...newBRoll.map((c, i) => ({
        id: c.id,
        ordinal: newARoll.length + i,
        role: "broll" as string,
      })),
    ];

    const prevOrder = videoClips.map((c) => ({
      id: c.id,
      ordinal: c.ordinal,
      role: c.role as string,
    }));

    pushToHistory({
      description: "Reorder clip",
      undo: () => {
        reorderMut.mutate({
          order: prevOrder,
        });
      },
      redo: () => {
        reorderMut.mutate({
          order: combined,
        });
      },
    });

    reorderMut.mutate({
      order: combined,
    });
  }

  /**
   * Press on a clip body. With a mouse or pen the clip is picked up once the
   * pointer moves a few pixels (a plain click still selects it). With touch,
   * press and hold briefly to pick it up; moving the finger first scrolls
   * the timeline as usual.
   */
  function startClipPress(c: ClipRow, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const pointerId = e.pointerId;
    const isTouch = e.pointerType === "touch";
    const startX = e.clientX;
    const startY = e.clientY;
    const scroller = scrollRef.current;
    const startScroll = scroller?.scrollLeft ?? 0;
    let active = false;
    let last = { x: startX, y: startY };

    const update = () => {
      const scrolled = (scroller?.scrollLeft ?? 0) - startScroll;
      setDrag({ id: c.id, dx: last.x - startX + scrolled, dy: last.y - startY });
      setDropTarget(dropTargetAt(last.x, last.y, c.id));
    };
    const begin = () => {
      active = true;
      suppressClick.current = true;
      update();
    };
    // Scroll the timeline while dragging near its left or right edge.
    const autoScroll = () => {
      if (!scroller) return;
      const r = scroller.getBoundingClientRect();
      const gutter = scroller.querySelector<HTMLElement>("[data-track-header]")?.offsetWidth ?? 96;
      if (last.x < r.left + gutter + 40) scroller.scrollLeft -= 16;
      else if (last.x > r.right - 40) scroller.scrollLeft += 16;
    };

    const holdTimer = isTouch ? setTimeout(begin, 300) : null;

    function finish(commit: boolean) {
      if (holdTimer) clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchmove", blockTouchScroll);
      if (active && commit) {
        const target = dropTargetAt(last.x, last.y, c.id);
        if (target) moveClip(c.id, target.track, target.index);
      }
      setDrag(null);
      setDropTarget(null);
      // The click that follows pointerup has been dispatched by now.
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        // Touch: moving before the hold completes is a scroll, not a drag.
        if (isTouch) {
          if (dist > 8) finish(false);
          return;
        }
        if (dist < 4) return;
        begin();
      }
      autoScroll();
      update();
    }
    function onUp(ev: PointerEvent) {
      if (ev.pointerId === pointerId) finish(true);
    }
    function onCancel(ev: PointerEvent) {
      if (ev.pointerId === pointerId) finish(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") finish(false);
    }
    // Once a touch drag has started, keep the finger from scrolling the page.
    function blockTouchScroll(ev: TouchEvent) {
      if (active) ev.preventDefault();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchmove", blockTouchScroll, { passive: false });
  }

  const selectClip = (id: string) => {
    if (!suppressClick.current) onSelect(id);
  };

  // The violet line showing where a dragged clip will land on a track.
  const insertionLine = (track: Track) =>
    drag && dropTarget?.track === track ? (
      <div
        aria-hidden
        className="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-violet-300 shadow-[0_0_8px_rgba(167,139,250,0.9)] z-20 pointer-events-none"
        style={{ left: insertionPx(dropTarget, drag.id) }}
      />
    ) : null;

  return (
    // tl-root sets --tl-gutter (the track header width) on the whole scroll
    // area, so the playhead below lines up with the ruler and clips.
    <div
      ref={scrollRef}
      className="relative flex-1 overflow-auto min-h-0 tl-scroll tl-root"
      onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
    >
      {/* Ruler */}
      <div className="h-6 border-b border-white/[0.06] sticky top-0 z-30 bg-[#0b0b12]/95 backdrop-blur select-none flex">
        <div className="w-24 sm:w-28 shrink-0 border-r border-white/[0.06] bg-[#0d0d14] flex items-center px-2 sticky left-0 z-10 text-[9px] font-mono text-neutral-600 uppercase tracking-widest">
          Time
        </div>
        <div
          className="relative h-full cursor-ew-resize flex-1 touch-none"
          style={{ width: trackWidthPx }}
          title="Click or drag to move the playhead"
          {...scrubHandlers}
        >
          {ruler.map((t, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 flex flex-col justify-between"
              style={{ left: t.t * pxPerSec }}
            >
              <span
                className={cn(
                  "block w-px",
                  t.major ? "h-3 bg-white/25" : "h-1.5 bg-white/10",
                )}
              />
              {t.label && (
                <span className="text-[9px] font-mono text-neutral-500 -translate-x-1/2 whitespace-nowrap">
                  {t.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Where the exported video ends */}
      {programEndMs > 0 && (programEndMs / 1000) * pxPerSec >= scrollLeft && (
        <div
          aria-hidden
          data-video-end
          className="pointer-events-none absolute top-0 bottom-0 z-[32] border-l border-dashed border-white/30"
          style={{ left: `calc(var(--tl-gutter, 96px) + ${(programEndMs / 1000) * pxPerSec}px)` }}
        >
          <span className="absolute top-1 left-1 text-[8.5px] font-mono uppercase tracking-wider text-white/45 whitespace-nowrap">
            End {formatPlaybackTime(programEndMs / 1000)}
          </span>
        </div>
      )}

      {/* Playhead (hidden while it's scrolled under the track headers) */}
      <div
        aria-hidden
        data-playhead
        className={cn(
          "pointer-events-none absolute top-0 bottom-0 z-40 transition-[left] duration-75",
          playheadPx < scrollLeft - 1 && "hidden",
        )}
        style={{ left: `calc(var(--tl-gutter, 96px) + ${playheadPx}px)` }}
      >
        <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.7)]" />
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-violet-400/90 shadow-[0_0_6px_rgba(139,92,246,0.55)]" />
      </div>

      <style>{`
        .tl-root { --tl-gutter: 96px; }
        @media (min-width: 640px) { .tl-root { --tl-gutter: 112px; } }
      `}</style>
      <div>
        {/* V1 A-Roll */}
        <TrackRow
          label="V1"
          name="A-Roll"
          innerWidth={trackWidthPx}
          contentHandlers={scrubHandlers}
          contentRef={(el) => {
            trackEls.current.aroll = el;
          }}
        >
          {insertionLine("aroll")}
          {aRoll.length === 0 ? (
            <div
              className={cn(
                "absolute inset-0 grid place-items-center text-[10px] italic pointer-events-none",
                dropTarget?.track === "aroll" ? "text-violet-400" : "text-neutral-600",
              )}
            >
              Drop A-roll clips here
            </div>
          ) : (
            aRoll.map((c, i) => (
              <TimelineClip
                key={c.id}
                clip={c}
                index={i}
                pxPerSec={pxPerSec}
                offsetMs={aLayout.offsets.get(c.id) ?? 0}
                selected={selectedClipId === c.id}
                dragOffset={drag?.id === c.id ? { x: drag.dx, y: drag.dy } : null}
                onSelect={() => selectClip(c.id)}
                onBodyPointerDown={(e) => startClipPress(c, e)}
                onTrim={onTrim}
                snapBoundariesMs={snapPointsFor(c, aLayout.offsets.get(c.id) ?? 0)}
                clipStartMs={aLayout.offsets.get(c.id) ?? 0}
                tone="primary"
                thumbnail={thumbnails[thumbnailKey(c)]}
              />
            ))
          )}
        </TrackRow>

        {/* V2 B-Roll */}
        <TrackRow
          label="V2"
          name="B-Roll"
          innerWidth={trackWidthPx}
          contentHandlers={scrubHandlers}
          contentRef={(el) => {
            trackEls.current.broll = el;
          }}
        >
          {insertionLine("broll")}
          {bRoll.length === 0 ? (
            <div
              className={cn(
                "absolute inset-0 grid place-items-center text-[10px] italic pointer-events-none",
                dropTarget?.track === "broll" ? "text-teal-400" : "text-neutral-600",
              )}
            >
              B-roll &amp; cutaways
            </div>
          ) : (
            bRoll.map((c, i) => (
              <TimelineClip
                key={c.id}
                clip={c}
                index={i}
                pxPerSec={pxPerSec}
                offsetMs={bLayout.offsets.get(c.id) ?? 0}
                selected={selectedClipId === c.id}
                dragOffset={drag?.id === c.id ? { x: drag.dx, y: drag.dy } : null}
                onSelect={() => selectClip(c.id)}
                onBodyPointerDown={(e) => startClipPress(c, e)}
                onTrim={onTrim}
                snapBoundariesMs={snapPointsFor(c, bLayout.offsets.get(c.id) ?? 0)}
                clipStartMs={bLayout.offsets.get(c.id) ?? 0}
                tone="teal"
                thumbnail={thumbnails[thumbnailKey(c)]}
                cutAtMs={cutAtFor(c)}
              />
            ))
          )}
        </TrackRow>

        {/* V3 Captions: the phrases the export burns in */}
        {captions && (
          <TrackRow
            label="V3"
            name="Captions"
            size="slim"
            innerWidth={trackWidthPx}
            contentHandlers={scrubHandlers}
          >
            {captionPhrases.length === 0 ? (
              <div className="absolute inset-0 flex items-center px-2 text-[10px] italic text-neutral-600 pointer-events-none">
                Captions appear here after a cloud render transcribes your clips
              </div>
            ) : (
              captionPhrases.map((p) => (
                <TrackLabel
                  key={p.key}
                  leftPx={(p.startMs / 1000) * pxPerSec}
                  widthPx={((p.endMs - p.startMs) / 1000) * pxPerSec}
                  text={p.text}
                  className="bg-violet-400/15 border-violet-400/30 text-violet-200 font-medium"
                />
              ))
            )}
          </TrackRow>
        )}

        {/* A1 Voice: the main track's own sound, which is what the export uses */}
        <TrackRow
          label="A1"
          name="Voice"
          note="From the A-roll"
          size="slim"
          innerWidth={trackWidthPx}
          contentHandlers={scrubHandlers}
        >
          {mainClips.map((c) => (
            <TrackLabel
              key={c.id}
              leftPx={((mainLayout.offsets.get(c.id) ?? 0) / 1000) * pxPerSec}
              widthPx={(clipVisibleMs(c) / 1000) * pxPerSec}
              text={baseName(c.filename)}
              title={`Voice from ${c.filename}`}
              className="bg-emerald-500/10 border-emerald-500/25 text-emerald-200/80"
            />
          ))}
        </TrackRow>

        {/* A2 Music: what the cloud export mixes in. Music plays from 0:00 and
            loops to the end of the video (ducked under the voice); an SFX
            plays at each cut between main clips, taking turns. */}
        {music && (
          <TrackRow
            label="A2"
            name="Music"
            note="Ducked under voice"
            size="slim"
            innerWidth={trackWidthPx}
            contentHandlers={scrubHandlers}
          >
            {audioClips.length === 0 ? (
              <div className="absolute inset-0 flex items-center px-2 text-[10px] italic text-neutral-600 pointer-events-none">
                No music or SFX uploaded
              </div>
            ) : (
              <>
                {musicBars.map((b) => (
                  <TrackLabel
                    key={b.key}
                    leftPx={(b.startMs / 1000) * pxPerSec}
                    widthPx={(b.lengthMs / 1000) * pxPerSec}
                    text={`♪ ${baseName(b.clip.filename)}${b.loop ? " (loop)" : ""}`}
                    title={`${b.clip.filename}: loops under the video, quieter while you speak`}
                    className="bg-amber-500/10 border-amber-400/30 text-amber-200/80"
                  />
                ))}
                {sfxMarks.map((m) => (
                  <TrackLabel
                    key={m.key}
                    leftPx={(m.startMs / 1000) * pxPerSec}
                    widthPx={(m.lengthMs / 1000) * pxPerSec}
                    text="SFX"
                    title={`${m.clip.filename} on the cut at ${formatPlaybackTime(m.cutMs / 1000)}`}
                    className="bg-pink-500/20 border-pink-400/40 text-pink-100 z-[1]"
                  />
                ))}
              </>
            )}
          </TrackRow>
        )}
      </div>
    </div>
  );
}

/* ---------- main export: TimelinePanel ---------- */
export interface TimelinePanelProps {
  projectTitle: string;
  aRoll: ClipRow[];
  bRoll: ClipRow[];
  videoClips: ClipRow[];
  selectedClipId: string | null;
  onSelect: (id: string) => void;
  onTrim: (id: string, trimInMs: number, trimOutMs: number | null) => void;
  captions: boolean;
  music: boolean;
  snapEnabled: boolean;
  onSnapToggle: () => void;
  pxPerSec: number;
  /** Zoom one step in (1) or out (-1). */
  onZoom: (direction: 1 | -1) => void;
  onPxPerSecChange: (v: number) => void;
  /** Playhead position on the timeline (not the player's raw file time). */
  currentTimeMs: number;
  onSeekMs: (clipId: string, absMs: number, atTimelineMs: number) => void;
  reorderMut: {
    mutate: (data: { order: { id: string; ordinal: number; role?: string }[] }) => void;
  };
  pushToHistory: (item: HistoryItem) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isSplitting?: boolean;
  isDuplicating?: boolean;
  isDeleting?: boolean;
  /** Caption phrases on the timeline (from the saved transcripts). */
  captionPhrases?: CaptionPhrase[];
  /** Uploaded music and SFX clips. */
  audioClips?: ClipRow[];
  /** Clip thumbnails by thumbnailKey(clip). */
  thumbnails?: Record<string, string>;
}

export function TimelinePanel({
  projectTitle,
  aRoll,
  bRoll,
  videoClips,
  selectedClipId,
  onSelect,
  onTrim,
  captions,
  music,
  snapEnabled,
  onSnapToggle,
  pxPerSec,
  onZoom,
  onPxPerSecChange,
  currentTimeMs,
  onSeekMs,
  reorderMut,
  pushToHistory,
  onSplit,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isSplitting,
  isDuplicating,
  isDeleting,
  captionPhrases = [],
  audioClips = [],
  thumbnails = {},
}: TimelinePanelProps) {
  // Length of the exported video: the A-roll, or the B-roll when there's no A-roll.
  const mainTrack = aRoll.length > 0 ? aRoll : bRoll;
  const programMs = mainTrack.reduce((sum, c) => sum + clipVisibleMs(c), 0);
  // Bumped by the Fit button; the tracks measure their width and zoom to fit.
  const [fitRequest, setFitRequest] = useState(0);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0b0b12]">
      {/* Toolbar */}
      <div className="h-11 px-2 sm:px-3 flex items-center gap-1 border-b border-white/[0.06] shrink-0 bg-[#0a0a12]">
        {/* Left cluster */}
        <ToolBtn icon={MousePointer2} title="Select (V)" active />
        <ToolBtn
          icon={Undo2}
          title="Undo (Ctrl+Z / ⌘Z)"
          onClick={onUndo}
          disabled={!canUndo}
        />
        <ToolBtn
          icon={Redo2}
          title="Redo (Ctrl+Y / ⌘Y)"
          onClick={onRedo}
          disabled={!canRedo}
        />
        <Divider />
        <ToolBtn
          icon={Scissors}
          title="Split at playhead (S)"
          accent
          onClick={onSplit}
          disabled={!selectedClipId || isSplitting}
        />
        <ToolBtn
          icon={Copy}
          title="Duplicate (⌘D)"
          onClick={onDuplicate}
          disabled={!selectedClipId || isDuplicating}
        />
        <ToolBtn
          icon={Trash2}
          title="Delete (⌫)"
          onClick={onDelete}
          disabled={!selectedClipId || isDeleting}
        />

        {/* Center: timecode */}
        <div className="hidden md:flex flex-1 items-center justify-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold truncate max-w-[220px]">
            {projectTitle}
          </span>
          <span className="text-[11px] font-mono text-violet-300/90 tabular-nums">
            {formatPlaybackTime(currentTimeMs / 1000)}
            <span className="text-neutral-500"> / {formatPlaybackTime(programMs / 1000)}</span>
          </span>
        </div>
        <div className="md:hidden flex-1" />

        {/* Right cluster: snap + zoom */}
        <ToolBtn
          icon={Magnet}
          title={snapEnabled ? "Magnetic snap: ON" : "Magnetic snap: OFF"}
          active={snapEnabled}
          onClick={onSnapToggle}
        />
        <Divider />
        <div className="flex items-center gap-2 pl-1 pr-0.5">
          <ToolBtn icon={Minus} title="Zoom out (-)" onClick={() => onZoom(-1)} />
          <Slider
            min={0}
            max={100}
            step={1}
            value={[zoomToSlider(pxPerSec)]}
            onValueChange={(v) => onPxPerSecChange(clampZoom(sliderToZoom(v[0])))}
            aria-label="Timeline zoom"
            className="w-16 sm:w-24"
          />
          <ToolBtn icon={Plus} title="Zoom in (+)" onClick={() => onZoom(1)} />
          <ToolBtn
            icon={Maximize2}
            title="Fit the whole video (Ctrl/⌘ + scroll to zoom)"
            onClick={() => setFitRequest((n) => n + 1)}
          />
        </div>
      </div>

      {/* Track area */}
      <TimelineTracks
        aRoll={aRoll}
        bRoll={bRoll}
        videoClips={videoClips}
        selectedClipId={selectedClipId}
        onSelect={onSelect}
        onTrim={onTrim}
        captions={captions}
        music={music}
        pxPerSec={pxPerSec}
        snapEnabled={snapEnabled}
        currentTimeMs={currentTimeMs}
        onSeekMs={onSeekMs}
        reorderMut={reorderMut}
        pushToHistory={pushToHistory}
        onZoomTo={onPxPerSecChange}
        fitRequest={fitRequest}
        captionPhrases={captionPhrases}
        audioClips={audioClips}
        thumbnails={thumbnails}
      />
    </div>
  );
}
