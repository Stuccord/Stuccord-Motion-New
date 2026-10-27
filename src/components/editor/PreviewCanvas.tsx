import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MonitorPlay, Loader2, Film, X, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AspectRatio, ClipRow, ViewMode } from "./types";
import { PlaybackControls } from "./PlaybackControls";
import { TimelinePlayer, type TimelinePlayerHandle } from "./TimelinePlayer";
import { IMAGE_ZOOM } from "@/lib/media-kind";
import type { ClipTransform } from "@/lib/clip-transform";

interface PreviewCanvasProps {
  aspectRatio: AspectRatio;
  /** Switches the project's shape (offered when the shown clip doesn't match). */
  onAspectRatioChange?: (ratio: AspectRatio) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** The finished cloud render (Render tab). */
  programUrl: string | null;
  /** The selected clip's file (Clip tab). */
  sourceUrl: string | null;
  /** The edit, for the Timeline tab's live player. */
  timeline?: {
    aRoll: ClipRow[];
    bRoll: ClipRow[];
    urls: Record<string, string>;
    lengthMs: (clip: ClipRow) => number;
    onTick?: (timeMs: number, playing: boolean, rate: number) => void;
    renderOverlay?: (timeMs: number) => React.ReactNode;
    /** The selected clip, which gets a box with handles in the picture. */
    selectedClipId?: string | null;
    onSelectClip?: (id: string) => void;
    /** A clip was moved, resized or rotated in the picture (null: default fit). */
    onTransform?: (id: string, transform: ClipTransform | null) => void;
  };
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
  /** Play speed (L key), shown in the transport when it isn't 1×. */
  playbackRate?: number;
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
  /** The player in use: a <video>, or the timeline player (which acts like one). */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (duration: number) => void;
}

const MONITOR_ZOOM_KEY = "stuccord.monitorZoom";
const MONITOR_GUIDES_KEY = "stuccord.monitorGuides";
/** The export's size for each shape (what 100% zoom shows). */
const EXPORT_SIZE: Record<AspectRatio, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
};

/** A setting kept in this browser (falls back to `initial`). */
function useStoredState<T extends string>(key: string, initial: T, allowed: T[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      if (saved && allowed.includes(saved)) setValue(saved);
    } catch {
      /* storage unavailable */
    }
    // Read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set] as const;
}

/**
 * Safe-area guides over the frame. Vertical video: the areas TikTok, Reels
 * and Shorts cover with their own top bar, side buttons and caption/name
 * block. Other shapes: the classic title-safe (90%) and action-safe (95%)
 * boxes.
 */
