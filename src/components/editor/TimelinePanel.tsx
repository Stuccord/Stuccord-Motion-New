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
  Image as ImageIcon,
  Layers,
  Type,
  Mic,
  Music2,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  ArrowDownToLine,
  ArrowUpToLine,
  Keyboard,
  FoldHorizontal,
  Repeat,
  LocateFixed,
  Wand2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CLIP_DRAG_TYPE, type ClipRow } from "./types";
import { formatTimecode as formatPlaybackTime } from "./PlaybackControls";
import { clampZoom, sliderToZoom, zoomToSlider } from "./timeline-zoom";
import { FPS, formatFrameTimecode } from "./timecode";
import { thumbnailKey } from "@/lib/video-thumbnail";
import { IMAGE_MIME_TYPES, isImageFilename } from "@/lib/media-kind";
import {
  closeGapsPlacements,
  currentAudioPlacements,
  currentPlacements,
  fitStart,
  layoutTrack,
  musicBars as layoutMusicBars,
  musicStarts,
  planAudioPlacement,
  planPlacement,
  resetMusicPlacements,
  sfxPlays,
  type ClipPlacement,
} from "@/lib/timeline-layout";

/* ---------- shared types ---------- */
/** A track media can be added to, and when on it (null: after its last clip). */
export type AddMediaTarget = { track: "aroll" | "broll" | "music"; startMs: number | null };
/** What's being added: files from the computer, or a copy of a project clip. */
export type AddMediaSource = { files: File[] } | { clipId: string };

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

/** An on/off button in a track's header (e.g. captions or music in the export). */
type TrackToggle = {
  on: boolean;
  onToggle: () => void;
  /** What the button turns on or off, e.g. "captions". */
  what: string;
  kind: "eye" | "sound";
};

