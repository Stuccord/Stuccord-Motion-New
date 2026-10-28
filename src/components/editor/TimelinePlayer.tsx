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
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { IMAGE_ZOOM, isImageFilename } from "@/lib/media-kind";
import { layoutTrack } from "@/lib/timeline-layout";
import { parseTransform, transformedBox, type ClipTransform } from "@/lib/clip-transform";
import { TransformBox, type BoxTarget } from "./TransformBox";
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
  /** Whether the clips' own sound is lowered at a time (under a voiceover). */
  duckAt?: (timeMs: number) => boolean;
  /** The playhead moved (seconds); called a few times a second while playing. */
  onTime?: (seconds: number) => void;
  /** The length of the edit (seconds), when it's known or changes. */
  onDuration?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Every frame while playing and after each seek (for music and SFX). */
  onTick?: (timeMs: number, playing: boolean, rate: number) => void;
  /** Drawn over the picture at the current time (captions, hook). */
  renderOverlay?: (timeMs: number) => React.ReactNode;
  /** How much the picture (not the overlay) is zoomed in at a time; 1 or none: not zoomed. */
  pictureScale?: (timeMs: number) => number;
  /** A clip's file stopped downloading: get a fresh link for it (by storage path). */
  onStall?: (storagePath: string) => void;
  /** The selected clip: gets a box with handles when it's on screen. */
  selectedClipId?: string | null;
  /** A clip was pressed in the picture. */
  onSelectClip?: (id: string) => void;
  /** A clip was moved, resized or rotated (null: back to its default fit). */
  onTransform?: (id: string, transform: ClipTransform | null) => void;
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
    duckAt,
    onTime,
    onDuration,
    onPlayingChange,
    onTick,
    renderOverlay,
    pictureScale,
    onStall,
    selectedClipId = null,
    onSelectClip,
    onTransform,
  },
  ref,
) {
  // The tracks as the export plays them: the main track, and B-roll on top.
  // Laid out again only when a clip's place, length, file or transform
  // changes (the editor hands over new arrays on every render).
  const layoutKey = JSON.stringify(
    [aRoll, bRoll].map((list) =>
      list.map((c) => [
        c.id,
        c.start_ms ?? null,
        lengthMs(c),
        c.storage_path,
        c.filename,
        c.transform ?? null,
      ]),
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
  // The main track's end, and the video's: it runs until the last clip on
  // either track ends (B-roll past the main track plays on, with its sound).
  const mainEndMs = placed.main.length ? placed.main[placed.main.length - 1].end : 0;
  const endMs = Math.max(
    mainEndMs,
    placed.over.length ? placed.over[placed.over.length - 1].end : 0,
  );

  // The playhead (ms): a ref for the clock, state for drawing.
  const timeRef = useRef(0);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const endedRef = useRef(false);
  const rateRef = useRef(1);
  const videos = useRef(new Map<string, HTMLVideoElement>());

  // Latest values for the stable handle and the clock.
  const latest = useRef({
    placed,
    endMs,
    mainEndMs,
    muted,
    duckAt,
    onTime,
    onPlayingChange,
    onTick,
  });
  latest.current = { placed, endMs, mainEndMs, muted, duckAt, onTime, onPlayingChange, onTick };

  const activeAt = (list: Placed[], t: number) => list.find((p) => t >= p.start && t < p.end);
  const findPlaced = (id: string) =>
    latest.current.placed.main.find((p) => p.clip.id === id) ??
    latest.current.placed.over.find((p) => p.clip.id === id);

  /** Puts every loaded video where it should be for time `time`. */
  const sync = useCallback((time: number) => {
    // At the very end, the last frame stays on screen.
    const t = Math.min(time, Math.max(0, latest.current.endMs - 1));
    // Under a voiceover the clips are quieter, like the export (about 10 dB).
    const volume = latest.current.duckAt?.(t) ? 0.32 : 1;
    for (const [id, el] of videos.current) {
      const p = findPlaced(id);
      if (!p) continue;
      const active = t >= p.start && t < p.end;
      const trimIn = (p.clip.trim_in_ms ?? 0) / 1000;
      const target = trimIn + Math.max(0, Math.min(t, p.end - 1) - p.start) / 1000;
      el.playbackRate = rateRef.current;
      // B-roll is silent over the main track, heard once the main track ends.
      el.muted = (p.track === "over" && t < latest.current.mainEndMs) || latest.current.muted;
      if (el.volume !== volume) el.volume = volume;
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
      } else if (el && el.readyState < 2 && !el.ended && !el.error) {
        // Loading: wait for it. (One that can't play doesn't hold the playhead.)
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

  // Each file's own size, for its box in the frame.
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  // A transform being dragged (shown, not saved yet), or just saved and not
  // back from the server yet.
  const [draft, setDraft] = useState<{ id: string; t: ClipTransform | null } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );
  const transformOf = (clip: ClipRow) =>
    draft?.id === clip.id ? draft.t : parseTransform(clip.transform);
  // The saved transform came back: stop showing the draft.
  const draftClip = draft
    ? [...placed.main, ...placed.over].find((p) => p.clip.id === draft.id)?.clip
    : undefined;
  const savedKey = JSON.stringify(parseTransform(draftClip?.transform));
  useEffect(() => {
    if (draft && JSON.stringify(draft.t) === savedKey) setDraft(null);
    // Only when the saved value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // What the box can grab: the clips showing now, top-most first.
  const targets: BoxTarget[] = [activeAt(placed.over, t), mainActive]
    .filter((p): p is Placed => p != null && Boolean(urls[p.clip.storage_path]))
    .map((p) => {
      const size = sizes[p.clip.storage_path];
      const tr = transformOf(p.clip);
      const fitsDifferently =
        size != null && Math.abs(Math.log(size.w / size.h / frameRatio)) >= 0.03;
      return {
        id: p.clip.id,
        srcW: size?.w ?? 0,
        srcH: size?.h ?? 0,
        transform: tr,
        // An untransformed clip over its blurred copy covers the whole frame.
        fillsFrame: !tr && fitsDifferently,
      };
    });

  return (
    // The picture is clipped to the frame (with its rounded corners); the
    // handles aren't.
    <div className="absolute inset-0 rounded-[inherit]">
      <div className="absolute inset-0 bg-black overflow-hidden rounded-[inherit]">
        {/* The picture, zoomed when a Motion Explainer zoom is on (around the
            upper middle, where a face usually is). */}
        <div
          className="absolute inset-0"
          style={
            (pictureScale?.(t) ?? 1) !== 1
              ? { transform: `scale(${pictureScale!(t)})`, transformOrigin: "50% 40%" }
              : undefined
          }
        >
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
                transform={transformOf(p.clip)}
                videoRef={(el) => {
                  if (el) videos.current.set(p.clip.id, el);
                  else videos.current.delete(p.clip.id);
                }}
                onSize={(w, h) =>
                  setSizes((old) =>
                    old[p.clip.storage_path]?.w === w && old[p.clip.storage_path]?.h === h
                      ? old
                      : { ...old, [p.clip.storage_path]: { w, h } },
                  )
                }
                onReady={() => sync(timeRef.current)}
                onStall={() => onStall?.(p.clip.storage_path)}
              />
            );
          })}
        </div>
        {mainActive && !urls[mainActive.clip.storage_path] && (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-neutral-500">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </span>
          </div>
        )}
        {renderOverlay?.(t)}
      </div>
      {onTransform && (
        <TransformBox
          targets={targets}
          selectedId={selectedClipId}
          enabled={!playing}
          onSelect={(id) => onSelectClip?.(id)}
          onDraft={(id, tr) => {
            if (draftTimer.current) clearTimeout(draftTimer.current);
            setDraft({ id, t: tr });
          }}
          onCommit={(id, tr) => {
            setDraft({ id, t: tr });
            // If the save fails, show the saved value again after a while.
            if (draftTimer.current) clearTimeout(draftTimer.current);
            draftTimer.current = setTimeout(() => setDraft(null), 8000);
            onTransform(id, tr);
          }}
        />
      )}
    </div>
  );
});

/**
 * Where a clip's picture goes in the frame (CSS). Untransformed: the whole
 * frame, as before. Moved, resized or rotated: its box (see clip-transform).
 */
function boxStyle(
  transform: ClipTransform | null,
  size: { w: number; h: number } | null,
  frameRatio: number,
): React.CSSProperties {
  if (!transform) return { inset: 0 };
  // In units of the frame's height (the frame is frameRatio wide).
  const b = transformedBox(size?.w ?? 0, size?.h ?? 0, frameRatio, 1, transform);
  return {
    left: `${((b.cx - b.w / 2) / frameRatio) * 100}%`,
    top: `${(b.cy - b.h / 2) * 100}%`,
    width: `${(b.w / frameRatio) * 100}%`,
    height: `${b.h * 100}%`,
    transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
    overflow: "hidden",
  };
}

/** One clip in the player: a video or an image, fitted to the frame. */
function Layer({
  placed: p,
  url,
  active,
  timeMs,
  frameRatio,
  transform,
  videoRef,
  onSize,
  onReady,
  onStall,
}: {
  placed: Placed;
  url: string;
  active: boolean;
  timeMs: number;
  frameRatio: number;
  /** Moved, resized or rotated; null: the default fit. */
  transform: ClipTransform | null;
  videoRef: (el: HTMLVideoElement | null) => void;
  onSize: (w: number, h: number) => void;
  onReady: () => void;
  onStall: () => void;
}) {
  const [size, setSizeState] = useState<{ w: number; h: number } | null>(null);
  const setSize = (next: { w: number; h: number }) => {
    setSizeState(next);
    onSize(next.w, next.h);
  };
  const mismatched =
    size != null &&
    size.w > 0 &&
    size.h > 0 &&
    Math.abs(Math.log(size.w / size.h / frameRatio)) >= 0.03;
  const zIndex = p.track === "over" ? 2 : 1;
  const style: React.CSSProperties = { zIndex, visibility: active ? "visible" : "hidden" };
  // Behind the picture: its blurred copy, filling the frame. A main clip
  // keeps it when moved or resized; a B-roll clip that's been moved or
  // resized shows the main video around it instead.
  const blurBehind = transform ? p.track === "main" : mismatched;
  const box = boxStyle(transform, size, frameRatio);
  // In its own box the picture fills it (the box has the right shape).
  const fit = transform || !mismatched ? "object-cover" : "object-contain";

  if (isImage(p.clip)) {
    // The slow push-in, by where the playhead is in the clip.
    const progress = Math.min(1, Math.max(0, (timeMs - p.start) / Math.max(1, p.end - p.start)));
    const zoom = 1 + IMAGE_ZOOM * progress;
    return (
      <div className="absolute inset-0" style={style}>
        {blurBehind && (
          <img
            src={url}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl brightness-75"
          />
        )}
        <div className="absolute" style={box}>
          <img
            src={url}
            alt=""
            className={cn("absolute inset-0 w-full h-full", fit)}
            style={{ transform: `scale(${zoom})` }}
            onLoad={(e) =>
              setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
        </div>
      </div>
    );
  }
  return (
    <VideoLayer
      url={url}
      style={style}
      blurBehind={blurBehind}
      box={box}
      fit={fit}
      frameRatio={frameRatio}
      active={active}
      videoRef={videoRef}
      onSize={(w, h) => {
        setSize({ w, h });
        onReady();
      }}
      onStall={onStall}
    />
  );
}

/** A video in the player, in its box, with its blurred copy behind it when asked. */
function VideoLayer({
  url,
  style,
  blurBehind,
  box,
  fit,
  frameRatio,
  active,
  videoRef,
  onSize,
  onStall,
}: {
  url: string;
  style: React.CSSProperties;
  blurBehind: boolean;
  box: React.CSSProperties;
  fit: string;
  frameRatio: number;
  active: boolean;
  videoRef: (el: HTMLVideoElement | null) => void;
  onSize: (w: number, h: number) => void;
  /** The download stalled: ask for a fresh link (the old one may have expired). */
  onStall: () => void;
}) {
  const el = useRef<HTMLVideoElement | null>(null);
  const onStallRef = useRef(onStall);
  onStallRef.current = onStall;
  const bg = useRef<HTMLCanvasElement>(null);
  // Shown over the frame: still loading (or buffering), or the browser can't
  // play it. Read from the video itself (not from single events, which a
  // paused video may never send again after a seek), checked on its events
  // and every second while it isn't ready.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Reloads after a stalled download (none of it arriving for a while).
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const video = el.current;
    if (!video) return;
    let buffering = false;
    let lastProgress = performance.now();
    let reloads = 0;
    const refresh = () => {
      const next = video.error
        ? "error"
        : video.readyState < 2 || (buffering && !video.paused)
          ? "loading"
          : "ready";
      setStatus(next);
      if (next === "ready") {
        reloads = 0;
        setRetrying(false);
      }
    };
    const onWaiting = () => {
      buffering = true;
      refresh();
    };
    const onFlowing = () => {
      buffering = false;
      refresh();
    };
    const onProgress = () => {
      lastProgress = performance.now();
      refresh();
    };
    const onLoadStart = () => {
      buffering = false;
      lastProgress = performance.now();
      refresh();
    };
    const flowing = ["playing", "canplay", "canplaythrough", "seeked", "pause"];
    const checks = ["loadedmetadata", "loadeddata", "timeupdate", "seeking", "emptied", "error"];
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("progress", onProgress);
    video.addEventListener("loadstart", onLoadStart);
    for (const ev of flowing) video.addEventListener(ev, onFlowing);
    for (const ev of checks) video.addEventListener(ev, refresh);
    const timer = setInterval(() => {
      refresh();
      // Nothing to show and nothing arriving for 8 s: the download has
      // stalled (an expired link, or the browser holding the request).
      // Ask for a fresh link, which reloads the video, and load again
      // meanwhile (the player puts it back in place).
      const starved = !video.error && video.readyState < 2 && video.networkState !== 3;
      if (starved && performance.now() - lastProgress > 8000 && reloads < 4) {
        reloads++;
        lastProgress = performance.now();
        setRetrying(true);
        console.warn("[preview] Video download stalled; retrying with a fresh link", {
          try: reloads,
          readyState: video.readyState,
          networkState: video.networkState,
          buffered: video.buffered.length
            ? `${video.buffered.start(0).toFixed(1)}-${video.buffered.end(video.buffered.length - 1).toFixed(1)}s`
            : "none",
          at: video.currentTime.toFixed(1),
        });
        onStallRef.current();
        video.load();
      }
    }, 1000);
    refresh();
    return () => {
      clearInterval(timer);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("loadstart", onLoadStart);
      for (const ev of flowing) video.removeEventListener(ev, onFlowing);
      for (const ev of checks) video.removeEventListener(ev, refresh);
    };
  }, [url]);
  // The blurred copy: the video drawn small into a canvas each frame it shows.
  useEffect(() => {
    const video = el.current;
    const canvas = bg.current;
    const g = canvas?.getContext("2d");
    if (!blurBehind || !active || !video || !canvas || !g) return;
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
  }, [blurBehind, active]);

  return (
    <div className="absolute inset-0" style={style}>
      {blurBehind && (
        <canvas
          ref={bg}
          aria-hidden
          width={frameRatio >= 1 ? 64 : Math.round(64 * frameRatio)}
          height={frameRatio >= 1 ? Math.round(64 / frameRatio) : 64}
          className="absolute inset-0 w-full h-full scale-110 blur-xl brightness-75"
        />
      )}
      <div className="absolute" style={box}>
        <video
          ref={(v) => {
            el.current = v;
            videoRef(v);
          }}
          src={url}
          preload="auto"
          playsInline
          muted
          className={cn("absolute inset-0 w-full h-full", fit)}
          onLoadedMetadata={(e) => onSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
        />
      </div>
      {status !== "ready" && (
        <div className="absolute inset-0 z-10 grid place-items-center p-4 text-center pointer-events-none">
          {status === "loading" ? (
            <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {retrying ? "Still loading, trying again…" : "Loading video…"}
            </span>
          ) : (
            <span className="text-[11px] leading-snug text-neutral-400 max-w-[16rem]">
              This clip can&apos;t play in the browser preview. The export will still include it.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
