// Client-side render pipeline.
//
// Plays the project's A-roll back to back with its B-roll overlaid from 0:00
// (the editor timeline's layout) into a single MP4/WebM using an offscreen
// canvas + MediaRecorder. Runs entirely in the browser so we don't
// need an external ffmpeg worker to produce a deliverable. Respects each
// clip's trim_in / trim_out and covers the target frame (no letterboxing).

export type BrowserClipInput = {
  id: string;
  download_url: string;
  role: string;
  trim_in_ms: number | null;
  trim_out_ms: number | null;
  duration_ms: number | null;
};

export type RenderOptions = {
  clips: BrowserClipInput[];
  width: number;
  height: number;
  fps?: number;
  videoBitsPerSecond?: number;
  onProgress?: (pct: number, msg: string) => void;
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

type LoadedClip = { video: HTMLVideoElement; outSec: number; targetMs: number };

async function loadClip(c: BrowserClipInput, label: string, muted: boolean): Promise<LoadedClip> {
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

  return { video, outSec, targetMs: Math.max(80, (outSec - inSec) * 1000) };
}

/** Plays a loaded clip until its out point (or a stop request); resolves with wall-clock ms. */
async function playUntilOut(
  clip: LoadedClip,
  shouldStop: () => boolean,
  onTick?: (wallMs: number) => void,
): Promise<number> {
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

function releaseClip(video: HTMLVideoElement) {
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

  const plannedTotalMs = mainClips.reduce((s, c) => {
    const inMs = c.trim_in_ms ?? 0;
    const outMs = c.trim_out_ms ?? c.duration_ms ?? inMs + 5000;
    return s + Math.max(0, outMs - inMs);
  }, 0);

  // One draw loop composites whatever is currently playing on each track.
  let currentMain: HTMLVideoElement | null = null;
  let currentBroll: HTMLVideoElement | null = null;
  let drawing = true;
  const drawCover = (video: HTMLVideoElement) => {
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    const scale = Math.max(width / vw, height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    try {
      ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
    } catch {
      /* frame not ready */
    }
  };
  const draw = () => {
    if (!drawing) return;
    // While the next main clip loads, keep its predecessor's last frame on screen.
    if (currentMain && currentMain.readyState >= 2) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      drawCover(currentMain);
    }
    if (currentBroll && currentBroll.readyState >= 2) drawCover(currentBroll);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  // B-roll track: runs alongside the main track, starting with its first clip.
  let mainDone = false;
  let brollError: unknown = null;
  let mainStarted: () => void = () => {};
  const mainStartedP = new Promise<void>((res) => {
    mainStarted = res;
  });
  const brollRun = (async () => {
    for (let i = 0; i < brollClips.length && !mainDone; i++) {
      const clip = await loadClip(brollClips[i], `B-roll clip ${i + 1}`, true);
      if (i === 0) await mainStartedP;
      if (mainDone) {
        releaseClip(clip.video);
        break;
      }
      currentBroll = clip.video;
      await playUntilOut(clip, () => mainDone);
      currentBroll = null;
      releaseClip(clip.video);
    }
  })().catch((e: unknown) => {
    brollError = e;
  });

  let elapsedMs = 0;
  let realDurationMs = 0;

  try {
    for (let i = 0; i < mainClips.length; i++) {
      const clip = await loadClip(mainClips[i], `clip ${i + 1}`, false);
      if (brollError) throw brollError;

      let srcNode: MediaElementAudioSourceNode | null = null;
      try {
        srcNode = audioCtx.createMediaElementSource(clip.video);
        srcNode.connect(dest);
      } catch {
        /* audio not routable (rare) */
      }

      currentMain = clip.video;
      if (i === 0) mainStarted();
      const wall = await playUntilOut(
        clip,
        () => brollError != null,
        (wallMs) => {
          const total = plannedTotalMs > 0 ? plannedTotalMs : clip.targetMs * mainClips.length;
          const pct = Math.min(94, 5 + Math.round(((elapsedMs + wallMs) / total) * 88));
          opts.onProgress?.(pct, `Rendering clip ${i + 1} of ${mainClips.length}`);
        },
      );
      elapsedMs += wall;
      realDurationMs += wall;

      if (srcNode) {
        try {
          srcNode.disconnect();
        } catch {
          /* noop */
        }
      }
      releaseClip(clip.video);
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
