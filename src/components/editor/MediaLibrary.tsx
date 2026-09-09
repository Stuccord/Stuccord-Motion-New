import React from "react";
import { Film, Music2, Image as ImageIcon, Trash2, Check, Clock, HardDrive, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClipRow } from "./types";
import { MediaUploadZone } from "./MediaUploadZone";

interface MediaLibraryProps {
  clips: ClipRow[];
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onRemoveClip: (clipId: string) => void;
  onUpload: (files: FileList | File[]) => void;
  isUploading?: boolean;
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

export function MediaLibrary({
  clips,
  selectedClipId,
  onSelectClip,
  onRemoveClip,
  onUpload,
  isUploading = false,
}: MediaLibraryProps) {
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
            {clips.length} {clips.length === 1 ? "clip" : "clips"}
          </span>
        </div>

        {/* Media Category Tabs (Honest disabled states for audio & image panels) */}
        <div className="flex items-center gap-1 p-2 border-b border-white/[0.08] bg-[#0A0B11] shrink-0">
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium bg-violet-600/20 text-violet-300 border border-violet-500/30 shadow-sm"
          >
            <Film className="w-3.5 h-3.5 text-violet-400" />
            <span>Video ({clips.length})</span>
          </button>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium text-neutral-500 hover:text-neutral-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Music2 className="w-3.5 h-3.5" />
                <span>Audio</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Audio uploads coming in Phase 2
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium text-neutral-500 hover:text-neutral-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Panels</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Manga panel images coming in Phase 2
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Compact Upload button at top of list */}
        <div className="p-2.5 pb-1 shrink-0">
          <MediaUploadZone
            onUpload={onUpload}
            isUploading={isUploading}
            compact
          />
        </div>

        {/* Clips List or Empty State */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 min-h-0">
          {clips.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-4 text-center">
              <MediaUploadZone
                onUpload={onUpload}
                isUploading={isUploading}
                className="w-full"
              />
              <p className="mt-3 text-[11px] text-neutral-500 max-w-[220px] leading-normal">
                Drop your raw video clips here to add them to the timeline and AI preview canvas.
              </p>
            </div>
          ) : (
            clips.map((clip, index) => {
              const isSelected = selectedClipId === clip.id;
              const isARoll = clip.role === "aroll" || clip.role === "auto";

              return (
                <div
                  key={clip.id}
                  onClick={() => onSelectClip(clip.id)}
                  className={cn(
                    "group relative flex flex-col gap-1.5 p-2.5 rounded-lg border transition-all cursor-pointer select-none",
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
                            onRemoveClip(clip.id);
                          }}
                          className="w-6 h-6 rounded flex items-center justify-center text-neutral-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={`Remove clip ${clip.filename}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        Remove clip
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
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatDuration(clip.duration_ms, clip.duration_seconds)}
                      </span>
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
