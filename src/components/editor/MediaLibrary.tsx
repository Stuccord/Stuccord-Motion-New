import React, { useMemo, useState } from "react";
import { Film, Music2, Image as ImageIcon, Trash2, Check, Clock, HardDrive, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CLIP_DRAG_TYPE, type ClipRow } from "./types";
import { MediaUploadZone } from "./MediaUploadZone";
import { filesOf } from "./media-files";
import { IMAGE_DEFAULT_MS, isImageFilename } from "@/lib/media-kind";

interface MediaLibraryProps {
  clips: ClipRow[];
  /** Music and SFX clips. Listed for review and removal only, not selectable. */
  audioClips?: ClipRow[];
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onRemoveClip: (clipId: string) => void;
  /**
   * Removes an uploaded file: every clip on the timeline made from it (split
   * halves and copies share the file). Falls back to onRemoveClip per clip.
   */
  onRemoveFile?: (clipIds: string[]) => void;
  onUpload: (files: FileList | File[]) => void;
  isUploading?: boolean;
  /** Files being uploaded, shown under the Import button. */
  uploads?: React.ReactNode;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(durationMs?: number | null, durationSeconds?: number | null): string {
  const totalSec = durationMs ? Math.round(durationMs / 1000) : (durationSeconds ?? 0);
  if (!totalSec || totalSec <= 0) return "—";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// How long an image clip shows (its trimmed length), e.g. "3.0".
const imageSeconds = (clip: ClipRow) =>
  (((clip.trim_out_ms ?? IMAGE_DEFAULT_MS) - (clip.trim_in_ms ?? 0)) / 1000).toFixed(1);

// Drag a clip onto a timeline track to add another copy of it there.
const startClipDrag = (clip: ClipRow) => (e: React.DragEvent) => {
  e.dataTransfer.setData(CLIP_DRAG_TYPE, clip.id);
  e.dataTransfer.effectAllowed = "copy";
};

function AudioClipRow({ clip, onRemove }: { clip: ClipRow; onRemove: () => void }) {
  const isSfx = clip.role === "sfx";
  return (
    <div
      draggable
      onDragStart={startClipDrag(clip)}
      title="Drag onto the A2 Music track to add it again"
      className="group relative flex flex-col gap-1.5 p-2.5 rounded-lg border bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10 transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 shrink-0 rounded bg-white/[0.06] text-neutral-400 flex items-center justify-center">
            <Music2 className="w-3 h-3" />
          </span>
          <span
            className="text-xs font-medium truncate text-neutral-200 group-hover:text-white"
            title={clip.filename}
          >
            {clip.filename}
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onRemove}
              className="w-6 h-6 rounded flex items-center justify-center text-neutral-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              aria-label={`Remove audio ${clip.filename}`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            Remove audio
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500 font-mono">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <HardDrive className="w-2.5 h-2.5" />
            {formatBytes(clip.size_bytes)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {formatDuration(clip.duration_ms, clip.duration_seconds)}
          </span>
        </div>

        <Badge
          variant="outline"
          className={cn(
            "text-[9px] px-1.5 py-0 border leading-none tracking-wider uppercase font-semibold",
            isSfx
              ? "bg-pink-950/40 border-pink-500/30 text-pink-300"
              : "bg-amber-950/40 border-amber-500/30 text-amber-300",
          )}
        >
          {isSfx ? "SFX" : "Music"}
        </Badge>
      </div>
    </div>
  );
}

export function MediaLibrary({
  clips,
  audioClips = [],
  selectedClipId,
  onSelectClip,
  onRemoveClip,
  onRemoveFile,
  onUpload,
  isUploading = false,
  uploads,
}: MediaLibraryProps) {
  const [tab, setTab] = useState<"video" | "audio">("video");
  const files = useMemo(() => filesOf(clips), [clips]);
  const totalClips = files.length + audioClips.length;
  const removeFile = (ids: string[]) =>
    onRemoveFile ? onRemoveFile(ids) : ids.forEach((id) => onRemoveClip(id));
  const tabClass = (active: boolean) =>
    cn(
      "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition",
      active
        ? "bg-violet-600/20 text-violet-300 border border-violet-500/30 shadow-sm"
        : "text-neutral-500 hover:text-neutral-300 border border-transparent",
    );

  return (
    <TooltipProvider delayDuration={250}>
      <aside className="w-full h-full flex flex-col bg-[#0D0E16] border-r border-white/[0.08] select-none text-neutral-200">
        {/* Panel Header */}
        <div className="p-3 border-b border-white/[0.08] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-violet-400" />
            <h2 className="text-xs font-semibold text-neutral-200 tracking-wide uppercase">
              Media Assets
            </h2>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.05] text-neutral-400 border border-white/[0.06]">
            {totalClips} {totalClips === 1 ? "file" : "files"}
          </span>
        </div>

        {/* Media Category Tabs */}
        <div className="flex items-center gap-1 p-2 border-b border-white/[0.08] bg-[#0A0B11] shrink-0">
          <button
            type="button"
            onClick={() => setTab("video")}
            aria-pressed={tab === "video"}
            className={tabClass(tab === "video")}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Video ({files.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("audio")}
            aria-pressed={tab === "audio"}
            className={tabClass(tab === "audio")}
          >
            <Music2 className="w-3.5 h-3.5" />
            <span>Audio ({audioClips.length})</span>
          </button>

        </div>

        {/* Compact Upload button at top of list */}
        <div className="p-2.5 pb-1 shrink-0">
          <MediaUploadZone
            onUpload={onUpload}
            isUploading={isUploading}
            compact
          />
        </div>
        {uploads && <div className="shrink-0 max-h-56 overflow-y-auto">{uploads}</div>}

        {/* Clips List or Empty State */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 min-h-0">
          {tab === "audio" ? (
            <>
              <p className="px-1 pb-1 text-[11px] text-neutral-500 leading-normal">
                Cloud exports loop your music under the video (quieter while you speak) and play an
                SFX at each cut. Browser exports don&apos;t include them.
              </p>
              {audioClips.length === 0 ? (
                <p className="px-1 text-[11px] text-neutral-500 leading-normal">
                  No audio yet. Drop MP3, WAV or M4A files above to add music or sound effects.
                </p>
              ) : (
                audioClips.map((clip) => (
                  <AudioClipRow key={clip.id} clip={clip} onRemove={() => onRemoveClip(clip.id)} />
                ))
              )}
            </>
          ) : clips.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-4 text-center">
              <MediaUploadZone
                onUpload={onUpload}
                isUploading={isUploading}
                className="w-full"
              />
              <p className="mt-3 text-[11px] text-neutral-500 max-w-[220px] leading-normal">
                Drop your video clips and images here to add them to the timeline and AI preview
                canvas.
              </p>
            </div>
          ) : (
            files.map(({ clip, ids }, index) => {
              const isSelected = selectedClipId != null && ids.includes(selectedClipId);
              const pieces = ids.length;
              const isARoll = clip.role === "aroll" || clip.role === "auto";

              return (
                <div
                  key={clip.id}
                  onClick={() => onSelectClip(clip.id)}
                  draggable
                  onDragStart={startClipDrag(clip)}
                  title="Click to preview · drag onto a timeline track to add it there"
                  className={cn(
                    "group relative flex flex-col gap-1.5 p-2.5 rounded-lg border transition-all cursor-pointer active:cursor-grabbing select-none",
                    isSelected
                      ? "bg-violet-950/30 border-violet-500/50 shadow-md ring-1 ring-violet-500/20"
                      : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10",
                  )}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select clip ${clip.filename}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectClip(clip.id);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Clip order badge */}
                      <span className="w-5 h-5 shrink-0 rounded bg-white/[0.06] text-[10px] font-mono font-medium text-neutral-400 flex items-center justify-center">
                        {index + 1}
                      </span>
                      {/* Filename */}
                      <span
                        className={cn(
                          "text-xs font-medium truncate transition-colors",
                          isSelected ? "text-violet-200" : "text-neutral-200 group-hover:text-white",
                        )}
                        title={clip.filename}
                      >
                        {clip.filename}
                      </span>
                    </div>

                    {/* Delete action */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(ids);
                          }}
                          className="w-6 h-6 rounded flex items-center justify-center text-neutral-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={`Remove clip ${clip.filename}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        {pieces > 1
                          ? `Remove the file and its ${pieces} clips on the timeline`
                          : "Remove clip"}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Metadata Row */}
                  <div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-2.5 h-2.5" />
                        {formatBytes(clip.size_bytes)}
                      </span>
                      {isImageFilename(clip.filename) ? (
                        // An image shows for its trimmed length (its "file"
                        // length is only how far it can stretch).
                        <span className="flex items-center gap-1">
                          <ImageIcon className="w-2.5 h-2.5" />
                          {imageSeconds(clip)}s
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDuration(clip.duration_ms, clip.duration_seconds)}
                        </span>
                      )}
                    </div>

                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1.5 py-0 border leading-none tracking-wider uppercase font-semibold",
                        isARoll
                          ? "bg-violet-950/40 border-violet-500/30 text-violet-300"
                          : "bg-cyan-950/40 border-cyan-500/30 text-cyan-300",
                      )}
                    >
                      {isARoll ? "A-Roll" : "B-Roll"}
                    </Badge>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
