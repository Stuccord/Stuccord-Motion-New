import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MonitorPlay, Sparkles, ChevronLeft, ChevronRight, Loader2, Film, SplitSquareVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AspectRatio, ViewMode } from "./types";
import { PlaybackControls } from "./PlaybackControls";
import { IMAGE_ZOOM } from "@/lib/media-kind";

interface PreviewCanvasProps {
  aspectRatio: AspectRatio;
  /** Switches the project's shape (offered when the shown clip doesn't match). */
  onAspectRatioChange?: (ratio: AspectRatio) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  programUrl: string | null;
  sourceUrl: string | null;
  /** The selected clip is an image: Source shows it (slowly zooming) instead of a video. */
  sourceIsImage?: boolean;
  /** How long the selected image shows, for its slow zoom. */
  imageLengthMs?: number;
  selectedClipFilename?: string | null;
  hasClips: boolean;
  isRendering?: boolean;
  renderProgress?: number;
  renderStageMessage?: string | null;
  // Playback state
  playing: boolean;
  /** Reports when the player starts or stops playing. */
  onPlayingChange?: (playing: boolean) => void;
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
  onAspectRatioChange,
  viewMode,
  onViewModeChange,
  programUrl,
  sourceUrl,
  sourceIsImage = false,
  imageLengthMs = 3000,
  selectedClipFilename,
  hasClips,
  isRendering = false,
  renderProgress = 0,
  renderStageMessage,
  playing,
  onPlayingChange,
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

