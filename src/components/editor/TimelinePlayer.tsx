// Plays the timeline itself, without rendering: the main track (A-roll, or
// B-roll when there's no A-roll) with its trims and gaps, B-roll and images
// on top at their times, each fitted to the frame like the exports (whole,
// over a blurred copy, when its shape differs) and images slowly zooming.
//
// It acts like a <video> element to the editor (play, pause, currentTime,
// duration, playbackRate, paused, ended), so the transport, the timeline
// playhead and the keyboard shortcuts drive it the same way.

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { IMAGE_ZOOM, isImageFilename } from "@/lib/media-kind";
import { layoutTrack } from "@/lib/timeline-layout";
import type { ClipRow } from "./types";

/** What the editor can do with the player (a subset of HTMLVideoElement). */
export type TimelinePlayerHandle = {
  readonly paused: boolean;
  readonly ended: boolean;
  currentTime: number;
  readonly duration: number;
  playbackRate: number;
  play: () => Promise<void>;
  pause: () => void;
};

type Props = {
  aRoll: ClipRow[];
  bRoll: ClipRow[];
  /** Signed links to the clips' files, by storage path. */
  urls: Record<string, string>;
  /** A clip's length on the timeline (ms). */
  lengthMs: (clip: ClipRow) => number;
  /** The frame's shape (width / height). */
  frameRatio: number;
  muted: boolean;
  /** The playhead moved (seconds); called a few times a second while playing. */
  onTime?: (seconds: number) => void;
  /** The length of the edit (seconds), when it's known or changes. */
  onDuration?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Every frame while playing and after each seek (for music and SFX). */
  onTick?: (timeMs: number, playing: boolean, rate: number) => void;
  /** Drawn over the picture at the current time (captions, hook). */
  renderOverlay?: (timeMs: number) => React.ReactNode;
};

type Placed = { clip: ClipRow; start: number; end: number; track: "main" | "over" };

const isImage = (c: ClipRow) => isImageFilename(c.filename);