function SafeAreaGuides({ aspectRatio }: { aspectRatio: AspectRatio }) {
  const label = "absolute text-[9px] font-mono uppercase tracking-wider text-amber-200/80";
  if (aspectRatio === "9:16") {
    return (
      <div className="absolute inset-0 z-30 pointer-events-none" aria-hidden>
        <div className="absolute inset-x-0 top-0 h-[10%] bg-amber-400/15 border-b border-dashed border-amber-300/70">
          <span className={`${label} left-1.5 bottom-0.5`}>App top bar</span>
        </div>
        <div className="absolute right-0 top-[38%] h-[42%] w-[15%] bg-amber-400/15 border-l border-dashed border-amber-300/70">
          <span className={`${label} right-1 top-1 [writing-mode:vertical-rl]`}>Buttons</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[20%] bg-amber-400/15 border-t border-dashed border-amber-300/70">
          <span className={`${label} left-1.5 top-0.5`}>Caption &amp; name</span>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 z-30 pointer-events-none" aria-hidden>
      <div className="absolute inset-[2.5%] border border-dashed border-amber-300/40" />
      <div className="absolute inset-[5%] border border-dashed border-amber-300/70">
        <span className={`${label} left-1 top-0.5`}>Title safe</span>
      </div>
    </div>
  );
}

export function PreviewCanvas({
  aspectRatio,
  onAspectRatioChange,
  viewMode,
  onViewModeChange,
  programUrl,
  sourceUrl,
  timeline,
  sourceIsImage = false,
  imageLengthMs = 3000,
  selectedClipFilename,
  hasClips,
  isRendering = false,
  renderProgress = 0,
  renderStageMessage,
  playing,
  playbackRate = 1,
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
  onTimeUpdate,
  onLoadedMetadata,
}: PreviewCanvasProps) {
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
  // Monitor zoom, like After Effects' composition panel: fit the stage, or
  // a share of the export's real size (scrolls when it's bigger). Remembered.
  const [zoom, setZoom] = useStoredState<"fit" | "0.5" | "1">(MONITOR_ZOOM_KEY, "fit", [
    "fit",
    "0.5",
    "1",
  ]);
  // Safe-area guides: where phone apps put their own buttons and captions.
  const [guides, setGuides] = useStoredState<"on" | "off">(MONITOR_GUIDES_KEY, "off", [
    "on",
    "off",
  ]);
  const exportSize = EXPORT_SIZE[aspectRatio];
  const fitW = Math.max(0, Math.min(stage.w, stage.h * ratio));
  const frameW = zoom === "fit" ? fitW : exportSize.w * Number(zoom);
  const frameStyle: React.CSSProperties =
    zoom !== "fit"
      ? { width: frameW, height: frameW / ratio }
      : stage.w > 0 && stage.h > 0
        ? { width: frameW, height: frameW / ratio }
        : { aspectRatio: `${arW} / ${arH}`, height: "100%" };
  // When fitted the frame never exceeds the stage; zoomed in it may (and scrolls).
  const frameFit = zoom === "fit" ? "max-w-full max-h-full" : "";

  // Keep the play button in step with the video element.
  const playbackEvents = {
    onPlay: () => onPlayingChange?.(true),
    onPause: () => onPlayingChange?.(false),
    onEnded: () => onPlayingChange?.(false),
    // A new file (or a remounted player) starts paused.
    onLoadStart: () => onPlayingChange?.(false),
  };

  // The Timeline tab plays the edit live; Clip and Render show one file.
  const showTimeline = viewMode === "timeline" && !!timeline && hasClips;
  const activeVideoSrc = showTimeline
    ? null
    : viewMode === "render"
      ? programUrl
      : viewMode === "clip"
        ? sourceUrl
        : null;

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
  const showImage = sourceIsImage && viewMode === "clip" && activeVideoSrc === sourceUrl;
  const blurBackground = mismatched && !showImage;

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
    viewMode === "clip" &&
    !dismissedHints.includes(hintKey);
  const clipShapeWord =
    suggestedRatio === "9:16" ? "vertical" : suggestedRatio === "16:9" ? "horizontal" : "square";

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
      <div className="h-8 px-2.5 border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0 bg-[#0C0D15]">
        <div className="flex items-center gap-2">
          <MonitorPlay className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Preview Monitor
          </span>

          {/* Timeline: the edit, live. Clip: the selected clip. Render: the
              finished cloud video. */}
          <div className="ml-2 flex items-center bg-white/[0.04] border border-white/[0.08] rounded-md p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange("timeline")}
              disabled={!hasClips}
              title={"Your edit, played live from the timeline"}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition",
                viewMode === "timeline"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("clip")}
              disabled={!sourceUrl}
              title={sourceUrl ? "The selected clip on its own" : "Select a clip to see it on its own"}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition",
                viewMode === "clip"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              Clip
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("render")}
              disabled={!programUrl}
              title={programUrl ? "The finished cloud render" : "Render the video to see it here"}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition",
                viewMode === "render"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              Render
            </button>
          </div>
        </div>

        {/* Right Info: Aspect ratio & clip status */}
        <div className="flex items-center gap-2">
          {viewMode === "clip" && selectedClipFilename && (
            <span className="text-[11px] text-neutral-400 font-mono truncate max-w-[150px] hidden sm:inline">
              {selectedClipFilename}
            </span>
          )}
          {showTimeline && (
            <span className="hidden md:flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live edit
            </span>
          )}
          <button
            type="button"
            onClick={() => setGuides(guides === "on" ? "off" : "on")}
            aria-pressed={guides === "on"}
            title="Safe-area guides: where phone apps cover the video"
            className={cn(
              "h-6 px-1.5 rounded flex items-center gap-1 text-[11px] transition",
              guides === "on"
                ? "bg-violet-600/25 text-violet-200"
                : "text-neutral-400 hover:text-white hover:bg-white/[0.06]",
            )}
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Guides</span>
          </button>
          <select
            value={zoom}
            onChange={(e) => setZoom(e.target.value as typeof zoom)}
            aria-label="Monitor zoom"
            title="Monitor zoom (100% is the export's real size)"
            className="h-6 rounded bg-white/[0.04] border border-white/[0.08] px-1 text-[11px] font-mono text-neutral-300 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
          >
            <option value="fit">Fit</option>
            <option value="0.5">50%</option>
            <option value="1">100%</option>
          </select>
        </div>
      </div>

      {/* Center Video Stage */}
      <div
        ref={stageRef}
        className={cn(
          "flex-1 min-h-0 flex p-1.5 sm:p-2.5 relative bg-[#050508]",
          // Zoomed past the stage: scroll. (m-auto on the frame centres it
          // while still letting every edge scroll into view.)
          zoom === "fit" ? "overflow-hidden" : "overflow-auto",
        )}
      >
        {showTimeline ? (
          <div
            className={cn(
              // Not clipped: the player clips the picture itself, and a
              // selected clip's handles may reach past the frame's edge.
              "relative m-auto bg-black rounded-md shadow-2xl ring-1 ring-white/10 shrink-0",
              frameFit,
            )}
            style={frameStyle}
          >
            {guides === "on" && <SafeAreaGuides aspectRatio={aspectRatio} />}
            <TimelinePlayer
              ref={videoRef as unknown as React.Ref<TimelinePlayerHandle>}
              aRoll={timeline!.aRoll}
              bRoll={timeline!.bRoll}
              urls={timeline!.urls}
              lengthMs={timeline!.lengthMs}
              frameRatio={ratio}
              muted={muted}
              onTime={onTimeUpdate}
              onDuration={onLoadedMetadata}
              onPlayingChange={onPlayingChange}
              onTick={timeline!.onTick}
              renderOverlay={timeline!.renderOverlay}
              selectedClipId={timeline!.selectedClipId}
              onSelectClip={timeline!.onSelectClip}
              onTransform={timeline!.onTransform}
            />
            {/* A cloud render in progress: shown on top of the live edit. */}
            {isRendering && (
              <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 rounded-md bg-black/75 backdrop-blur border border-white/10 px-2 py-1 text-[10px] font-mono text-violet-200">
                <Loader2 className="w-3 h-3 animate-spin" />
                Rendering {renderProgress}%
              </div>
            )}
          </div>
        ) : hasVideo ? (
          <div
            className={cn(
              "relative m-auto bg-black rounded-md shadow-2xl ring-1 ring-white/10 overflow-hidden flex items-center justify-center shrink-0",
              frameFit,
            )}
            style={frameStyle}
          >
            {guides === "on" && <SafeAreaGuides aspectRatio={aspectRatio} />}
            {showImage ? (
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
          <div className="relative m-auto bg-[#0E0F17] rounded-lg border border-white/[0.08] shadow-xl flex flex-col items-center justify-center px-6 py-8 text-center w-full max-w-sm max-h-full overflow-auto">
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
                <h3 className="text-xs font-semibold text-neutral-200">Nothing to show here</h3>
                <p className="text-[11px] text-neutral-500 max-w-[240px]">
                  Choose Timeline to play your edit, or select a clip to see it on its own.
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
                <p className="text-[11px] text-neutral-500 max-w-[240px]">
                  Add videos, images or music from the Media panel on the left, or drop them on the
                  timeline.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Playback Transport Controls */}
      <PlaybackControls
        playing={playing}
        playbackRate={playbackRate}
        onTogglePlay={onTogglePlay}
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        onSkipBack={onSkipBack}
        onSkipForward={onSkipForward}
        muted={muted}
        onToggleMute={onToggleMute}
        onToggleFullscreen={toggleFullscreen}
        disabled={showTimeline ? false : !hasVideo || showImage}
      />
    </div>
  );
}