  // The frame is the largest box with the project's shape that fits the
  // stage. (CSS aspect-ratio with width: 100% and max-height stretches it
  // when the stage is short and wide.)
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setStage({
        w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [arW, arH] = aspectRatio.split(":").map(Number);
  const ratio = arW / arH;
  const frameW = Math.max(0, Math.min(stage.w, stage.h * ratio));
  const frameStyle: React.CSSProperties =
    stage.w > 0 && stage.h > 0
      ? { width: frameW, height: frameW / ratio }
      : { aspectRatio: `${arW} / ${arH}`, height: "100%" };

  // Keep the play button in step with the video element.
  const playbackEvents = {
    onPlay: () => onPlayingChange?.(true),
    onPause: () => onPlayingChange?.(false),
    onEnded: () => onPlayingChange?.(false),
    // A new file (or a remounted player) starts paused.
    onLoadStart: () => onPlayingChange?.(false),
  };

  // Determine active video source based on viewMode
  const activeVideoSrc =
    viewMode === "program"
      ? programUrl || sourceUrl
      : viewMode === "source"
      ? sourceUrl || programUrl
      : programUrl;

  // The shown video's own shape (after phone rotation), once it has loaded.
  const [clipSize, setClipSize] = useState<{ src: string; w: number; h: number } | null>(null);
  const shownSize =
    clipSize && clipSize.src === activeVideoSrc && clipSize.w > 0 && clipSize.h > 0
      ? clipSize
      : null;
  const clipRatio = shownSize ? shownSize.w / shownSize.h : null;
  // Same rule as the exports: (nearly) the frame's shape fills it; others are
  // shown whole over a blurred copy.
  const mismatched = clipRatio != null && Math.abs(Math.log(clipRatio / ratio)) >= 0.03;
  // The selected image, shown in Source view.
  const showImage = sourceIsImage && viewMode !== "compare" && activeVideoSrc === sourceUrl;
  const blurBackground = mismatched && viewMode !== "compare" && !showImage;

  // The blurred copy: the video drawn into a tiny canvas every frame, then
  // stretched and blurred by CSS. Cheap, and always in step with the video.
  const bgRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = bgRef.current;
    const video = videoRef.current;
    const g = canvas?.getContext("2d");
    if (!blurBackground || !canvas || !video || !g) return;
    const drawFrame = () => {
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
    // Every frame while playing (or until the first frame is ready); once
    // whenever a paused frame changes.
    let raf = 0;
    const loop = () => {
      drawFrame();
      if (!video.paused || video.readyState < 2) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const events = ["play", "seeked", "loadeddata", "canplay"] as const;
    events.forEach((ev) => video.addEventListener(ev, start));
    start();
    // Where supported, also draw each frame the browser actually shows: the
    // first frame can't be copied until it has been shown.
    let frameHandle: number | null = null;
    const onFrame = () => {
      drawFrame();
      frameHandle = video.requestVideoFrameCallback(onFrame);
    };
    if ("requestVideoFrameCallback" in video) {
      frameHandle = video.requestVideoFrameCallback(onFrame);
    }
    return () => {
      cancelAnimationFrame(raf);
      events.forEach((ev) => video.removeEventListener(ev, start));
      if (frameHandle != null) video.cancelVideoFrameCallback(frameHandle);
    };
  }, [blurBackground, activeVideoSrc, videoRef]);

  // Suggest the project shape closest to the shown clip's, unless dismissed.
  const suggestedRatio: AspectRatio | null =
    clipRatio != null && onAspectRatioChange
      ? (["9:16", "1:1", "16:9"] as const).reduce((best, r) => {
          const [w, h] = r.split(":").map(Number);
          const [bw, bh] = best.split(":").map(Number);
          return Math.abs(Math.log(clipRatio / (w / h))) < Math.abs(Math.log(clipRatio / (bw / bh)))
            ? r
            : best;
        }, aspectRatio)
      : null;
  const [dismissedHints, setDismissedHints] = useState<string[]>([]);
  const hintKey = `${aspectRatio}->${suggestedRatio}`;
  const showShapeHint =
    suggestedRatio != null &&
    suggestedRatio !== aspectRatio &&
    viewMode !== "compare" &&
    !dismissedHints.includes(hintKey);
  const clipShapeWord =
    suggestedRatio === "9:16" ? "vertical" : suggestedRatio === "16:9" ? "horizontal" : "square";

  const canCompare = Boolean(programUrl && sourceUrl && !sourceIsImage);
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
              disabled={!programUrl}
              title={programUrl ? "The rendered video" : "Render the video to see the program"}
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
              title={sourceUrl ? "The selected clip's trimmed part" : "Select a clip to see it"}
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
        </div>
      </div>

      {/* Center Video Stage */}
      <div
        ref={stageRef}
        className="flex-1 min-h-0 flex items-center justify-center p-3 sm:p-5 relative bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.05),transparent_70%)]"
      >
        {hasVideo ? (
          <div
            className="relative bg-black rounded-lg shadow-2xl ring-1 ring-white/10 overflow-hidden flex items-center justify-center max-w-full max-h-full shrink-0"
            style={frameStyle}
          >
            {viewMode === "compare" && programUrl && sourceUrl ? (
              <>
                {/* Program video (Base) */}
                <video
                  ref={videoRef as React.RefObject<HTMLVideoElement>}
                  key={`prog-${programUrl}`}
                  src={programUrl}
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                  {...playbackEvents}
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
            ) : showImage ? (
              <>
                {/* Like the exports: a blurred copy behind when the shape
                    differs, and a slow push-in over the clip's length. */}
                {mismatched && (
                  <img
                    src={activeVideoSrc!}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl brightness-75 pointer-events-none"
                  />
                )}
                <img
                  key={activeVideoSrc!}
                  src={activeVideoSrc!}
                  alt={selectedClipFilename ?? "Selected image"}
                  className="relative w-full h-full object-contain stuccord-kenburns"
                  style={{ animationDuration: `${Math.max(500, imageLengthMs)}ms` }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setClipSize({
                      src: activeVideoSrc!,
                      w: img.naturalWidth,
                      h: img.naturalHeight,
                    });
                  }}
                />
                <style>{`
                  @keyframes stuccord-kenburns { from { transform: scale(1); } to { transform: scale(${1 + IMAGE_ZOOM}); } }
                  .stuccord-kenburns { animation: stuccord-kenburns linear infinite; transform-origin: center; }
                  @media (prefers-reduced-motion: reduce) { .stuccord-kenburns { animation: none; } }
                `}</style>
              </>
            ) : (
              <>
                {blurBackground && (
                  <canvas
                    ref={bgRef}
                    aria-hidden
                    width={ratio >= 1 ? 64 : Math.round(64 * ratio)}
                    height={ratio >= 1 ? Math.round(64 / ratio) : 64}
                    className="absolute inset-0 w-full h-full scale-110 blur-xl brightness-75 pointer-events-none"
                  />
                )}
                <video
                  ref={videoRef as React.RefObject<HTMLVideoElement>}
                  key={activeVideoSrc!}
                  src={activeVideoSrc!}
                  className={cn(
                    "relative w-full h-full object-contain",
                    blurBackground ? "bg-transparent" : "bg-black",
                  )}
                  {...playbackEvents}
                  onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    setClipSize({ src: activeVideoSrc!, w: v.videoWidth, h: v.videoHeight });
                    onLoadedMetadata?.(v.duration || 0);
                  }}
                  muted={muted}
                  playsInline
                />
              </>
            )}

            {/* The clip's shape doesn't match the project: offer to switch */}
            {showShapeHint && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 max-w-[calc(100%-1rem)] flex items-center gap-2 rounded-md border border-white/10 bg-black/75 backdrop-blur px-2.5 py-1.5 text-[11px] text-neutral-200 shadow-lg">
                <span className="truncate">
                  This clip is {clipShapeWord}. Switch the project to {suggestedRatio}?
                </span>
                <button
                  type="button"
                  onClick={() => onAspectRatioChange?.(suggestedRatio!)}
                  className="shrink-0 rounded bg-violet-600 px-2 py-0.5 font-medium text-white hover:bg-violet-500"
                >
                  Switch to {suggestedRatio}
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedHints((d) => [...d, hintKey])}
                  className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-white"
                  aria-label="Keep the current shape"
                  title="Keep the current shape"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Empty / Idle State */
          <div
            className="relative bg-[#0E0F17] rounded-lg border border-white/[0.08] shadow-xl flex flex-col items-center justify-center p-6 text-center max-w-full max-h-full shrink-0 overflow-hidden"
            style={frameStyle}
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
        disabled={!hasVideo || showImage}
      />
    </div>
  );
}
