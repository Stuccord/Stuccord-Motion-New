import React from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PlaybackControlsProps {
  playing: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  onSeek: (percent: number) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  disabled?: boolean;
}

export function formatTimecode(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms}`;
}

export function PlaybackControls({
  playing,
  onTogglePlay,
  currentTime,
  duration,
  onSeek,
  onSkipBack,
  onSkipForward,
  muted,
  onToggleMute,
  onToggleFullscreen,
  disabled = false,
}: PlaybackControlsProps) {
  const playheadPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);

    const updateSeek = (clientX: number) => {
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      onSeek(pct);
    };

    updateSeek(e.clientX);

    const onMove = (ev: PointerEvent) => updateSeek(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div className="w-full bg-[#0D0E16]/95 border-t border-white/[0.08] select-none text-neutral-300 shrink-0">
        {/* Progress Scrubber */}
        <div className="px-3 pt-2 pb-1">
          <div
            role="slider"
            aria-label="Seek timeline"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(playheadPct)}
            tabIndex={disabled ? -1 : 0}
            onPointerDown={handlePointerDown}
            className={cn(
              "relative h-1.5 rounded-full bg-white/[0.08] cursor-pointer group touch-none transition-all",
              disabled && "cursor-not-allowed opacity-40",
            )}
          >
            {/* Filled track with violet gradient */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-600 to-indigo-500 shadow-[0_0_8px_rgba(124,58,237,0.5)]"
              style={{ width: `${playheadPct}%` }}
            />
            {/* Scrubber thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white ring-2 ring-violet-500 shadow-md opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none"
              style={{ left: `calc(${playheadPct}% - 7px)` }}
            />
          </div>
        </div>

        {/* Buttons & Timecode row */}
        <div className="h-10 px-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {/* Skip to start */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onSkipBack}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Skip to beginning (Home)"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Beginning (Home)</TooltipContent>
            </Tooltip>

            {/* Play / Pause button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onTogglePlay}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 hover:text-white border border-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-sm"
                  aria-label={playing ? "Pause (Space)" : "Play (Space)"}
                >
                  {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{playing ? "Pause (Space)" : "Play (Space)"}</TooltipContent>
            </Tooltip>

            {/* Skip to end */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onSkipForward}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Skip to end (End)"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">End (End)</TooltipContent>
            </Tooltip>

            {/* Timecode */}
            <div className="text-xs font-mono ml-2 tabular-nums">
              <span className="text-neutral-100 font-semibold">{formatTimecode(currentTime)}</span>
              <span className="text-neutral-500"> / {duration > 0 ? formatTimecode(duration) : "00:00.0"}</span>
            </div>
          </div>

          {/* Right Controls: Volume & Fullscreen */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleMute}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition"
                  aria-label={muted ? "Unmute" : "Mute"}
                >
                  {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{muted ? "Unmute" : "Mute"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition"
                  aria-label="Fullscreen"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Fullscreen</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
