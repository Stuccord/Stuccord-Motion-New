import React, { useState } from "react";
import {
  Film,
  Scissors,
  Copy,
  Trash2,
  Clock,
  HardDrive,
  Calendar,
  X,
  RotateCcw,
  Check,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { IMAGE_DEFAULT_MS, isAudioRole, isImageFilename } from "@/lib/media-kind";
import {
  cleanTransform,
  IDENTITY_TRANSFORM,
  isIdentity,
  parseTransform,
  type ClipTransform,
} from "@/lib/clip-transform";
import type { ClipRow } from "./types";
import { clipVisibleMs } from "./TimelinePanel";
import { formatTimecode } from "./PlaybackControls";

export interface ClipInspectorProps {
  clip: ClipRow;
  onDeselect: () => void;
  onSplit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onTrim?: (id: string, trimInMs: number, trimOutMs: number | null) => void;
  /** Moves, resizes or rotates the clip in the frame (null: its default fit). */
  onTransform?: (transform: ClipTransform | null) => void;
  isSplitting?: boolean;
  isDuplicating?: boolean;
  isDeleting?: boolean;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The clip's track, named as the timeline names it. */
function trackBadge(role: string): { label: string; className: string } {
  if (role === "broll")
    return { label: "V2 · B-Roll", className: "bg-teal-950/40 border-teal-500/30 text-teal-300" };
  if (role === "music")
    return { label: "A2 · Music", className: "bg-amber-950/40 border-amber-500/30 text-amber-300" };
  if (role === "sfx")
    return { label: "A2 · SFX", className: "bg-amber-950/40 border-amber-500/30 text-amber-300" };
  if (role === "voiceover")
    return { label: "VO · Voiceover", className: "bg-sky-950/40 border-sky-500/30 text-sky-300" };
  return {
    label: "V1 · A-Roll",
    className: "bg-violet-950/40 border-violet-500/30 text-violet-300",
  };
}

/**
 * Position X/Y (share of the frame from its centre, in %), Scale (% of the
 * default fit) and Rotation (°), each saved when you press Enter or leave
 * the box.
 */
function TransformFields({
  transform,
  onChange,
}: {
  transform: ClipTransform | null;
  onChange: (transform: ClipTransform | null) => void;
}) {
  const t = transform ?? IDENTITY_TRANSFORM;
  const fields = [
    { key: "x", label: "X", unit: "%", value: t.x * 100, toValue: (n: number) => n / 100 },
    { key: "y", label: "Y", unit: "%", value: t.y * 100, toValue: (n: number) => n / 100 },
    {
      key: "scale",
      label: "Scale",
      unit: "%",
      value: t.scale * 100,
      toValue: (n: number) => n / 100,
    },
    { key: "rotation", label: "Rotate", unit: "°", value: t.rotation, toValue: (n: number) => n },
  ] as const;
  const save = (key: (typeof fields)[number]["key"], typed: string) => {
    const field = fields.find((f) => f.key === key)!;
    const n = Number(typed.replace(/[%°\s]/g, ""));
    if (!Number.isFinite(n) || Math.abs(n - field.value) < 0.005) return;
    const next = cleanTransform({ ...t, [key]: field.toValue(n) });
    onChange(isIdentity(next) ? null : next);
  };
  return (
    <div className="space-y-2 pt-2 border-t border-white/[0.06]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold font-mono">
          Transform
        </span>
        {transform && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1 font-mono transition"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Reset
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-0.5">
            <span className="text-[9px] text-neutral-500 uppercase font-mono">{f.label}</span>
            <div className="relative">
              <input
                // A fresh box when the saved value changes (e.g. after a drag).
                key={`${f.key}:${f.value.toFixed(2)}`}
                defaultValue={Number(f.value.toFixed(1))}
                inputMode="decimal"
                aria-label={`${f.label} (${f.unit})`}
                onBlur={(e) => save(f.key, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    e.currentTarget.value = String(Number(f.value.toFixed(1)));
                    e.currentTarget.blur();
                  }
                  // Typing here shouldn't trigger the editor's shortcuts.
                  e.stopPropagation();
                }}
                className="w-full h-7 rounded bg-white/[0.04] border border-white/[0.08] pl-1.5 pr-4 text-[11px] font-mono text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
              />
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-neutral-500 pointer-events-none">
                {f.unit}
              </span>
            </div>
          </label>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500 leading-normal px-0.5">
        Or drag the clip in the preview: corners resize it, the round arrow rotates it.
      </p>
    </div>
  );
}

export function ClipInspector({
  clip,
  onDeselect,
  onSplit,
  onDuplicate,
  onDelete,
  onTrim,
  onTransform,
  isSplitting = false,
  isDuplicating = false,
  isDeleting = false,
}: ClipInspectorProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  const trimIn = clip.trim_in_ms ?? 0;
  const trimOut = clip.trim_out_ms;
  const sourceDurationMs = clip.duration_ms;
  const effectiveMs = clipVisibleMs(clip);
  const badge = trackBadge(clip.role);
  // An image has no length of its own: it's shown for as long as it's
  // stretched, and "untrimmed" means its default length, not the 60 s limit.
  const isImage = isImageFilename(clip.filename);
  const isTrimmed = isImage
    ? trimIn > 0 || (trimOut ?? IMAGE_DEFAULT_MS) !== IMAGE_DEFAULT_MS
    : trimIn > 0 || (trimOut != null && sourceDurationMs != null && trimOut < sourceDurationMs);
  // Where the clip stops in its file: the trim, or the file's end.
  const outMs = trimOut ?? sourceDurationMs ?? null;

  const handleResetTrim = () => {
    if (onTrim) {
      onTrim(clip.id, 0, isImage ? IMAGE_DEFAULT_MS : null);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className="flex flex-col h-full min-h-0 bg-[#0D0E16] text-neutral-200 select-none font-sans"
        aria-label="Clip Inspector"
      >
        {/* Header */}
        <div className="h-10 px-3 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-[#0A0B11]">
          <div className="flex items-center gap-2 min-w-0">
            <Film className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-200 truncate">
              Clip Inspector
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onDeselect}
                className="w-6 h-6 rounded flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition"
                aria-label="Close Inspector and return to AI Studio"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              Deselect clip (Return to AI Studio)
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Scrollable Inspector Body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs min-h-0">
          {/* Clip Identity Card */}
          <div className="rounded-lg p-3 bg-white/[0.02] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold font-mono">
                Source File
              </span>
              {/* Role Badge (Read-only) */}
              <Badge
                variant="outline"
                className={cn(
                  "text-[9px] px-1.5 py-0 border font-mono uppercase tracking-wider shrink-0",
                  badge.className,
                )}
              >
                {badge.label}
              </Badge>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="font-medium text-neutral-100 line-clamp-2 break-words text-xs leading-snug hover:text-white transition cursor-default"
                  title={clip.filename}
                >
                  {clip.filename}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs break-all">
                {clip.filename}
              </TooltipContent>
            </Tooltip>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/[0.04] text-[11px] text-neutral-400 font-mono">
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3 h-3 text-neutral-500 shrink-0" />
                <span>{formatBytes(clip.size_bytes)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-neutral-500 shrink-0" />
                <span>
                  {isImage
                    ? "Image"
                    : sourceDurationMs
                      ? formatTimecode(sourceDurationMs / 1000)
                      : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Timing & Trim Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold font-mono">
                Timing &amp; Playback
              </span>
              {isTrimmed && onTrim && (
                <button
                  type="button"
                  onClick={handleResetTrim}
                  className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1 font-mono transition"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset Trim
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center font-mono">
              <div className="p-1.5 rounded bg-white/[0.02]">
                <div className="text-[9px] text-neutral-500 uppercase">Trim In</div>
                <div className="text-xs font-semibold text-neutral-200 mt-0.5">
                  {formatTimecode(trimIn / 1000)}
                </div>
              </div>
              <div className="p-1.5 rounded bg-white/[0.02]">
                <div className="text-[9px] text-neutral-500 uppercase">Trim Out</div>
                <div className="text-xs font-semibold text-neutral-200 mt-0.5">
                  {outMs != null ? formatTimecode(outMs / 1000) : "End"}
                </div>
              </div>
              <div className="p-1.5 rounded bg-violet-950/20 border border-violet-500/20">
                <div className="text-[9px] text-violet-400 uppercase">Duration</div>
                <div className="text-xs font-semibold text-violet-200 mt-0.5">
                  {formatTimecode(effectiveMs / 1000)}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-neutral-500 leading-normal px-0.5">
              Drag the clip&apos;s edges on the timeline to trim it, or press Alt+[ / Alt+] to trim
              to the playhead.
            </p>
          </div>

          {/* Transform: where the clip sits in the frame (also in the preview's box) */}
          {onTransform && !isAudioRole(clip.role) && (
            <TransformFields
              key={clip.id}
              transform={parseTransform(clip.transform)}
              onChange={onTransform}
            />
          )}

          {/* Real Actions Section */}
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold font-mono">
              Clip Operations
            </span>

            <div className="grid grid-cols-2 gap-2">
              {/* Split Action */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSplit}
                disabled={isSplitting}
                className="h-8 bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.08] text-neutral-200 hover:text-white text-xs justify-start gap-2"
              >
                <Scissors className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span>{isSplitting ? "Splitting…" : "Split at Playhead"}</span>
              </Button>

              {/* Duplicate Action */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDuplicate}
                disabled={isDuplicating}
                className="h-8 bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.08] text-neutral-200 hover:text-white text-xs justify-start gap-2"
              >
                <Copy className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>{isDuplicating ? "Duplicating…" : "Duplicate Clip"}</span>
              </Button>
            </div>

            {/* Delete Action with Confirmation */}
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDeleting}
                  className="w-full h-8 bg-red-950/20 border-red-500/20 hover:bg-red-950/40 hover:border-red-500/40 text-red-300 text-xs justify-center gap-2 transition"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>Delete from Timeline</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-[#12131C] border-white/10 text-neutral-100 max-w-sm">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    Delete Clip from Project?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-neutral-400">
                    This will remove &ldquo;<span className="text-neutral-200 font-mono">{clip.filename}</span>&rdquo; from the timeline and project assets. This action can be undone with Ctrl+Z.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-0">
                  <AlertDialogCancel className="h-8 text-xs bg-white/[0.05] border-white/10 text-neutral-300 hover:bg-white/10 hover:text-white">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (onDelete) onDelete();
                    }}
                    className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white font-medium"
                  >
                    Delete Clip
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
