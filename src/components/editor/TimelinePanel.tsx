import React, { useMemo, useState } from "react";
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
  Film,
  Volume2,
  Lock,
  Eye,
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

function clipSourceMs(c: ClipRow): number | null {
  return c.duration_ms ?? null;
}

function formatTimecode(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

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
function TrackRow({
  label,
  name,
  innerWidth,
  children,
}: {
  label: string;
  name: string;
  innerWidth: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex border-b border-white/[0.05] min-h-[76px] hover:bg-white/[0.015] transition-colors">
      <div className="w-24 sm:w-28 shrink-0 border-r border-white/[0.06] bg-[#0d0d14] px-2.5 py-2 flex flex-col justify-center gap-1 sticky left-0 z-10">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-mono font-bold text-violet-400">{label}</span>
          <span className="text-[9px] text-neutral-500 uppercase tracking-wider truncate">
            {name}
          </span>
        </div>
        <div className="flex gap-0.5 -ml-1">
          <button
            title="Mute"
            className="w-5 h-5 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]"
          >
            <Volume2 className="w-3 h-3" />
          </button>
          <button
            title="Lock"
            className="w-5 h-5 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]"
          >
            <Lock className="w-3 h-3" />
          </button>
          <button
            title="Visibility"
            className="w-5 h-5 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]"
          >
            <Eye className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="relative p-2 min-h-[76px]" style={{ width: innerWidth }}>
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
  over,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onTrim,
  snapBoundariesMs,
  clipStartMs,
  tone,
}: {
  clip: ClipRow;
  index: number;
  pxPerSec: number;
  offsetMs: number;
  selected: boolean;
  over: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onTrim: (id: string, trimInMs: number, trimOutMs: number | null) => void;
  snapBoundariesMs: number[];
  clipStartMs: number;
  tone: "primary" | "teal";
}) {
  const sourceMs = clipSourceMs(clip);
  const trimIn = clip.trim_in_ms ?? 0;
  const trimOut = clip.trim_out_ms ?? sourceMs ?? trimIn + clipVisibleMs(clip);
  const [localTrimIn, setLocalTrimIn] = useState<number | null>(null);
  const [localTrimOut, setLocalTrimOut] = useState<number | null>(null);
  const effIn = localTrimIn ?? trimIn;
  const effOut = localTrimOut ?? trimOut;
  const visibleMs = Math.max(200, effOut - effIn);
  const widthPx = (visibleMs / 1000) * pxPerSec;
  const leftPx = (offsetMs / 1000) * pxPerSec;

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
    const maxOut = sourceMs ?? trimOut + 60_000;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startClientX;
      const deltaMs = Math.round((dx / pxPerSec) * 1000);
      if (edge === "left") {
        let next = Math.max(0, Math.min(startOut - 200, startIn + deltaMs));
        next = snapTo(next);
        setLocalTrimIn(next);
      } else {
        let next = Math.max(startIn + 200, Math.min(maxOut, startOut + deltaMs));
        next = snapTo(next);
        setLocalTrimOut(next);
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLocalTrimIn((li) => {
        setLocalTrimOut((lo) => {
          const nextIn = li ?? startIn;
          const nextOut = lo ?? startOut;
          onTrim(
            clip.id,
            nextIn,
            sourceMs != null && nextOut >= sourceMs ? null : nextOut,
          );
          return null;
        });
        return null;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop();
      }}
      onClick={onSelect}
      style={{
        position: "absolute",
        left: leftPx,
        width: Math.max(20, widthPx),
        top: 8,
        bottom: 8,
      }}
      className={cn(
        "rounded-md border bg-gradient-to-br cursor-grab active:cursor-grabbing overflow-hidden group select-none transition-shadow",
        gradient,
        selected &&
          "ring-2 ring-violet-400 shadow-[0_0_20px_-4px_rgba(139,92,246,0.5)]",
        over && "ring-1 ring-white/40 brightness-125",
      )}
    >
      {/* Trim handle left */}
      <div
        onPointerDown={(e) => beginTrim("left", e)}
        className={cn(
          "absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition",
          selected && "opacity-100",
        )}
        title="Drag to trim in"
      >
        <span className="w-[2px] h-4 bg-white/90 rounded-full" />
      </div>
      {/* Trim handle right */}
      <div
        onPointerDown={(e) => beginTrim("right", e)}
        className={cn(
          "absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition",
          selected && "opacity-100",
        )}
        title="Drag to trim out"
      >
        <span className="w-[2px] h-4 bg-white/90 rounded-full" />
      </div>

      {/* Label */}
      <div className="absolute inset-0 p-1.5 pl-3 pr-3 flex flex-col justify-between text-[9px] pointer-events-none">
        <div className="flex items-center gap-1 text-white/95 font-mono font-semibold truncate">
          <Film className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">
            {String(index + 1).padStart(2, "0")} · {clip.filename.replace(/\.[^.]+$/, "")}
          </span>
        </div>
        <div className="flex items-center justify-between text-white/70 font-mono tabular-nums">
          <span>{formatTimecode(visibleMs / 1000)}</span>
          {sourceMs != null && (
            <span className="text-white/40">/ {formatTimecode(sourceMs / 1000)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- audio waveform decoration ---------- */
function WaveformTrack({
  width,
  color,
  opacity = 1,
}: {
  width: number;
  color: string;
  opacity?: number;
}) {
  return (
    <div
      className={`absolute inset-y-2 left-0 rounded bg-gradient-to-r ${color} border flex items-center gap-[2px] overflow-hidden`}
      style={{ width: width - 8, opacity }}
    >
      {Array.from({ length: Math.floor((width - 16) / 4) }).map((_, i) => {
        const h = 20 + Math.abs(Math.sin(i * 0.4 + i * 0.11)) * 70;
        return (
          <div
            key={i}
            className="w-[3px] rounded-full shrink-0"
            style={{
              height: `${h}%`,
              background:
                color.includes("emerald")
                  ? "rgba(52,211,153,0.7)"
                  : "rgba(167,139,250,0.7)",
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------- TimelineTracks ---------- */
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
    mutate: (data: {
      project_id: string;
      order: { id: string; ordinal: number; role?: string }[];
    }) => void;
  };
  pushToHistory: (item: HistoryItem) => void;
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
}: TimelineTracksProps) {
  const [dragState, setDragState] = useState<{
    id: string;
    fromTrack: "aroll" | "broll";
  } | null>(null);
  const [overDropTarget, setOverDropTarget] = useState<{
    id: string | "__end_aroll__" | "__end_broll__";
  } | null>(null);

  const allOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let cur = 0;
    for (const c of videoClips) {
      offsets.set(c.id, cur);
      cur += clipVisibleMs(c);
    }
    return { offsets, totalMs: Math.max(cur, 10000) };
  }, [videoClips]);

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
  const trackWidthPx = Math.max(600, (totalMs / 1000) * pxPerSec);

  const ruler = useMemo(() => {
    const seconds = totalMs / 1000;
    const step =
      pxPerSec >= 120 ? 1 : pxPerSec >= 60 ? 2 : pxPerSec >= 30 ? 5 : 10;
    const ticks: { t: number; label: string; major: boolean }[] = [];
    for (let t = 0; t <= seconds + step; t += 1) {
      const major = t % step === 0;
      ticks.push({ t, label: major ? formatTimecode(t) : "", major });
    }
    return ticks;
  }, [totalMs, pxPerSec]);

  const playheadPx = (currentTimeMs / 1000) * pxPerSec;

  const snapBoundariesMs = useMemo(() => {
    if (!snapEnabled) return [];
    const pts: number[] = [currentTimeMs];
    for (const c of videoClips) {
      const off = allOffsets.offsets.get(c.id) ?? 0;
      pts.push(off, off + clipVisibleMs(c));
    }
    return pts;
  }, [snapEnabled, currentTimeMs, videoClips, allOffsets.offsets]);

  function handleRulerSeek(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollEl = e.currentTarget.closest(".tl-scroll") as HTMLElement | null;
    const scrollLeft = scrollEl?.scrollLeft ?? 0;
    const x = e.clientX - rect.left + scrollLeft;
    const atTimelineMs = Math.max(0, (x / pxPerSec) * 1000);

    let acc = 0;
    for (const c of aRoll) {
      const w = clipVisibleMs(c);
      if (atTimelineMs <= acc + w) {
        const absMs = (c.trim_in_ms ?? 0) + (atTimelineMs - acc);
        onSelect(c.id);
        onSeekMs(c.id, absMs, atTimelineMs);
        return;
      }
      acc += w;
    }
    onSeekMs("", 0, atTimelineMs);
  }

  function handleReorder(
    draggedId: string,
    fromTrack: "aroll" | "broll",
    targetId: string | "__end_aroll__" | "__end_broll__",
  ) {
    const draggedClip = videoClips.find((c) => c.id === draggedId);
    if (!draggedClip) return;

    const toTrack =
      targetId === "__end_broll__" || bRoll.some((c) => c.id === targetId)
        ? "broll"
        : "aroll";

    const newRole =
      toTrack === "broll"
        ? "broll"
        : draggedClip.role === "broll"
        ? "aroll"
        : draggedClip.role;

    const newARoll = aRoll.filter((c) => c.id !== draggedId);
    const newBRoll = bRoll.filter((c) => c.id !== draggedId);

    if (toTrack === "aroll") {
      const insertIdx =
        targetId === "__end_aroll__"
          ? newARoll.length
          : newARoll.findIndex((c) => c.id === targetId);
      newARoll.splice(
        insertIdx >= 0 ? insertIdx : newARoll.length,
        0,
        { ...draggedClip, role: newRole },
      );
    } else {
      const insertIdx =
        targetId === "__end_broll__"
          ? newBRoll.length
          : newBRoll.findIndex((c) => c.id === targetId);
      newBRoll.splice(
        insertIdx >= 0 ? insertIdx : newBRoll.length,
        0,
        { ...draggedClip, role: newRole as "broll" },
      );
    }

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
          project_id: draggedClip.id.split("-")[0] ?? "",
          order: prevOrder,
        });
      },
      redo: () => {
        reorderMut.mutate({
          project_id: draggedClip.id.split("-")[0] ?? "",
          order: combined,
        });
      },
    });

    reorderMut.mutate({
      project_id: draggedClip.id.split("-")[0] ?? "",
      order: combined,
    });
    setDragState(null);
    setOverDropTarget(null);
  }

  return (
    <div className="relative flex-1 overflow-auto min-h-0 tl-scroll">
      {/* Ruler */}
      <div className="h-6 border-b border-white/[0.06] sticky top-0 z-10 bg-[#0b0b12]/95 backdrop-blur select-none flex">
        <div className="w-24 sm:w-28 shrink-0 border-r border-white/[0.06] bg-[#0d0d14] flex items-center px-2 text-[9px] font-mono text-neutral-600 uppercase tracking-widest">
          Time
        </div>
        <div
          className="relative h-full cursor-crosshair flex-1"
          style={{ width: trackWidthPx }}
          onPointerDown={handleRulerSeek}
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

      {/* Playhead */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 z-20 transition-[left] duration-75"
        style={{ left: `calc(var(--tl-gutter, 96px) + ${playheadPx}px)` }}
      >
        <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.7)]" />
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-violet-400/90 shadow-[0_0_6px_rgba(139,92,246,0.55)]" />
      </div>

      <style>{`
        .tl-root { --tl-gutter: 96px; }
        @media (min-width: 640px) { .tl-root { --tl-gutter: 112px; } }
      `}</style>
      <div className="tl-root">
        {/* V1 A-Roll */}
        <TrackRow label="V1" name="A-Roll" innerWidth={trackWidthPx}>
          <div
            className="absolute inset-y-2 right-0 w-12 z-10"
            onDragOver={(e) => {
              e.preventDefault();
              setOverDropTarget({ id: "__end_aroll__" });
            }}
            onDragLeave={() => setOverDropTarget(null)}
            onDrop={() =>
              dragState &&
              handleReorder(dragState.id, dragState.fromTrack, "__end_aroll__")
            }
          />
          {aRoll.length === 0 ? (
            <div
              className={cn(
                "absolute inset-0 grid place-items-center text-[10px] italic pointer-events-none",
                overDropTarget?.id === "__end_aroll__"
                  ? "text-violet-400"
                  : "text-neutral-600",
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
                over={overDropTarget?.id === c.id}
                onSelect={() => onSelect(c.id)}
                onDragStart={() => setDragState({ id: c.id, fromTrack: "aroll" })}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverDropTarget({ id: c.id });
                }}
                onDragLeave={() => setOverDropTarget(null)}
                onDrop={() =>
                  dragState && handleReorder(dragState.id, dragState.fromTrack, c.id)
                }
                onTrim={onTrim}
                snapBoundariesMs={snapEnabled ? snapBoundariesMs : []}
                clipStartMs={aLayout.offsets.get(c.id) ?? 0}
                tone="primary"
              />
            ))
          )}
        </TrackRow>

        {/* V2 B-Roll */}
        <TrackRow label="V2" name="B-Roll" innerWidth={trackWidthPx}>
          <div
            className="absolute inset-y-2 right-0 w-12 z-10"
            onDragOver={(e) => {
              e.preventDefault();
              setOverDropTarget({ id: "__end_broll__" });
            }}
            onDragLeave={() => setOverDropTarget(null)}
            onDrop={() =>
              dragState &&
              handleReorder(dragState.id, dragState.fromTrack, "__end_broll__")
            }
          />
          <div
            className="absolute inset-0 z-0"
            onDragOver={(e) => {
              if (dragState?.fromTrack === "aroll") {
                e.preventDefault();
                setOverDropTarget({ id: "__end_broll__" });
              }
            }}
            onDrop={() =>
              dragState &&
              handleReorder(dragState.id, dragState.fromTrack, "__end_broll__")
            }
          />
          {bRoll.length === 0 ? (
            <div
              className={cn(
                "absolute inset-0 grid place-items-center text-[10px] italic pointer-events-none",
                overDropTarget?.id === "__end_broll__"
                  ? "text-teal-400"
                  : "text-neutral-600",
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
                over={overDropTarget?.id === c.id}
                onSelect={() => onSelect(c.id)}
                onDragStart={() =>
                  setDragState({ id: c.id, fromTrack: "broll" })
                }
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverDropTarget({ id: c.id });
                }}
                onDragLeave={() => setOverDropTarget(null)}
                onDrop={() =>
                  dragState &&
                  handleReorder(dragState.id, dragState.fromTrack, c.id)
                }
                onTrim={onTrim}
                snapBoundariesMs={snapEnabled ? snapBoundariesMs : []}
                clipStartMs={bLayout.offsets.get(c.id) ?? 0}
                tone="teal"
              />
            ))
          )}
        </TrackRow>

        {/* A1 Audio */}
        <TrackRow label="A1" name="Audio" innerWidth={trackWidthPx}>
          <WaveformTrack
            width={trackWidthPx}
            color="from-emerald-500/10 to-transparent border-emerald-500/20"
          />
        </TrackRow>

        {/* V3 Captions */}
        {captions && (
          <TrackRow label="V3" name="Captions" innerWidth={trackWidthPx}>
            <div className="absolute inset-y-2 left-0 flex gap-1.5 items-center">
              {["HOOK", "PROOF", "PAYOFF", "CTA"].map((t, i) => (
                <div
                  key={i}
                  style={{ marginLeft: i === 0 ? 4 : 0, width: 120 }}
                  className="h-8 px-2 py-1 rounded bg-violet-400/15 border border-violet-400/30 text-violet-300 text-[10px] font-bold tracking-wider grid place-items-center"
                >
                  T · {t}
                </div>
              ))}
            </div>
          </TrackRow>
        )}

        {/* A2 Music */}
        {music && (
          <TrackRow label="A2" name="Music" innerWidth={trackWidthPx}>
            <WaveformTrack
              width={trackWidthPx}
              color="from-violet-500/10 to-transparent border-violet-500/20"
              opacity={0.7}
            />
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
  onZoom: (delta: number) => void;
  onPxPerSecChange: (v: number) => void;
  currentTimeMs: number;
  currentTimeSec: number;
  onSeekMs: (clipId: string, absMs: number, atTimelineMs: number) => void;
  reorderMut: {
    mutate: (data: {
      project_id: string;
      order: { id: string; ordinal: number; role?: string }[];
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
  currentTimeSec,
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
}: TimelinePanelProps) {
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
            {formatTimecode(currentTimeSec)}
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
          <ToolBtn icon={Minus} title="Zoom out (-)" onClick={() => onZoom(-20)} />
          <Slider
            min={8}
            max={240}
            step={4}
            value={[pxPerSec]}
            onValueChange={(v) => onPxPerSecChange(v[0])}
            aria-label="Timeline zoom"
            className="w-16 sm:w-24"
          />
          <ToolBtn icon={Plus} title="Zoom in (+)" onClick={() => onZoom(20)} />
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
      />
    </div>
  );
}
