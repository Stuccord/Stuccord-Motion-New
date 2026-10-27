// Client-side render pipeline.
//
// Plays the project's A-roll back to back with its B-roll overlaid from 0:00
// (the editor timeline's layout) into a single MP4/WebM using an offscreen
// canvas + MediaRecorder. Runs entirely in the browser so we don't
// need an external ffmpeg worker to produce a deliverable. Respects each
// clip's trim_in / trim_out and fits each clip to the frame like the cloud export.

import { IMAGE_DEFAULT_MS, IMAGE_ZOOM, isImageFilename } from "@/lib/media-kind";
import { layoutTrack } from "@/lib/timeline-layout";
import { parseTransform, transformedBox, type ClipTransform } from "@/lib/clip-transform";

export type BrowserClipInput = {
  id: string;
  /** Used to tell images (shown for their trimmed length) from videos. */
  filename?: string | null;
  download_url: string;
  role: string;
  trim_in_ms: number | null;
  trim_out_ms: number | null;
  duration_ms: number | null;
  /** Where it starts on its track (ms); null follows the clip before it. */
  start_ms?: number | null;
  /** Moved, resized or rotated in the editor's preview (clips.transform). */
  transform?: unknown;
};

/** A clip's length on the timeline, from its trims. */
function clipLengthMs(c: BrowserClipInput): number {
  const inMs = c.trim_in_ms ?? 0;
  if (isImageFilename(c.filename ?? "")) return (c.trim_out_ms ?? IMAGE_DEFAULT_MS) - inMs;
  const outMs = c.trim_out_ms ?? c.duration_ms ?? inMs + 5000;
  return Math.max(0, outMs - inMs);
}

/** Resolves on the next animation frame once `done()` is true. */
function waitFor(done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => (done() ? resolve() : requestAnimationFrame(tick));
    tick();
  });
}

export type RenderOptions = {
  clips: BrowserClipInput[];
  width: number;
  height: number;
  fps?: number;
  videoBitsPerSecond?: number;
  onProgress?: (pct: number, msg: string) => void;
  /** The brand kit's logo, drawn in its corner on every frame (as the cloud export does). */
  logo?: { url: string; corner: "tl" | "tr" | "bl" | "br"; width: number; opacity: number } | null;
};

export type RenderResult = {
  blob: Blob;
  ext: "mp4" | "webm";
  mimeType: string;
  durationMs: number;
};

export function aspectDims(ratio: string): { w: number; h: number } {
  if (ratio === "16:9") return { w: 1920, h: 1080 };
  if (ratio === "1:1") return { w: 1080, h: 1080 };
  return { w: 1080, h: 1920 };
}

function pickMimeType(): { mimeType: string; ext: "mp4" | "webm" } {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return { mimeType: t, ext: t.startsWith("video/mp4") ? "mp4" : "webm" };
    }
  }
  throw new Error("This browser can't record video. Try Chrome or Edge.");
}

// A loaded clip: a video, or an image shown for targetMs (slowly zooming in
// from shownAt, when it went on screen).
// `transform`: moved, resized or rotated in the editor (null: the default fit).
type LoadedClip = { transform: ClipTransform | null } & (
  | { kind: "video"; video: HTMLVideoElement; outSec: number; targetMs: number }
  | { kind: "image"; image: HTMLImageElement; targetMs: number; shownAt: number | null }
);

async function loadImageClip(c: BrowserClipInput, label: string): Promise<LoadedClip> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = c.download_url;
  try {
    await image.decode();
  } catch {
    throw new Error(`Failed to load ${label}`);
  }
  const lengthMs = (c.trim_out_ms ?? IMAGE_DEFAULT_MS) - (c.trim_in_ms ?? 0);
  return {
    kind: "image",
    image,
    targetMs: Math.max(100, lengthMs),
    shownAt: null,
    transform: parseTransform(c.transform),
  };
}

async function loadClip(c: BrowserClipInput, label: string, muted: boolean): Promise<LoadedClip> {
  if (isImageFilename(c.filename ?? "")) return loadImageClip(c, label);
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.playsInline = true;
  video.preload = "auto";
  video.muted = muted;
  video.src = c.download_url;

  await new Promise<void>((res, rej) => {
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      res();
    };
    const onErr = () => {
      video.removeEventListener("error", onErr);
      rej(new Error(`Failed to load ${label}`));
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
  });

  const srcDur = isFinite(video.duration) ? video.duration : null;
  const inSec = Math.max(0, (c.trim_in_ms ?? 0) / 1000);
  const outSec = c.trim_out_ms != null ? c.trim_out_ms / 1000 : srcDur != null ? srcDur : inSec + 5;

  if (inSec > 0) {
    try {
      video.currentTime = inSec;
    } catch {
      /* seek unsupported */
    }
    await new Promise<void>((res) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        res();
      };
      video.addEventListener("seeked", done);
      setTimeout(done, 600);
    });
  }

  return {
    kind: "video",
    video,
    outSec,
    targetMs: Math.max(80, (outSec - inSec) * 1000),
    transform: parseTransform(c.transform),
  };
}