function TrackRow({
  label,
  name,
  note,
  icon: Icon,
  toneClass,
  toggle,
  onAdd,
  addLabel,
  trackKey,
  dropHighlight = false,
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
  icon: React.ElementType;
  /** Text colour of the track's icon and label, matching its clips. */
  toneClass: string;
  toggle?: TrackToggle;
  /** Opens a file picker to add media to this track. */
  onAdd?: () => void;
  /** What the + button adds, e.g. "video to V1". */
  addLabel?: string;
  /** Identifies the track's content area for drops and the right-click menu. */
  trackKey?: Track | "music";
  /** Media is being dragged over this track. */
  dropHighlight?: boolean;
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
        className="w-[88px] sm:w-[100px] shrink-0 border-r border-white/[0.06] bg-[#0d0d14] pl-2 pr-1 flex flex-col justify-center sticky left-0 z-[25]"
      >
        <div className="flex items-center gap-1 min-w-0">
          <Icon className={cn("w-3 h-3 shrink-0", toneClass)} aria-hidden />
          <span className={cn("text-[10px] font-mono font-bold", toneClass)}>{label}</span>
          <span className="text-[8.5px] text-neutral-500 uppercase tracking-wider truncate">
            {name}
          </span>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              aria-label={`Add ${addLabel}`}
              title={`Add ${addLabel}`}
              className="ml-auto shrink-0 w-4 h-4 rounded flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.08] transition"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Second line: what the track is for (or that it's off), and its button */}
        {(note || toggle) && (
          <div className="flex items-center gap-1 min-w-0 h-4">
            {toggle && !toggle.on ? (
              <span className="text-[8.5px] text-rose-400/80 truncate">Off in export</span>
            ) : (
              note && <span className="text-[8.5px] text-neutral-600 truncate">{note}</span>
            )}
            {toggle && (
              <button
                type="button"
                onClick={toggle.onToggle}
                aria-pressed={toggle.on}
                aria-label={`${toggle.on ? "Turn off" : "Turn on"} ${toggle.what} in the export`}
                title={`${toggle.on ? "Turn off" : "Turn on"} ${toggle.what} in the export`}
                className={cn(
                  "ml-auto shrink-0 w-4 h-4 rounded flex items-center justify-center transition",
                  toggle.on
                    ? "text-neutral-400 hover:text-white hover:bg-white/[0.06]"
                    : "text-rose-400 bg-rose-500/10 hover:bg-rose-500/20",
                )}
              >
                {toggle.kind === "eye" ? (
                  toggle.on ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3" />
                  )
                ) : toggle.on ? (
                  <Volume2 className="w-3 h-3" />
                ) : (
                  <VolumeX className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
      <div
        ref={contentRef}
        data-track={trackKey}
        className={cn(
          "relative transition-colors",
          toggle && !toggle.on && "opacity-35",
          dropHighlight && "bg-violet-500/10 ring-1 ring-inset ring-violet-400/50",
        )}
        style={{ width: innerWidth }}
        {...contentHandlers}
      >
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
      data-clip-id={clip.id}
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
          {isImageFilename(clip.filename) ? (
            <ImageIcon className="w-2.5 h-2.5 shrink-0" />
          ) : (
            <Film className="w-2.5 h-2.5 shrink-0" />
          )}
          <span className="truncate">
            {String(index + 1).padStart(2, "0")} · {baseName(clip.filename)}
          </span>
        </div>
        <div className="flex items-center justify-between text-white/75 font-mono tabular-nums">
          <span>{formatPlaybackTime(visibleMs / 1000)}</span>
          {sourceMs != null && sourceMs - visibleMs >= 50 && !isImageFilename(clip.filename) && (
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

/* ---------- A2 blocks ---------- */
// A piece of music or an SFX on the A2 row. Drag it to move where it plays;
// right-click for more.
function AudioBlock({
  leftPx,
  widthPx,
  shiftPx,
  text,
  title,
  className,
  audioId,
  audioKey,
  atMs,
  onCut,
  onPointerDown,
}: {
  leftPx: number;
  widthPx: number;
  /** How far it's being dragged (px). */
  shiftPx: number;
  text: string;
  title: string;
  className: string;
  audioId: string;
  audioKey: string;
  /** When it plays (ms), for the right-click menu. */
  atMs: number;
  /** An SFX playing automatically on a cut. */
  onCut?: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-timeline-clip
      data-audio-id={audioId}
      data-audio-key={audioKey}
      data-audio-at={atMs}
      data-audio-oncut={onCut ? "1" : undefined}
      onPointerDown={onPointerDown}
      onDragStart={(e) => e.preventDefault()}
      className={cn(
        "absolute top-1 bottom-1 rounded px-1.5 flex items-center text-[9.5px] leading-none truncate border select-none cursor-grab active:cursor-grabbing hover:brightness-125",
        shiftPx !== 0 && "z-10 ring-1 ring-white/60 shadow-lg",
        className,
      )}
      style={{
        left: leftPx,
        width: Math.max(4, widthPx - 1),
        transform: shiftPx ? `translateX(${shiftPx}px)` : undefined,
      }}
      title={title}
    >
      <span className="truncate pointer-events-none">{text}</span>
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
  /** Turns captions in the export on or off (the V3 header button). */
  onCaptionsToggle?: () => void;
  /** Turns music and SFX in the export on or off (the A2 header button). */
  onMusicToggle?: () => void;
  /** Adds files or a copy of a project clip to a track. */
  onAddMedia?: (target: AddMediaTarget, source: AddMediaSource) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  pxPerSec: number;
  snapEnabled: boolean;
  currentTimeMs: number;
  onSeekMs: (clipId: string, absMs: number, atTimelineMs: number) => void;
  reorderMut: {
    mutate: (data: {
      order: { id: string; ordinal: number; role?: string; start_ms?: number | null }[];
    }) => void;
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
  onCaptionsToggle,
  onMusicToggle,
  onAddMedia,
  onSplit,
  onDuplicate,
  onDelete,
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
  // Clip being dragged to a new place (with how far the pointer moved).
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  // Where the dragged clip would land: a track and a start time.
  const [dropTarget, setDropTarget] = useState<{ track: Track; startMs: number } | null>(null);
  const trackEls = useRef<Record<Track, HTMLDivElement | null>>({ aroll: null, broll: null });
  const musicTrackEl = useRef<HTMLDivElement | null>(null);
  // Files or a Media-panel clip being dragged over the tracks, and where
  // they'd land.
  const [mediaDrop, setMediaDrop] = useState<AddMediaTarget | null>(null);
  // Hidden file picker for the + buttons and the right-click menu.
  const fileInput = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<AddMediaTarget | null>(null);
  const pickFiles = (target: AddMediaTarget) => {
    const input = fileInput.current;
    if (!input || !onAddMedia) return;
    pickTarget.current = target;
    input.accept =
      target.track === "music" ? "audio/*" : ["video/*", ...IMAGE_MIME_TYPES].join(",");
    input.value = "";
    input.click();
  };
  // Right-click menu: where it opens, and on what.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    track: Track | "music" | null;
    clip: ClipRow | null;
    /** A song or SFX on A2, and when that piece plays. */
    audio: { clip: ClipRow; atMs: number; onCut: boolean } | null;
  } | null>(null);
  const lastPointerType = useRef<string>("mouse");
  // A drag ends with a click on whatever is under the pointer; don't let it
  // select a clip.
  const suppressClick = useRef(false);

  // Where each clip sits on its track (placed, or right after the one before).
  const aLayout = useMemo(() => {
    const { starts, endMs } = layoutTrack(aRoll, clipVisibleMs);
    return { offsets: starts, endMs, totalMs: Math.max(endMs, 10000) };
  }, [aRoll]);

  const bLayout = useMemo(() => {
    const { starts, endMs } = layoutTrack(bRoll, clipVisibleMs);
    return { offsets: starts, endMs, totalMs: Math.max(endMs, 5000) };
  }, [bRoll]);

  const totalMs = Math.max(aLayout.totalMs, bLayout.totalMs);

  // Where the exported video ends: the end of the main track (the A-roll,
  // or the B-roll when there is no A-roll). B-roll past it is cut.
  const mainClips = aRoll.length > 0 ? aRoll : bRoll;
  const mainLayout = aRoll.length > 0 ? aLayout : bLayout;
  const programEndMs = mainLayout.endMs;
  // The A2 row as the export mixes it (timeline-layout): music pieces, and
  // when each SFX plays (on cuts, or once where it was placed).
  const musicFiles = audioClips.filter((c) => c.role !== "sfx");
  const sfxFiles = audioClips.filter((c) => c.role === "sfx");
  const musicEndMs =
    programEndMs > 0 ? programEndMs : musicFiles.reduce((t, c) => t + clipVisibleMs(c), 0);
  const musicPieces = layoutMusicBars(musicFiles, clipVisibleMs, musicEndMs);
  const songStarts = new Map(
    musicStarts(musicFiles, clipVisibleMs).map((ms, i) => [musicFiles[i].id, ms]),
  );
  const musicPlaced = musicFiles.some((c) => c.start_ms != null);
  const cutsMs = mainClips.slice(1).map((c) => mainLayout.offsets.get(c.id) ?? 0);
  const sfxMarks = sfxPlays(sfxFiles, cutsMs).map((p) => ({
    ...p,
    // On a cut it leads in slightly, like the export.
    startMs: Math.max(0, p.atMs - (p.onCut ? 150 : 0)),
    lengthMs: Math.max(200, clipVisibleMs(p.clip)),
  }));
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
    // Counted in whole frames (no floating-point drift). Zoomed in far
    // enough, the small ticks mark every frame (or every 5th).
    const majorFrames = step * FPS;
    const minorFrames = pxPerSec >= 240 ? 1 : pxPerSec >= 120 ? 5 : minor * FPS;
    // Labels that would sit under the END marker's label are left out.
    const endPx = (programEndMs / 1000) * pxPerSec;
    const ticks: { t: number; label: string; major: boolean }[] = [];
    for (let f = 0; f <= (seconds + step) * FPS; f += minorFrames) {
      const t = f / FPS;
      const major = f % majorFrames === 0;
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
    // In a gap before the clip: its first frame.
    onSeekMs(target.id, (target.trim_in_ms ?? 0) + Math.max(0, ms - start), ms);
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
  // Width of the visible track area and of the track headers, for the
  // time navigator.
  const [view, setView] = useState({ width: 0, gutter: 88 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const gutter = gutterWidth(el);
      setView({ width: Math.max(0, el.clientWidth - gutter), gutter });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // gutterWidth only reads the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastFollowedMs = useRef(currentTimeMs);
  useEffect(() => {
    if (currentTimeMs === lastFollowedMs.current) return;
    lastFollowedMs.current = currentTimeMs;
    const el = scrollRef.current;
    if (!el) return;
    const gutter = el.querySelector<HTMLElement>("[data-track-header]")?.offsetWidth ?? 88;
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
    el.querySelector<HTMLElement>("[data-track-header]")?.offsetWidth ?? 88;
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
    const contentMs = Math.max(aLayout.endMs, bLayout.endMs);
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

  /** The video track row under the pointer, and the timeline time there (ms). */
  function trackAt(clientX: number, clientY: number) {
    for (const track of ["aroll", "broll"] as const) {
      const el = trackEls.current[track];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top || clientY > r.bottom) continue;
      return { track, ms: Math.max(0, ((clientX - r.left) / pxPerSec) * 1000) };
    }
    return null;
  }

  /** The other clips' spans on a track, for fitting a clip among them. */
  const spansOn = (track: Track, exceptId: string) =>
    trackClips(track)
      .filter((c) => c.id !== exceptId)
      .map((c) => {
        const start = trackLayout(track).offsets.get(c.id) ?? 0;
        return { start, end: start + clipVisibleMs(c) };
      })
      .sort((a, b) => a.start - b.start);

  /**
   * Where a clip dragged to `wantMs` on `track` lands: snapped to a clip edge,
   * the playhead or 0:00 when its start or end is near one, then moved to the
   * nearest spot where it fits (it stops at a neighbour's edge).
   */
  function landingStart(c: ClipRow, track: Track, wantMs: number) {
    const len = clipVisibleMs(c);
    let start = Math.max(0, wantMs);
    if (snapEnabled) {
      const threshold = (8 / pxPerSec) * 1000;
      const points = [0, currentTimeMs];
      for (const t of ["aroll", "broll"] as const) {
        for (const sp of spansOn(t, c.id)) points.push(sp.start, sp.end);
      }
      let best = threshold;
      for (const p of points) {
        if (Math.abs(p - start) < best) {
          best = Math.abs(p - start);
          start = p;
        } else if (Math.abs(p - (start + len)) < best) {
          best = Math.abs(p - (start + len));
          start = p - len;
        }
      }
    }
    return fitStart(spansOn(track, c.id), start, len);
  }

  /** Saves new clip placements, with undo. */
  function savePlacements(placements: ClipPlacement[], description: string) {
    const before = currentPlacements(aRoll, bRoll);
    const same = (a: ClipPlacement, b?: ClipPlacement) =>
      !!b && a.ordinal === b.ordinal && a.role === b.role && a.start_ms === b.start_ms;
    const beforeById = new Map(before.map((p) => [p.id, p]));
    // Dropped back where it was: nothing to save or undo.
    if (placements.every((p) => same(p, beforeById.get(p.id)))) return;
    pushToHistory({
      description,
      undo: () => reorderMut.mutate({ order: before }),
      redo: () => reorderMut.mutate({ order: placements }),
    });
    reorderMut.mutate({ order: placements });
  }

  /**
   * Moves a clip to a time on a track (changing its role if the track
   * changes). Every other clip stays where it is.
   */
  function moveClipTo(id: string, toTrack: Track, wantMs: number) {
    const clip = videoClips.find((c) => c.id === id);
    if (!clip) return;
    const { placements } = planPlacement(aRoll, bRoll, [clip], toTrack, wantMs, clipVisibleMs);
    savePlacements(placements, "Move clip");
  }

  // Gaps between A-roll clips (black and silence in the export).
  const aRollHasGaps = aRoll.some((c, i) => {
    const start = aLayout.offsets.get(c.id) ?? 0;
    const prevEnd =
      i === 0 ? 0 : (aLayout.offsets.get(aRoll[i - 1].id) ?? 0) + clipVisibleMs(aRoll[i - 1]);
    return start - prevEnd > 1;
  });
  const closeGaps = () => savePlacements(closeGapsPlacements(aRoll, bRoll), "Close gaps");

  /** Saves music/SFX placements, with undo. */
  function saveAudio(placements: ClipPlacement[], description: string) {
    const before = currentAudioPlacements(audioClips);
    const beforeById = new Map(before.map((p) => [p.id, p]));
    const unchanged = placements.every((p) => {
      const b = beforeById.get(p.id);
      return !!b && b.ordinal === p.ordinal && b.start_ms === p.start_ms;
    });
    if (unchanged) return;
    pushToHistory({
      description,
      undo: () => reorderMut.mutate({ order: before }),
      redo: () => reorderMut.mutate({ order: placements }),
    });
    reorderMut.mutate({ order: placements });
  }
  /** Puts a song's start, or an SFX, at a time (null: SFX back on every cut). */
  function placeAudio(clip: ClipRow, startMs: number | null) {
    saveAudio(
      planAudioPlacement(audioClips, clip.id, startMs, clipVisibleMs),
      clip.role === "sfx" ? "Move SFX" : "Move music",
    );
  }

  // A2 block being dragged: which song or SFX, which piece, and how far (px).
  const [audioDrag, setAudioDrag] = useState<{ id: string; key: string; dx: number } | null>(null);
  /**
   * Press on a piece of music or an SFX: drag sideways to move where it plays
   * (a song moves where it starts; an SFX playing on cuts becomes one sound
   * at the drop point). Mouse: after a few pixels; touch: press and hold.
   */
  function startAudioPress(
    e: React.PointerEvent<HTMLDivElement>,
    clip: ClipRow,
    key: string,
    originMs: number,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pointerId = e.pointerId;
    const isTouch = e.pointerType === "touch";
    const startX = e.clientX;
    const scroller = scrollRef.current;
    const startScroll = scroller?.scrollLeft ?? 0;
    let active = false;
    let lastX = startX;
    const dxPx = () => lastX - startX + ((scroller?.scrollLeft ?? 0) - startScroll);
    // Where it would play: snapped to 0:00, the playhead, a cut, the end or
    // another song's start when close to one.
    const landing = () => {
      let ms = Math.max(0, originMs + (dxPx() / pxPerSec) * 1000);
      if (snapEnabled) {
        const points = [0, currentTimeMs, programEndMs, ...cutsMs];
        for (const [id, at] of songStarts) if (id !== clip.id) points.push(at);
        let best = (8 / pxPerSec) * 1000;
        for (const p of points) {
          if (Math.abs(p - ms) < best) {
            best = Math.abs(p - ms);
            ms = p;
          }
        }
      }
      return Math.round(ms);
    };
    const begin = () => {
      active = true;
      suppressClick.current = true;
      setAudioDrag({ id: clip.id, key, dx: 0 });
    };
    const holdTimer = isTouch ? setTimeout(begin, 300) : null;
    const finish = (commit: boolean) => {
      if (holdTimer) clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", blockTouchScroll);
      if (active && commit) placeAudio(clip, landing());
      setAudioDrag(null);
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };
    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      if (!active) {
        if (isTouch) {
          if (Math.abs(lastX - startX) > 8) finish(false);
          return;
        }
        if (Math.abs(lastX - startX) < 4) return;
        begin();
      }
      // Show it where it will land (snapped).
      setAudioDrag({ id: clip.id, key, dx: ((landing() - originMs) / 1000) * pxPerSec });
    }
    function onUp(ev: PointerEvent) {
      if (ev.pointerId === pointerId) finish(true);
    }
    function onCancel(ev: PointerEvent) {
      if (ev.pointerId === pointerId) finish(false);
    }
    function blockTouchScroll(ev: TouchEvent) {
      if (active) ev.preventDefault();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", blockTouchScroll, { passive: false });
  }
  // How far a block is being dragged: all pieces of a dragged song move
  // together; an SFX moves on its own.
  const audioShift = (clip: ClipRow, key: string) =>
    audioDrag && audioDrag.id === clip.id && (clip.role !== "sfx" || audioDrag.key === key)
      ? audioDrag.dx
      : 0;

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

    const fromTrack: Track = c.role === "broll" ? "broll" : "aroll";
    const fromStart = trackLayout(fromTrack).offsets.get(c.id) ?? 0;
    // Where it would land: the track under the pointer, at its start moved
    // by however far the pointer has moved along the timeline.
    const landing = () => {
      const scrolled = (scroller?.scrollLeft ?? 0) - startScroll;
      const over = trackAt(last.x, last.y);
      if (!over) return null;
      const wantMs = fromStart + ((last.x - startX + scrolled) / pxPerSec) * 1000;
      return { track: over.track, startMs: landingStart(c, over.track, wantMs) };
    };
    const update = () => {
      const scrolled = (scroller?.scrollLeft ?? 0) - startScroll;
      setDrag({ id: c.id, dx: last.x - startX + scrolled, dy: last.y - startY });
      setDropTarget(landing());
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
      const gutter = scroller.querySelector<HTMLElement>("[data-track-header]")?.offsetWidth ?? 88;
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
        const target = landing();
        if (target) moveClipTo(c.id, target.track, target.startMs);
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

  // Where a dragged clip will land (a dashed outline), or where dropped
  // media will start (a line).
  const insertionLine = (track: Track) => {
    const dragged = drag ? videoClips.find((c) => c.id === drag.id) : undefined;
    if (dragged && dropTarget?.track === track) {
      return (
        <div
          aria-hidden
          data-landing
          className="absolute top-1 bottom-1 rounded-md border-2 border-dashed border-violet-300/80 bg-violet-400/10 z-20 pointer-events-none"
          style={{
            left: (dropTarget.startMs / 1000) * pxPerSec,
            width: Math.max(4, (clipVisibleMs(dragged) / 1000) * pxPerSec),
          }}
        />
      );
    }
    if (mediaDrop?.track === track && mediaDrop.startMs != null) {
      return (
        <div
          aria-hidden
          className="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-violet-300 shadow-[0_0_8px_rgba(167,139,250,0.9)] z-20 pointer-events-none"
          style={{ left: (mediaDrop.startMs / 1000) * pxPerSec }}
        />
      );
    }
    return null;
  };

  // Where dragged-in media would land: the time under the pointer on a video
  // track (moved to the nearest spot it fits once added), or the music track
  // (after its last file, for now).
  const mediaTargetAt = (clientX: number, clientY: number): AddMediaTarget | null => {
    const video = trackAt(clientX, clientY);
    if (video) return { track: video.track, startMs: Math.round(video.ms) };
    const r = musicTrackEl.current?.getBoundingClientRect();
    if (r && clientY >= r.top && clientY <= r.bottom) return { track: "music", startMs: null };
    return null;
  };
  const isMediaDrag = (e: React.DragEvent) =>
    !!onAddMedia &&
    (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes(CLIP_DRAG_TYPE));
  const mediaDragHandlers = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!isMediaDrag(e)) return;
      const target = mediaTargetAt(e.clientX, e.clientY);
      if (!target) {
        setMediaDrop(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setMediaDrop((cur) =>
        cur?.track === target.track && cur.startMs === target.startMs ? cur : target,
      );
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMediaDrop(null);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      setMediaDrop(null);
      if (!isMediaDrag(e) || !onAddMedia) return;
      const target = mediaTargetAt(e.clientX, e.clientY);
      if (!target) return;
      // Handled here: the page's own drop handler (upload anywhere) skips it.
      e.preventDefault();
      const clipId = e.dataTransfer.getData(CLIP_DRAG_TYPE);
      if (clipId) onAddMedia(target, { clipId });
      else if (e.dataTransfer.files.length) {
        onAddMedia(target, { files: Array.from(e.dataTransfer.files) });
      }
    },
  };

  // Right-click on a clip or a track (not a touch long-press, which picks
  // clips up instead).
  const openMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (lastPointerType.current === "touch" || drag) {
      e.preventDefault();
      return;
    }
    const el = e.target as HTMLElement;
    const trackEl = el.closest<HTMLElement>("[data-track]");
    const clipId = el.closest<HTMLElement>("[data-clip-id]")?.dataset.clipId;
    if (!trackEl && !clipId) return;
    e.preventDefault();
    const clip = clipId ? (videoClips.find((c) => c.id === clipId) ?? null) : null;
    if (clip) onSelect(clip.id);
    const audioEl = el.closest<HTMLElement>("[data-audio-id]");
    const audioClip = audioEl ? audioClips.find((c) => c.id === audioEl.dataset.audioId) : null;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      track: (trackEl?.dataset.track as Track | "music" | undefined) ?? null,
      clip,
      audio: audioClip
        ? {
            clip: audioClip,
            atMs: Number(audioEl!.dataset.audioAt ?? 0),
            onCut: audioEl!.dataset.audioOncut === "1",
          }
        : null,
    });
  };
  const trackName = (t: Track | "music") =>
    t === "aroll" ? "V1 A-roll" : t === "broll" ? "V2 B-roll" : "A2 Music";

  // Time navigator (like After Effects'): the whole video in one thin bar,
  // with a window over the part on screen. Drag the window to scroll, drag
  // its ends to zoom, click the bar to jump there.
  const viewStartMs = (scrollLeft / pxPerSec) * 1000;
  const viewEndMs = viewStartMs + (view.width / pxPerSec) * 1000;
  const navTotalMs = Math.max(totalMs, viewEndMs, 1000);
  const navPct = (ms: number) => `${Math.min(100, Math.max(0, (ms / navTotalMs) * 100))}%`;
  // Shows the time range [startMs, endMs] across the visible width.
  function showRange(startMs: number, endMs: number) {
    const el = scrollRef.current;
    if (!el || view.width <= 0) return;
    const next = clampZoom((view.width / Math.max(100, endMs - startMs)) * 1000);
    if (next === pxPerSecRef.current) {
      el.scrollLeft = Math.max(0, (startMs / 1000) * next);
    } else {
      zoomAnchor.current = { ms: Math.max(0, startMs), viewX: 0 };
      onZoomTo(next);
    }
  }
  function startNavDrag(e: React.PointerEvent<HTMLElement>, part: "window" | "start" | "end") {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const bar = (
      e.currentTarget.closest("[data-navigator]") as HTMLElement
    ).getBoundingClientRect();
    const startX = e.clientX;
    const el = scrollRef.current;
    // Read the scroll position itself: the scroll event may not have
    // updated scrollLeft (state) yet.
    const startScroll = el?.scrollLeft ?? 0;
    const startMs = (startScroll / pxPerSec) * 1000;
    const from = { start: startMs, end: startMs + (viewEndMs - viewStartMs) };
    const minSpan = 500;
    const move = (ev: PointerEvent) => {
      const dMs = ((ev.clientX - startX) / bar.width) * navTotalMs;
      if (part === "window") {
        if (el) el.scrollLeft = Math.max(0, startScroll + (dMs / 1000) * pxPerSecRef.current);
      } else if (part === "start") {
        showRange(Math.max(0, Math.min(from.end - minSpan, from.start + dMs)), from.end);
      } else {
        showRange(from.start, Math.max(from.start + minSpan, from.end + dMs));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const navigator = (
    <div className="h-5 shrink-0 flex border-b border-white/[0.06] bg-[#08080e] select-none">
      <div
        className="shrink-0 flex items-center px-2 text-[8px] font-mono uppercase tracking-widest text-neutral-600 border-r border-white/[0.06]"
        style={{ width: view.gutter }}
      >
        Nav
      </div>
      <div
        data-navigator
        className="relative flex-1 my-1 mx-1 rounded-sm bg-white/[0.03] cursor-pointer touch-none"
        title="Drag the window to scroll · drag its ends to zoom · click to jump"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Click outside the window: centre the view there.
          const r = e.currentTarget.getBoundingClientRect();
          const ms = ((e.clientX - r.left) / r.width) * navTotalMs;
          const span = viewEndMs - viewStartMs;
          const el = scrollRef.current;
          if (el) el.scrollLeft = Math.max(0, ((ms - span / 2) / 1000) * pxPerSec);
        }}
      >
        {/* The edit in miniature: main track on top, B-roll below */}
        {aRoll.map((c) => (
          <div
            key={c.id}
            className="absolute top-0 h-1/2 bg-violet-500/35 border-r border-[#08080e]"
            style={{
              left: navPct(aLayout.offsets.get(c.id) ?? 0),
              width: navPct(clipVisibleMs(c)),
            }}
          />
        ))}
        {bRoll.map((c) => (
          <div
            key={c.id}
            className="absolute bottom-0 h-1/2 bg-teal-500/35 border-r border-[#08080e]"
            style={{
              left: navPct(bLayout.offsets.get(c.id) ?? 0),
              width: navPct(clipVisibleMs(c)),
            }}
          />
        ))}
        <div
          aria-hidden
          className="absolute -top-0.5 -bottom-0.5 w-px bg-violet-300"
          style={{ left: navPct(currentTimeMs) }}
        />
        {/* The part on screen */}
        <div
          role="scrollbar"
          aria-orientation="horizontal"
          aria-label="Visible part of the timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(navTotalMs)}
          aria-valuenow={Math.round(viewStartMs)}
          className="absolute -top-0.5 -bottom-0.5 rounded-sm border border-white/50 bg-white/[0.08] hover:bg-white/[0.12] cursor-grab active:cursor-grabbing"
          style={{
            left: navPct(viewStartMs),
            width: navPct(viewEndMs - viewStartMs),
            minWidth: 10,
          }}
          onPointerDown={(e) => startNavDrag(e, "window")}
        >
          <span
            aria-label="Drag to zoom (start)"
            className="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-ew-resize rounded-l-sm bg-white/60"
            onPointerDown={(e) => startNavDrag(e, "start")}
          />
          <span
            aria-label="Drag to zoom (end)"
            className="absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-ew-resize rounded-r-sm bg-white/60"
            onPointerDown={(e) => startNavDrag(e, "end")}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {navigator}
      {/* tl-root sets --tl-gutter (the track header width) on the whole scroll
          area, so the playhead below lines up with the ruler and clips. */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto min-h-0 tl-scroll tl-root"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onPointerDownCapture={(e) => {
          lastPointerType.current = e.pointerType;
        }}
        onContextMenu={openMenu}
        {...mediaDragHandlers}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            if (files.length && pickTarget.current && onAddMedia) {
              onAddMedia(pickTarget.current, { files });
            }
          }}
        />
        {/* Right-click menu, opened where the pointer was */}
        <DropdownMenu open={!!menu} onOpenChange={(open) => !open && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              className="fixed w-0 h-0"
              style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52 text-xs">
            {menu?.clip ? (
              <>
                <DropdownMenuLabel className="text-[11px] truncate">
                  {baseName(menu.clip.filename)}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={onSplit}>
                  <Scissors className="w-3.5 h-3.5" /> Split at playhead
                  <DropdownMenuShortcut>S</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onDuplicate}>
                  <Copy className="w-3.5 h-3.5" /> Duplicate
                  <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
                </DropdownMenuItem>
                {/* Same time on the other track, or the nearest spot it fits. */}
                {menu.clip.role === "broll" ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      moveClipTo(menu.clip!.id, "aroll", bLayout.offsets.get(menu.clip!.id) ?? 0)
                    }
                  >
                    <ArrowUpToLine className="w-3.5 h-3.5" /> Move to V1 A-roll
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() =>
                      moveClipTo(menu.clip!.id, "broll", aLayout.offsets.get(menu.clip!.id) ?? 0)
                    }
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" /> Move to V2 B-roll
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onDelete}
                  className="text-rose-300 focus:text-rose-200 focus:bg-rose-500/15"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                  <DropdownMenuShortcut>Del</DropdownMenuShortcut>
                </DropdownMenuItem>
              </>
            ) : menu?.audio ? (
              <>
                <DropdownMenuLabel className="text-[11px] truncate">
                  {baseName(menu.audio.clip.filename)}
                </DropdownMenuLabel>
                {menu.audio.clip.role === "sfx" ? (
                  menu.audio.onCut ? (
                    <DropdownMenuItem
                      onSelect={() => placeAudio(menu.audio!.clip, Math.round(menu.audio!.atMs))}
                    >
                      <LocateFixed className="w-3.5 h-3.5" /> Play once here instead
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => placeAudio(menu.audio!.clip, null)}>
                      <Repeat className="w-3.5 h-3.5" /> Play on every cut instead
                    </DropdownMenuItem>
                  )
                ) : (
                  <>
                    <DropdownMenuItem
                      onSelect={() => placeAudio(menu.audio!.clip, Math.round(currentTimeMs))}
                    >
                      <LocateFixed className="w-3.5 h-3.5" /> Start at the playhead
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!musicPlaced}
                      onSelect={() =>
                        saveAudio(resetMusicPlacements(audioClips), "Music back to automatic")
                      }
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Music back to automatic
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => pickFiles({ track: "music", startMs: null })}>
                  <Plus className="w-3.5 h-3.5" /> Add music or SFX…
                </DropdownMenuItem>
              </>
            ) : menu?.track ? (
              <>
                <DropdownMenuItem
                  onSelect={() =>
                    pickFiles({
                      track: menu.track!,
                      startMs:
                        menu.track === "music"
                          ? null
                          : Math.round(trackAt(menu.x, menu.y)?.ms ?? 0),
                    })
                  }
                >
                  <Plus className="w-3.5 h-3.5" />
                  {menu.track === "music"
                    ? "Add music or SFX…"
                    : `Add video or image to ${trackName(menu.track)}…`}
                </DropdownMenuItem>
                {menu.track === "aroll" && (
                  <DropdownMenuItem onSelect={closeGaps} disabled={!aRollHasGaps}>
                    <FoldHorizontal className="w-3.5 h-3.5" /> Close gaps
                  </DropdownMenuItem>
                )}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Ruler */}
        <div className="h-6 border-b border-white/[0.06] sticky top-0 z-30 bg-[#0b0b12]/95 backdrop-blur select-none flex">
          <div className="w-[88px] sm:w-[100px] shrink-0 border-r border-white/[0.06] bg-[#0d0d14] flex items-center px-2 sticky left-0 z-10 text-[9px] font-mono text-neutral-600 uppercase tracking-widest">
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
            style={{ left: `calc(var(--tl-gutter, 88px) + ${(programEndMs / 1000) * pxPerSec}px)` }}
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
          style={{ left: `calc(var(--tl-gutter, 88px) + ${playheadPx}px)` }}
        >
          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.7)]" />
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-violet-400/90 shadow-[0_0_6px_rgba(139,92,246,0.55)]" />
        </div>

        <style>{`
          .tl-root { --tl-gutter: 88px; }
          @media (min-width: 640px) { .tl-root { --tl-gutter: 100px; } }
        `}</style>
        <div>
          {/* V1 A-Roll */}
          <TrackRow
            label="V1"
            name="A-Roll"
            icon={Film}
            toneClass="text-violet-400"
            size={aRoll.length === 0 ? "slim" : "clip"}
            trackKey="aroll"
            onAdd={onAddMedia && (() => pickFiles({ track: "aroll", startMs: null }))}
            addLabel="video or image to V1"
            dropHighlight={mediaDrop?.track === "aroll"}
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
                Drop or drag videos and images here
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
            icon={Layers}
            toneClass="text-teal-400"
            size={bRoll.length === 0 ? "slim" : "clip"}
            trackKey="broll"
            onAdd={onAddMedia && (() => pickFiles({ track: "broll", startMs: null }))}
            addLabel="video or image to V2"
            dropHighlight={mediaDrop?.track === "broll"}
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
                B-roll &amp; cutaways: drop videos or images here
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
          <TrackRow
            label="V3"
            name="Captions"
            note="Burned in"
            icon={Type}
            toneClass="text-violet-300"
            toggle={
              onCaptionsToggle && {
                on: captions,
                onToggle: onCaptionsToggle,
                what: "captions",
                kind: "eye",
              }
            }
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

          {/* A1 Voice: the main track's own sound, which is what the export uses */}
          <TrackRow
            label="A1"
            name="Voice"
            icon={Mic}
            toneClass="text-emerald-400"
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
          <TrackRow
            label="A2"
            name="Music"
            icon={Music2}
            toneClass="text-amber-400"
            toggle={
              onMusicToggle && {
                on: music,
                onToggle: onMusicToggle,
                what: "music and SFX",
                kind: "sound",
              }
            }
            note="Ducked under voice"
            size="slim"
            trackKey="music"
            onAdd={onAddMedia && (() => pickFiles({ track: "music", startMs: null }))}
            addLabel="music or SFX"
            dropHighlight={mediaDrop?.track === "music"}
            innerWidth={trackWidthPx}
            contentHandlers={scrubHandlers}
            contentRef={(el) => {
              musicTrackEl.current = el;
            }}
          >
            {audioClips.length === 0 ? (
              <div className="absolute inset-0 flex items-center px-2 text-[10px] italic text-neutral-600 pointer-events-none">
                Drop music or SFX here
              </div>
            ) : (
              <>
                {musicPieces.map((b) => (
                  <AudioBlock
                    key={b.key}
                    audioId={b.clip.id}
                    audioKey={b.key}
                    atMs={songStarts.get(b.clip.id) ?? b.startMs}
                    leftPx={(b.startMs / 1000) * pxPerSec}
                    widthPx={(b.lengthMs / 1000) * pxPerSec}
                    shiftPx={audioShift(b.clip, b.key)}
                    text={`♪ ${baseName(b.clip.filename)}${b.loop ? " (loop)" : ""}`}
                    title={`${b.clip.filename}: loops under the video, quieter while you speak. Drag to move where it starts; right-click for more.`}
                    className="bg-amber-500/10 border-amber-400/30 text-amber-200/80"
                    onPointerDown={(e) =>
                      startAudioPress(e, b.clip, b.key, songStarts.get(b.clip.id) ?? b.startMs)
                    }
                  />
                ))}
                {sfxMarks.map((m) => (
                  <AudioBlock
                    key={m.key}
                    audioId={m.clip.id}
                    audioKey={m.key}
                    atMs={m.atMs}
                    onCut={m.onCut}
                    leftPx={(m.startMs / 1000) * pxPerSec}
                    widthPx={(m.lengthMs / 1000) * pxPerSec}
                    shiftPx={audioShift(m.clip, m.key)}
                    text={m.onCut ? "SFX" : "SFX ●"}
                    title={
                      m.onCut
                        ? `${m.clip.filename} on the cut at ${formatPlaybackTime(m.atMs / 1000)}. Drag to play it once somewhere else.`
                        : `${m.clip.filename} once at ${formatPlaybackTime(m.atMs / 1000)}. Drag to move; right-click to put it back on every cut.`
                    }
                    className={cn(
                      "z-[1] text-pink-100",
                      m.onCut
                        ? "bg-pink-500/20 border-pink-400/40"
                        : "bg-pink-500/35 border-pink-300/70",
                    )}
                    // From where it's drawn, so it lands where it's dropped.
                    onPointerDown={(e) => startAudioPress(e, m.clip, m.key, m.startMs)}
                  />
                ))}
              </>
            )}
          </TrackRow>
        </div>
      </div>
    </>
  );
}

/* ---------- main export: TimelinePanel ---------- */
const TIME_FORMAT_KEY = "stuccord.timeFormat";

/** Listed in the toolbar's keyboard shortcuts popover. */
const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["J  K  L", "Back 1 s · stop · play (L again: 2×, 4×)"],
  ["← →", "One frame (Shift: 1 second)"],
  ["Page Up / Down", "One frame (Shift: 10 frames)"],
  ["Home / End", "Start / end"],
  ["S", "Split the selected clip at the playhead"],
  ["Alt + [  /  Alt + ]", "Trim the selected clip's start / end to the playhead"],
  ["[  /  ]", "Move the selected clip to start / end at the playhead"],
  ["Drag a clip", "Place it at any time (it stops at a neighbour's edge)"],
  ["Ctrl + D", "Duplicate the selected clip"],
  ["Del", "Delete the selected clip"],
  ["Ctrl + Z / Ctrl + Shift + Z", "Undo / redo"],
  ["+ / −", "Zoom in / out"],
  ["Ctrl + scroll", "Zoom at the pointer"],
  ["Right-click", "Clip and track menu"],
];
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
  /** Turns captions in the export on or off (the V3 header button). */
  onCaptionsToggle?: () => void;
  /** Turns music and SFX in the export on or off (the A2 header button). */
  onMusicToggle?: () => void;
  /** Adds files or a copy of a project clip to a track. */
  onAddMedia?: (target: AddMediaTarget, source: AddMediaSource) => void;
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
    mutate: (data: {
      order: { id: string; ordinal: number; role?: string; start_ms?: number | null }[];
    }) => void;
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
  onCaptionsToggle,
  onMusicToggle,
  onAddMedia,
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
  const programMs = layoutTrack(mainTrack, clipVisibleMs).endMs;
  // Bumped by the Fit button; the tracks measure their width and zoom to fit.
  const [fitRequest, setFitRequest] = useState(0);
  // Timecode as frames (0:00:05:12, like After Effects) or seconds (00:05.4).
  // Click it to switch; remembered in this browser.
  const [timeFormat, setTimeFormat] = useState<"frames" | "seconds">("frames");
  useEffect(() => {
    try {
      if (localStorage.getItem(TIME_FORMAT_KEY) === "seconds") setTimeFormat("seconds");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleTimeFormat = () => {
    const next = timeFormat === "frames" ? "seconds" : "frames";
    setTimeFormat(next);
    try {
      localStorage.setItem(TIME_FORMAT_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };
  const showTime = (ms: number) =>
    timeFormat === "frames" ? formatFrameTimecode(ms) : formatPlaybackTime(ms / 1000);

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
          <button
            type="button"
            onClick={toggleTimeFormat}
            className="text-[11px] font-mono text-violet-300/90 tabular-nums rounded px-1 hover:bg-white/[0.05]"
            title={
              timeFormat === "frames"
                ? "Hours:minutes:seconds:frames (30 fps). Click for seconds."
                : "Minutes:seconds. Click for frames."
            }
          >
            {showTime(currentTimeMs)}
            <span className="text-neutral-500"> / {showTime(programMs)}</span>
          </button>
        </div>
        <div className="md:hidden flex-1" />

        {/* Right cluster: shortcuts, snap + zoom */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3 text-xs">
            <p className="font-semibold text-neutral-100 mb-2">Keyboard shortcuts</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              {SHORTCUTS.map(([keys, what]) => (
                <React.Fragment key={keys}>
                  <dt className="font-mono text-[10.5px] text-violet-200 whitespace-nowrap">
                    {keys}
                  </dt>
                  <dd className="text-neutral-400">{what}</dd>
                </React.Fragment>
              ))}
            </dl>
          </PopoverContent>
        </Popover>
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
        onCaptionsToggle={onCaptionsToggle}
        onMusicToggle={onMusicToggle}
        onAddMedia={onAddMedia}
        onSplit={onSplit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
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
