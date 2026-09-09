import React, { useRef, useState } from "react";
import { MonitorPlay, Sparkles, ChevronLeft, ChevronRight, Loader2, Film, SplitSquareVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AspectRatio, ViewMode } from "./types";
import { PlaybackControls } from "./PlaybackControls";

interface PreviewCanvasProps {
  aspectRatio: AspectRatio;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  programUrl: string | null;
  sourceUrl: string | null;
  selectedClipFilename?: string | null;
  hasClips: boolean;
  isRendering?: boolean;
  renderProgress?: number;
  renderStageMessage?: string | null;
  // Playback state
  playing: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  onSeek: (percent: number) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  muted: boolean;
  onToggleMute: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sourceVideoRef: React.RefObject<HTMLVideoElement | null>;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (duration: number) => void;
}

export function PreviewCanvas({
  aspectRatio,
  viewMode,
  onViewModeChange,
  programUrl,
  sourceUrl,
  selectedClipFilename,
  hasClips,
  isRendering = false,
  renderProgress = 0,
  renderStageMessage,
  playing,
  onTogglePlay,
  currentTime,
  duration,
  onSeek,
  onSkipBack,
  onSkipForward,
  muted,
  onToggleMute,
  videoRef,
  sourceVideoRef,
  onTimeUpdate,
  onLoadedMetadata,
}: PreviewCanvasProps) {
  const [splitPct, setSplitPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine active video source based on viewMode
  const activeVideoSrc =
    viewMode === "program"
      ? programUrl || sourceUrl
      : viewMode === "source"
      ? sourceUrl || programUrl
      : programUrl;

  const canCompare = Boolean(programUrl && sourceUrl);
  const hasVideo = Boolean(activeVideoSrc);

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        containerRef.current.requestFullscreen().catch(() => {});
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col min-h-0 bg-[#090A0F] select-none text-neutral-200 overflow-hidden"
    >
      {/* Monitor Header */}
      <div className="h-9 px-3 border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0 bg-[#0C0D15]">
        <div className="flex items-center gap-2">
          <MonitorPlay className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Preview Monitor
          </span>

          {/* View Mode Switcher */}
          <div className="ml-2 flex items-center bg-white/[0.04] border border-white/[0.08] rounded-md p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange("program")}
              disabled={!programUrl && !sourceUrl}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition",
                viewMode === "program"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              Program
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("source")}
              disabled={!sourceUrl}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition",
                viewMode === "source"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              Source
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("compare")}
              disabled={!canCompare}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition flex items-center gap-1",
                viewMode === "compare"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              <SplitSquareVertical className="w-3 h-3" />
              <span>Compare</span>
            </button>
          </div>
        </div>

        {/* Right Info: Aspect ratio & clip status */}
        <div className="flex items-center gap-2">
          {viewMode === "source" && selectedClipFilename && (
            <span className="text-[11px] text-neutral-400 font-mono truncate max-w-[150px] hidden sm:inline">
              {selectedClipFilename}
            </span>
          )}
          {viewMode === "compare" && (
            <span className="text-[11px] text-cyan-400 font-mono hidden sm:inline">
              Source vs Program
            </span>
          )}
          <Badge
            variant="outline"
            className="text-[10px] font-mono border-white/10 bg-white/[0.04] text-neutral-400 px-1.5 py-0"
          >
            {aspectRatio}
          </Badge>
        </div>
      </div>

      {/* Center Video Stage */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-3 sm:p-5 relative bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.05),transparent_70%)]">
        {hasVideo ? (
          <div
            className="relative bg-black rounded-lg shadow-2xl ring-1 ring-white/10 overflow-hidden flex items-center justify-center max-w-full max-h-full"
            style={{
              aspectRatio: aspectRatio.replace(":", " / "),
              height: aspectRatio === "9:16" ? "100%" : undefined,
              width: aspectRatio !== "9:16" ? "100%" : undefined,
            }}
          >
            {viewMode === "compare" && programUrl && sourceUrl ? (
              <>
                {/* Program video (Base) */}
                <video
                  ref={videoRef as React.RefObject<HTMLVideoElement>}
                  key={`prog-${programUrl}`}
                  src={programUrl}
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                  onPlay={() => {}}
                  onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => onLoadedMetadata?.(e.currentTarget.duration || 0)}
                  muted={muted}
                  playsInline
                />
                {/* Source video (Clipped) */}
                <div
                  className="absolute inset-y-0 left-0 overflow-hidden"
                  style={{ width: `${splitPct}%` }}
                >
                  <video
                    ref={sourceVideoRef as React.RefObject<HTMLVideoElement>}
                    key={`src-${sourceUrl}`}
                    src={sourceUrl}
                    className="absolute inset-0 h-full object-contain bg-black"
                    style={{ width: `${(100 / splitPct) * 100}%` }}
                    muted
                    playsInline
                  />
                  <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-violet-950/80 backdrop-blur text-[10px] font-mono text-violet-300 border border-violet-500/40 uppercase">
                    Source
                  </div>
                </div>
                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-cyan-950/80 backdrop-blur text-[10px] font-mono text-cyan-300 border border-cyan-500/40 uppercase">
                  Program
                </div>

                {/* Draggable Divider Handle */}
                <div
                  className="absolute inset-y-0 z-20 cursor-ew-resize group"
                  style={{ left: `calc(${splitPct}% - 12px)`, width: 24 }}
                  onPointerDown={(e) => {
                    const el = e.currentTarget.parentElement;
                    if (!el) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const rect = el.getBoundingClientRect();
                    const move = (ev: PointerEvent) => {
                      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
                      setSplitPct(Math.max(5, Math.min(95, pct)));
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                    <ChevronLeft className="w-3 h-3 -mr-0.5" />
                    <ChevronRight className="w-3 h-3 -ml-0.5" />
                  </div>
                </div>
              </>
            ) : (
              <video
                ref={videoRef as React.RefObject<HTMLVideoElement>}
                key={activeVideoSrc!}
                src={activeVideoSrc!}
                className="w-full h-full object-contain bg-black"
                onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => onLoadedMetadata?.(e.currentTarget.duration || 0)}
                muted={muted}
                playsInline
              />
            )}

            {/* Subtle Safe-Zone manga border */}
            <div className="absolute inset-2 border border-white/[0.05] pointer-events-none rounded" />
          </div>
        ) : (
          /* Empty / Idle State */
          <div
            className="relative bg-[#0E0F17] rounded-lg border border-white/[0.08] shadow-xl flex flex-col items-center justify-center p-6 text-center max-w-full max-h-full"
            style={{
              aspectRatio: aspectRatio.replace(":", " / "),
              height: aspectRatio === "9:16" ? "100%" : undefined,
              width: aspectRatio !== "9:16" ? "100%" : undefined,
            }}
          >
            {isRendering ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
                <h3 className="text-sm font-semibold text-neutral-200">
                  Rendering Video
                </h3>
                <p className="text-xs text-neutral-400 max-w-[220px]">
                  {renderStageMessage || "Assembling motion graphics and timeline cuts..."}
                </p>
                <div className="w-48 h-1.5 bg-white/[0.08] rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 transition-all duration-300"
                    style={{ width: `${Math.max(5, renderProgress)}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-violet-400">
                  {renderProgress}%
                </span>
              </div>
            ) : hasClips ? (
              <div className="flex flex-col items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-violet-950/40 border border-violet-500/20 flex items-center justify-center text-violet-400">
                  <Film className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-semibold text-neutral-200">
                  Ready to Preview
                </h3>
                <p className="text-[11px] text-neutral-500 max-w-[200px]">
                  Select a clip in the media panel to inspect or render the video to generate program playback.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-neutral-500">
                  <Film className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-semibold text-neutral-200">
                  No Clips Added
                </h3>
                <p className="text-[11px] text-neutral-500 max-w-[200px]">
                  Upload video clips using the media library on the left to start editing.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Playback Transport Controls */}
      <PlaybackControls
        playing={playing}
        onTogglePlay={onTogglePlay}
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        onSkipBack={onSkipBack}
        onSkipForward={onSkipForward}
        muted={muted}
        onToggleMute={onToggleMute}
        onToggleFullscreen={toggleFullscreen}
        disabled={!hasVideo}
      />
    </div>
  );
}