/** Plays a loaded clip until its out point (or a stop request); resolves with wall-clock ms. */
async function playUntilOut(
  clip: LoadedClip,
  shouldStop: () => boolean,
  onTick?: (wallMs: number) => void,
): Promise<number> {
  if (clip.kind === "image") {
    // Nothing to play: keep it on screen for its length.
    const start = performance.now();
    clip.shownAt = start;
    return new Promise<number>((resolve) => {
      const tick = () => {
        const wall = performance.now() - start;
        if (wall >= clip.targetMs || shouldStop()) {
          resolve(wall);
          return;
        }
        onTick?.(wall);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  const { video, outSec, targetMs } = clip;
  try {
    await video.play();
  } catch {
    /* autoplay ok since user-initiated */
  }
  const start = performance.now();
  return new Promise<number>((resolve) => {
    const tick = () => {
      const wall = performance.now() - start;
      const doneByTime = video.currentTime >= outSec - 0.02;
      const safetyBail = wall > targetMs + 4000;
      if (doneByTime || video.ended || safetyBail || shouldStop()) {
        resolve(wall);
        return;
      }
      onTick?.(wall);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function releaseClip(clip: LoadedClip) {
  if (clip.kind === "image") {
    clip.image.src = "";
    return;
  }
  const { video } = clip;
  try {
    video.pause();
  } catch {
    /* noop */
  }
  video.removeAttribute("src");
  try {
    video.load();
  } catch {
    /* noop */
  }
}

export async function renderProjectInBrowser(opts: RenderOptions): Promise<RenderResult> {
  const { width, height } = opts;
  const fps = opts.fps ?? 30;
  const videoClips = opts.clips.filter(
    (c) => c.role !== "music" && c.role !== "sfx" && c.download_url,
  );
  if (videoClips.length === 0) throw new Error("Add at least one video clip before exporting.");

  // Same layout as the editor timeline (and the cloud worker): A-roll plays
  // back to back as the main picture and sound; B-roll plays back to back from
  // 0:00 on top of it, muted, and stops where the A-roll ends. With no A-roll,
  // the B-roll is the main track.
  let mainClips = videoClips.filter((c) => c.role !== "broll");
  let brollClips = videoClips.filter((c) => c.role === "broll");
  if (mainClips.length === 0) {
    mainClips = brollClips;
    brollClips = [];
  }

  // The brand logo, loaded before recording starts (skipped if it can't load).
  let logoImage: HTMLImageElement | null = null;
  if (opts.logo) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = opts.logo.url;
    logoImage = await img.decode().then(
      () => img,
      () => null,
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const AudioCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtor();
  const dest = audioCtx.createMediaStreamDestination();

  const videoStream = canvas.captureStream(fps);
  const combined = new MediaStream();
  for (const t of videoStream.getVideoTracks()) combined.addTrack(t);
  for (const t of dest.stream.getAudioTracks()) combined.addTrack(t);

  const { mimeType, ext } = pickMimeType();
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: opts.videoBitsPerSecond ?? 8_000_000,
    audioBitsPerSecond: 160_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((res) => {
    recorder.onstop = () => res();
  });
  recorder.start(250);

  // Where each clip starts on its track (placed, or right after the one
  // before), like the editor timeline and the cloud export.
  const mainLayout = layoutTrack(mainClips, clipLengthMs);
  const brollLayout = layoutTrack(brollClips, clipLengthMs);
  // The video runs until the last clip on either track ends (videoEndMs in
  // timeline-layout): B-roll past the main track plays on over black.
  const plannedTotalMs = Math.max(mainLayout.endMs, brollLayout.endMs);

  // One draw loop composites whatever is currently playing on each track.
  let currentMain: LoadedClip | null = null;
  let currentBroll: LoadedClip | null = null;
  let drawing = true;
  // A gap in the main track: black (and silence) until the next clip.
  let inGap = false;
  // How far the main track has got (ms of recording); B-roll waits for it.
  let mainPosMs = 0;
  // A tenth-size canvas for the blurred background: drawn small, then
  // stretched back up, which blurs it without ctx.filter (Safari lacks it).
  const blurCanvas = document.createElement("canvas");
  blurCanvas.width = Math.max(2, Math.round(width / 10));
  blurCanvas.height = Math.max(2, Math.round(height / 10));
  const blurCtx = blurCanvas.getContext("2d");
  // A blurred, darker copy of the picture, filling the frame.
  const drawBlur = (picture: CanvasImageSource, vw: number, vh: number) => {
    if (!blurCtx) return;
    const bw = blurCanvas.width;
    const bh = blurCanvas.height;
    const small = Math.max(bw / vw, bh / vh);
    blurCtx.drawImage(
      picture,
      (bw - vw * small) / 2,
      (bh - vh * small) / 2,
      vw * small,
      vh * small,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(blurCanvas, 0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, width, height);
  };
  // Like the cloud export: clips (nearly) the frame's shape fill it; others
  // are shown whole over a blurred, darker copy of themselves. A clip moved,
  // resized or rotated in the editor fills its box instead; on the main
  // track its blurred copy stays behind it, on top (B-roll) the main video
  // shows around it. An image also zooms in slowly over its time on screen.
  const drawFit = (clip: LoadedClip, onTop: boolean) => {
    const video = clip.kind === "video" ? clip.video : clip.image;
    const vw = (clip.kind === "video" ? clip.video.videoWidth : clip.image.naturalWidth) || width;
    const vh =
      (clip.kind === "video" ? clip.video.videoHeight : clip.image.naturalHeight) || height;
    const zoom =
      clip.kind === "image" && clip.shownAt != null
        ? 1 + IMAGE_ZOOM * Math.min(1, (performance.now() - clip.shownAt) / clip.targetMs)
        : 1;
    const cover = Math.max(width / vw, height / vh) * zoom;
    try {
      if (clip.transform) {
        if (!onTop) drawBlur(video, vw, vh);
        const b = transformedBox(vw, vh, width, height, clip.transform);
        ctx.save();
        ctx.translate(b.cx, b.cy);
        ctx.rotate((b.rotation * Math.PI) / 180);
        ctx.beginPath();
        ctx.rect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.clip();
        const fill = Math.max(b.w / vw, b.h / vh) * zoom;
        ctx.drawImage(video, (-vw * fill) / 2, (-vh * fill) / 2, vw * fill, vh * fill);
        ctx.restore();
        return;
      }
      if (Math.abs(Math.log(vw / vh / (width / height))) < 0.03 || !blurCtx) {
        const dw = vw * cover;
        const dh = vh * cover;
        ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
        return;
      }
      drawBlur(video, vw, vh);
      const contain = Math.min(width / vw, height / vh) * zoom;
      const dw = vw * contain;
      const dh = vh * contain;
      ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
    } catch {
      /* frame not ready */
    }
  };
  const isReady = (clip: LoadedClip) =>
    clip.kind === "image" ? clip.image.complete : clip.video.readyState >= 2;
  const draw = () => {
    if (!drawing) return;
    // While the next main clip loads, keep its predecessor's last frame on screen.
    if (inGap) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
    } else if (currentMain && isReady(currentMain)) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      drawFit(currentMain, false);
    }
    if (currentBroll && isReady(currentBroll)) drawFit(currentBroll, true);
    if (logoImage && opts.logo) {
      // Its corner, 4% of the shorter side in from the edges.
      const lw = width * opts.logo.width;
      const lh = (lw * logoImage.naturalHeight) / Math.max(1, logoImage.naturalWidth);
      const m = Math.min(width, height) * 0.04;
      const x = opts.logo.corner.endsWith("l") ? m : width - lw - m;
      const y = opts.logo.corner.startsWith("t") ? m : height - lh - m;
      ctx.globalAlpha = opts.logo.opacity;
      ctx.drawImage(logoImage, x, y, lw, lh);
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  // B-roll track: runs alongside the main track, each clip from its own
  // start time, silent until the main track ends and heard after it.
  let mainDone = false;
  let brollError: unknown = null;
  let brollFinished = false;
  // Past the main track's end: the B-roll's sound goes into the recording.
  let tail = false;
  const brollGains = new Set<GainNode>();
  let mainStarted: () => void = () => {};
  const mainStartedP = new Promise<void>((res) => {
    mainStarted = res;
  });
  const brollRun = (async () => {
    for (let i = 0; i < brollClips.length && !mainDone; i++) {
      const clip = await loadClip(brollClips[i], `B-roll clip ${i + 1}`, true);
      if (i === 0) await mainStartedP;
      const startMs = brollLayout.starts.get(brollClips[i].id) ?? 0;
      await waitFor(() => mainDone || mainPosMs >= startMs);
      if (mainDone) {
        releaseClip(clip);
        break;
      }
      // Its sound, routed into the recording: off until the main track ends.
      let gain: GainNode | null = null;
      if (clip.kind === "video") {
        try {
          const src = audioCtx.createMediaElementSource(clip.video);
          gain = audioCtx.createGain();
          gain.gain.value = tail ? 1 : 0;
          src.connect(gain).connect(dest);
          clip.video.muted = false;
          brollGains.add(gain);
        } catch {
          /* audio not routable (rare) */
        }
      }
      currentBroll = clip;
      await playUntilOut(clip, () => mainDone);
      currentBroll = null;
      if (gain) {
        brollGains.delete(gain);
        gain.disconnect();
      }
      releaseClip(clip);
    }
  })()
    .catch((e: unknown) => {
      brollError = e;
    })
    .finally(() => {
      brollFinished = true;
    });

  let elapsedMs = 0;
  let realDurationMs = 0;

  try {
    for (let i = 0; i < mainClips.length; i++) {
      const clip = await loadClip(mainClips[i], `clip ${i + 1}`, false);
      if (brollError) throw brollError;
      if (i === 0) mainStarted();

      // A gap before this clip (it was placed later): black and silence.
      const gapMs = (mainLayout.starts.get(mainClips[i].id) ?? elapsedMs) - elapsedMs;
      if (gapMs > 30) {
        inGap = true;
        const gapStart = performance.now();
        await waitFor(() => {
          mainPosMs = elapsedMs + (performance.now() - gapStart);
          return performance.now() - gapStart >= gapMs || brollError != null;
        });
        inGap = false;
        elapsedMs += gapMs;
        realDurationMs += gapMs;
      }

      // An image has no sound: the recording stays silent while it shows.
      let srcNode: MediaElementAudioSourceNode | null = null;
      if (clip.kind === "video") {
        try {
          srcNode = audioCtx.createMediaElementSource(clip.video);
          srcNode.connect(dest);
        } catch {
          /* audio not routable (rare) */
        }
      }

      currentMain = clip;
      const wall = await playUntilOut(
        clip,
        () => brollError != null,
        (wallMs) => {
          mainPosMs = elapsedMs + wallMs;
          const total = plannedTotalMs > 0 ? plannedTotalMs : clip.targetMs * mainClips.length;
          const pct = Math.min(94, 5 + Math.round(((elapsedMs + wallMs) / total) * 88));
          opts.onProgress?.(pct, `Rendering clip ${i + 1} of ${mainClips.length}`);
        },
      );
      elapsedMs += wall;
      realDurationMs += wall;
      mainPosMs = elapsedMs;

      if (srcNode) {
        try {
          srcNode.disconnect();
        } catch {
          /* noop */
        }
      }
      releaseClip(clip);
      if (brollError) throw brollError;
    }

    // B-roll running past the main track: keep recording (black behind it,
    // its own sound now heard) until the last of it ends.
    const tailMs = brollLayout.endMs - elapsedMs;
    if (tailMs > 30 && !brollFinished) {
      inGap = true;
      tail = true;
      for (const g of brollGains) g.gain.value = 1;
      const tailStart = performance.now();
      await waitFor(() => {
        const wall = performance.now() - tailStart;
        mainPosMs = elapsedMs + wall;
        opts.onProgress?.(
          Math.min(94, 5 + Math.round((mainPosMs / plannedTotalMs) * 88)),
          "Rendering the end (B-roll)",
        );
        return wall >= tailMs || brollFinished || brollError != null;
      });
      const wall = performance.now() - tailStart;
      elapsedMs += wall;
      realDurationMs += wall;
      if (brollError) throw brollError;
    }
  } finally {
    mainDone = true;
    mainStarted();
    await brollRun;
    drawing = false;
    opts.onProgress?.(96, "Finalizing");
    try {
      recorder.stop();
    } catch {
      /* noop */
    }
    await stopped;
    try {
      await audioCtx.close();
    } catch {
      /* noop */
    }
  }

  const blob = new Blob(chunks, { type: mimeType });
  return { blob, ext, mimeType, durationMs: Math.round(realDurationMs) };
}