export const TimelinePlayer = forwardRef<TimelinePlayerHandle, Props>(function TimelinePlayer(
  {
    aRoll,
    bRoll,
    urls,
    lengthMs,
    frameRatio,
    muted,
    onTime,
    onDuration,
    onPlayingChange,
    onTick,
    renderOverlay,
  },
  ref,
) {
  // The tracks as the export plays them: the main track, and B-roll on top.
  // Laid out again only when a clip's place, length or file changes (the
  // editor hands over new arrays on every render).
  const layoutKey = JSON.stringify(
    [aRoll, bRoll].map((list) =>
      list.map((c) => [c.id, c.start_ms ?? null, lengthMs(c), c.storage_path, c.filename]),
    ),
  );
  const placed = useMemo(() => {
    const main = aRoll.length > 0 ? aRoll : bRoll;
    const over = aRoll.length > 0 ? bRoll : [];
    const place = (clips: ClipRow[], track: Placed["track"]) => {
      const { starts } = layoutTrack(clips, lengthMs);
      return clips.map((clip) => {
        const start = starts.get(clip.id) ?? 0;
        return { clip, start, end: start + lengthMs(clip), track };
      });
    };
    return { main: place(main, "main"), over: place(over, "over") };
    // layoutKey stands for aRoll, bRoll and lengthMs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);
  const endMs = placed.main.length ? placed.main[placed.main.length - 1].end : 0;

  // The playhead (ms): a ref for the clock, state for drawing.
  const timeRef = useRef(0);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const endedRef = useRef(false);
  const rateRef = useRef(1);
  const videos = useRef(new Map<string, HTMLVideoElement>());

  // Latest values for the stable handle and the clock.
  const latest = useRef({ placed, endMs, muted, onTime, onPlayingChange, onTick });
  latest.current = { placed, endMs, muted, onTime, onPlayingChange, onTick };

  const activeAt = (list: Placed[], t: number) => list.find((p) => t >= p.start && t < p.end);
  const findPlaced = (id: string) =>
    latest.current.placed.main.find((p) => p.clip.id === id) ??
    latest.current.placed.over.find((p) => p.clip.id === id);

  /** Puts every loaded video where it should be for time `time`. */
  const sync = useCallback((time: number) => {
    // At the very end, the last frame stays on screen.
    const t = Math.min(time, Math.max(0, latest.current.endMs - 1));
    for (const [id, el] of videos.current) {
      const p = findPlaced(id);
      if (!p) continue;
      const active = t >= p.start && t < p.end;
      const trimIn = (p.clip.trim_in_ms ?? 0) / 1000;
      const target = trimIn + Math.max(0, Math.min(t, p.end - 1) - p.start) / 1000;
      el.playbackRate = rateRef.current;
      el.muted = p.track === "over" || latest.current.muted;
      if (active && playingRef.current) {
        if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        const want = active ? target : trimIn;
        if (Math.abs(el.currentTime - want) > 0.04) el.currentTime = want;
      }
    }
    // findPlaced reads `latest`.
  }, []);

  const lastReport = useRef(0);
  const report = useCallback((t: number, force = false) => {
    const now = performance.now();
    if (force || now - lastReport.current > 60) {
      lastReport.current = now;
      latest.current.onTime?.(t / 1000);
    }
    latest.current.onTick?.(t, playingRef.current, rateRef.current);
  }, []);

  const seek = useCallback(
    (ms: number) => {
      const t = Math.max(0, Math.min(latest.current.endMs, ms));
      timeRef.current = t;
      endedRef.current = false;
      setTimeMs(t);
      sync(t);
      report(t, true);
    },
    [sync, report],
  );

  const setPlayingBoth = (value: boolean) => {
    playingRef.current = value;
    setPlaying(value);
    latest.current.onPlayingChange?.(value);
  };

  useImperativeHandle(
    ref,
    () => ({
      get paused() {
        return !playingRef.current;
      },
      get ended() {
        return endedRef.current;
      },
      get currentTime() {
        return timeRef.current / 1000;
      },
      set currentTime(seconds: number) {
        seek(seconds * 1000);
      },
      get duration() {
        return latest.current.endMs / 1000;
      },
      get playbackRate() {
        return rateRef.current;
      },
      set playbackRate(rate: number) {
        rateRef.current = rate;
        sync(timeRef.current);
      },
      play: async () => {
        if (latest.current.endMs <= 0) return;
        if (timeRef.current >= latest.current.endMs - 30) seek(0);
        endedRef.current = false;
        setPlayingBoth(true);
        sync(timeRef.current);
      },
      pause: () => {
        setPlayingBoth(false);
        sync(timeRef.current);
        report(timeRef.current, true);
      },
    }),
    // The handle reads refs; it never needs replacing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The clock. While a main-track video plays, follow its own time (so the
  // picture and the voice stay together); in gaps and on images, wall time.
  // A video that is still loading holds the playhead.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const { placed: pl, endMs: end } = latest.current;
      let t = timeRef.current;
      const m = activeAt(pl.main, t);
      const el = m && !isImage(m.clip) ? videos.current.get(m.clip.id) : undefined;
      if (el && !el.paused && !el.ended && el.readyState >= 2) {
        const fromVideo = m!.start + (el.currentTime * 1000 - (m!.clip.trim_in_ms ?? 0));
        // Ignore a video that hasn't caught up with a seek yet.
        t = Math.abs(fromVideo - t) < 400 ? Math.max(t, fromVideo) : t + dt * rateRef.current;
      } else if (el && el.readyState < 2 && !el.ended) {
        // Loading: wait for it.
      } else {
        t += dt * rateRef.current;
      }
      if (t >= end) {
        timeRef.current = end;
        endedRef.current = true;
        setTimeMs(end);
        setPlayingBoth(false);
        sync(end);
        report(end, true);
        return;
      }
      const crossed = (m && t >= m.end) || activeAt(pl.main, t) !== m;
      timeRef.current = t;
      setTimeMs(t);
      // Each frame: keep the videos in step (cheap when nothing changes).
      if (crossed || Math.floor(now / 250) !== Math.floor((now - dt) / 250)) sync(t);
      report(t);
      raf = requestAnimationFrame(tick);
    };
    sync(timeRef.current);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // sync and report are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // The edit's length changed: report it, keep the playhead inside it.
  useEffect(() => {
    onDuration?.(endMs / 1000);
    if (timeRef.current > endMs) seek(endMs);
    // onDuration is a prop callback; rerunning when it changes isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endMs]);
  // Clips moved or changed: put the videos where they now belong.
  useEffect(() => sync(timeRef.current), [placed, sync]);

  // Mute follows the speaker button.
  useEffect(() => sync(timeRef.current), [muted, sync]);

  // Stop everything when the player goes away.
  useEffect(
    () => () => {
      for (const el of videos.current.values()) el.pause();
    },
    [],
  );

  // On screen: the clip at the playhead on each track, plus the next one
  // (loaded but hidden) so the cut to it is quick.
  // At the very end, the last frame stays on screen.
  const t = Math.min(timeMs, Math.max(0, endMs - 1));
  const withNext = (list: Placed[]) => {
    const i = list.findIndex((p) => p.end > t);
    return i < 0 ? [] : list.slice(i, i + 2);
  };
  const layers = [...withNext(placed.main), ...withNext(placed.over)];
  const mainActive = activeAt(placed.main, t);

  return (
    <div className="absolute inset-0 bg-black overflow-hidden">
      {layers.map((p) => {
        const active = t >= p.start && t < p.end;
        const url = urls[p.clip.storage_path];
        if (!url) return null;
        return (
          <Layer
            key={`${p.track}:${p.clip.id}`}
            placed={p}
            url={url}
            active={active}
            timeMs={t}
            frameRatio={frameRatio}
            videoRef={(el) => {
              if (el) videos.current.set(p.clip.id, el);
              else videos.current.delete(p.clip.id);
            }}
            onReady={() => sync(timeRef.current)}
          />
        );
      })}
      {mainActive && !urls[mainActive.clip.storage_path] && (
        <div className="absolute inset-0 grid place-items-center text-[11px] text-neutral-500">
          Loading…
        </div>
      )}
      {renderOverlay?.(t)}
    </div>
  );
});

/** One clip in the player: a video or an image, fitted to the frame. */
function Layer({
  placed: p,
  url,
  active,
  timeMs,
  frameRatio,
  videoRef,
  onReady,
}: {
  placed: Placed;
  url: string;
  active: boolean;
  timeMs: number;
  frameRatio: number;
  videoRef: (el: HTMLVideoElement | null) => void;
  onReady: () => void;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const mismatched =
    size != null &&
    size.w > 0 &&
    size.h > 0 &&
    Math.abs(Math.log(size.w / size.h / frameRatio)) >= 0.03;
  const zIndex = p.track === "over" ? 2 : 1;
  const style: React.CSSProperties = { zIndex, visibility: active ? "visible" : "hidden" };

  if (isImage(p.clip)) {
    // The slow push-in, by where the playhead is in the clip.
    const progress = Math.min(1, Math.max(0, (timeMs - p.start) / Math.max(1, p.end - p.start)));
    const zoom = 1 + IMAGE_ZOOM * progress;
    return (
      <div className="absolute inset-0" style={style}>
        {mismatched && (
          <img
            src={url}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl brightness-75"
          />
        )}
        <img
          src={url}
          alt=""
          className={cn(
            "absolute inset-0 w-full h-full",
            mismatched ? "object-contain" : "object-cover",
          )}
          style={{ transform: `scale(${zoom})` }}
          onLoad={(e) =>
            setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
        />
      </div>
    );
  }
  return (
    <VideoLayer
      url={url}
      style={style}
      mismatched={mismatched}
      frameRatio={frameRatio}
      active={active}
      videoRef={videoRef}
      onSize={(w, h) => {
        setSize({ w, h });
        onReady();
      }}
    />
  );
}

/** A video in the player, with the blurred copy behind it when its shape differs. */
function VideoLayer({
  url,
  style,
  mismatched,
  frameRatio,
  active,
  videoRef,
  onSize,
}: {
  url: string;
  style: React.CSSProperties;
  mismatched: boolean;
  frameRatio: number;
  active: boolean;
  videoRef: (el: HTMLVideoElement | null) => void;
  onSize: (w: number, h: number) => void;
}) {
  const el = useRef<HTMLVideoElement | null>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  // The blurred copy: the video drawn small into a canvas each frame it shows.
  useEffect(() => {
    const video = el.current;
    const canvas = bg.current;
    const g = canvas?.getContext("2d");
    if (!mismatched || !active || !video || !canvas || !g) return;
    const draw = () => {
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
    let handle: number | null = null;
    let raf = 0;
    if ("requestVideoFrameCallback" in video) {
      const onFrame = () => {
        draw();
        handle = video.requestVideoFrameCallback(onFrame);
      };
      handle = video.requestVideoFrameCallback(onFrame);
    } else {
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    const onSeeked = () => draw();
    video.addEventListener("seeked", onSeeked);
    draw();
    return () => {
      if (handle != null) video.cancelVideoFrameCallback(handle);
      cancelAnimationFrame(raf);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [mismatched, active]);

  return (
    <div className="absolute inset-0" style={style}>
      {mismatched && (
        <canvas
          ref={bg}
          aria-hidden
          width={frameRatio >= 1 ? 64 : Math.round(64 * frameRatio)}
          height={frameRatio >= 1 ? Math.round(64 / frameRatio) : 64}
          className="absolute inset-0 w-full h-full scale-110 blur-xl brightness-75"
        />
      )}
      <video
        ref={(v) => {
          el.current = v;
          videoRef(v);
        }}
        src={url}
        preload="auto"
        playsInline
        muted
        className={cn(
          "absolute inset-0 w-full h-full",
          mismatched ? "object-contain" : "object-cover",
        )}
        onLoadedMetadata={(e) => onSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
      />
    </div>
  );
}
