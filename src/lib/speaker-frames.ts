// Picks clear frames of the speaker from a clip, in the browser, for making
// their cartoon (stage 8): frames where the person is big, near the middle
// and sharp. Uses the same person segmenter as the cut-out (stage 6).

import { loadPersonSegmenter } from "@/lib/person-segmenter";

// The photo sent to the image model: plenty for a likeness.
const PHOTO_WIDTH = 1280;
// Frames this small are enough to judge sharpness.
const SHARP_WIDTH = 160;
const TIMEOUT_MS = 40_000;

export type SpeakerFrame = { time_ms: number; photo: Blob; score: number };

/** How much of the frame is the person, and where their middle is (0-1). */
export function personShare(alpha: Uint8ClampedArray, width: number, height: number) {
  let n = 0;
  let sx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3] > 127) {
        n++;
        sx += x;
      }
    }
  }
  return { share: n / (width * height), centreX: n ? sx / n / width : 0.5 };
}

/** Mean edge strength of a frame's grey levels (higher is sharper). */
export function sharpness(rgba: Uint8ClampedArray, width: number, height: number) {
  const grey = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      sum += Math.abs(4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * A frame's score: a person filling a good part of it (up to about half),
 * near the middle, sharp. 0 when there's hardly anyone in it.
 */
export function frameScore(share: number, centreX: number, sharp: number, sharpest: number) {
  if (share < 0.05) return 0;
  const size = Math.min(share, 0.45) / 0.45;
  const centred = 1 - Math.min(1, Math.abs(centreX - 0.5) * 2);
  const crisp = sharpest > 0 ? sharp / sharpest : 0;
  return size * (0.5 + 0.5 * centred) * (0.4 + 0.6 * crisp);
}

/**
 * The best frames of the speaker at `timesMs` (file time), best first, as
 * JPEG photos; [] when no frame shows a person, null when the video
 * couldn't be read.
 */
export async function pickSpeakerFrames(
  src: string,
  timesMs: number[],
  keep = 3,
): Promise<SpeakerFrame[] | null> {
  const segmenter = await loadPersonSegmenter();
  if (!segmenter) return null;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const photo = document.createElement("canvas");
    const small = document.createElement("canvas");
    const mask = document.createElement("canvas");
    const seen: { time_ms: number; photo: Blob; share: number; centreX: number; sharp: number }[] =
      [];
    let i = 0;
    let done = false;
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);

    function finish(ok: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      if (!ok) return resolve(null);
      const sharpest = Math.max(0, ...seen.map((f) => f.sharp));
      resolve(
        seen
          .map((f) => ({
            time_ms: f.time_ms,
            photo: f.photo,
            score: frameScore(f.share, f.centreX, f.sharp, sharpest),
          }))
          .filter((f) => f.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, keep),
      );
    }
    const next = () => {
      if (i >= timesMs.length) return finish(true);
      video.currentTime = Math.min(timesMs[i] / 1000, Math.max(0, (video.duration || 0) - 0.05));
    };

    video.addEventListener("error", () => finish(false));
    video.addEventListener("loadedmetadata", () => {
      const ratio =
        video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
      photo.width = Math.min(PHOTO_WIDTH, video.videoWidth || PHOTO_WIDTH);
      photo.height = Math.max(1, Math.round(photo.width * ratio));
      small.width = SHARP_WIDTH;
      small.height = Math.max(1, Math.round(SHARP_WIDTH * ratio));
      next();
    });
    video.addEventListener("seeked", async () => {
      const time = timesMs[i];
      i++;
      try {
        const g = small.getContext("2d", { willReadFrequently: true });
        const p = photo.getContext("2d");
        if (!g || !p || !segmenter.maskInto(video, mask)) return next();
        const m = mask.getContext("2d", { willReadFrequently: true });
        if (!m) return next();
        const { share, centreX } = personShare(
          m.getImageData(0, 0, mask.width, mask.height).data,
          mask.width,
          mask.height,
        );
        g.drawImage(video, 0, 0, small.width, small.height);
        const sharp = sharpness(
          g.getImageData(0, 0, small.width, small.height).data,
          small.width,
          small.height,
        );
        if (share >= 0.05) {
          p.drawImage(video, 0, 0, photo.width, photo.height);
          const blob = await new Promise<Blob | null>((r) => photo.toBlob(r, "image/jpeg", 0.9));
          if (blob) seen.push({ time_ms: time, photo: blob, share, centreX, sharp });
        }
      } catch {
        // A cross-origin frame can't be read back.
        return finish(false);
      }
      next();
    });
    video.src = src;
  });
}

/**
 * Frames of a clip at `timesMs` (file time) as JPEG photos, for pictures the
 * user hasn't uploaded (stage 9b); null when the video couldn't be read.
 */
export function grabFrames(src: string, timesMs: number[], width = 960): Promise<Blob[] | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    const out: Blob[] = [];
    let i = 0;
    let done = false;
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);

    function finish(ok: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(ok ? out : null);
    }
    const next = () => {
      if (i >= timesMs.length) return finish(true);
      video.currentTime = Math.min(timesMs[i] / 1000, Math.max(0, (video.duration || 0) - 0.05));
    };

    video.addEventListener("error", () => finish(false));
    video.addEventListener("loadedmetadata", () => {
      const ratio =
        video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
      canvas.width = Math.min(width, video.videoWidth || width);
      canvas.height = Math.max(1, Math.round(canvas.width * ratio));
      next();
    });
    video.addEventListener("seeked", async () => {
      i++;
      try {
        const g = canvas.getContext("2d");
        if (!g) return finish(false);
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
        if (blob) out.push(blob);
      } catch {
        // A cross-origin frame can't be read back.
        return finish(false);
      }
      next();
    });
    video.src = src;
  });
}

/**
 * Where the speaker's face is in a frame's person mask (0-1 of the frame):
 * across the middle of the head, about an eighth of the person's height
 * below the top of their head. Null when there's hardly anyone.
 */
export function faceInMask(alpha: Uint8ClampedArray, width: number, height: number) {
  const rowCount = (y: number) => {
    let n = 0;
    for (let x = 0; x < width; x++) if (alpha[(y * width + x) * 4 + 3] > 127) n++;
    return n;
  };
  const enough = Math.max(2, width * 0.03);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    if (rowCount(y) >= enough) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  if (top < 0 || bottom - top < height * 0.1) return null;
  const personH = bottom - top;
  // The head: the top quarter of the person.
  let sx = 0;
  let n = 0;
  for (let y = top; y <= top + personH * 0.25; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3] > 127) {
        sx += x;
        n++;
      }
    }
  }
  if (!n) return null;
  return { x: sx / n / width, y: Math.min(1, (top + personH * 0.12) / height) };
}

/**
 * Where the speaker's face is in a clip, from frames at `timesMs` (the
 * middle of what's found, 0-1 of the clip's own frame), with the clip's
 * shape (width / height); null when no one was found or the video couldn't
 * be read.
 */
export async function findSpeakerFace(
  src: string,
  timesMs: number[],
): Promise<{ x: number; y: number; ratio: number } | null> {
  const segmenter = await loadPersonSegmenter();
  if (!segmenter) return null;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const mask = document.createElement("canvas");
    const found: { x: number; y: number }[] = [];
    let ratio = 16 / 9;
    let i = 0;
    let done = false;
    const timer = setTimeout(() => finish(), TIMEOUT_MS);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      if (!found.length) return resolve(null);
      const mid = (vals: number[]) => vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)];
      resolve({ x: mid(found.map((f) => f.x)), y: mid(found.map((f) => f.y)), ratio });
    }
    const next = () => {
      if (i >= timesMs.length) return finish();
      video.currentTime = Math.min(timesMs[i] / 1000, Math.max(0, (video.duration || 0) - 0.05));
    };
    video.addEventListener("error", () => finish());
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth && video.videoHeight) ratio = video.videoWidth / video.videoHeight;
      next();
    });
    video.addEventListener("seeked", () => {
      i++;
      try {
        if (segmenter.maskInto(video, mask)) {
          const m = mask.getContext("2d", { willReadFrequently: true });
          const face = m
            ? faceInMask(
                m.getImageData(0, 0, mask.width, mask.height).data,
                mask.width,
                mask.height,
              )
            : null;
          if (face) found.push(face);
        }
      } catch {
        // A cross-origin frame can't be read back.
        return finish();
      }
      next();
    });
    video.src = src;
  });
}

/**
 * A point in a clip's own frame (0-1) as a point in the video's frame, for a
 * clip fitted inside it (letterboxed, as the editor and the export show it).
 */
export function clipPointInFrame(
  point: { x: number; y: number },
  clipRatio: number,
  frameRatio: number,
): { x: number; y: number } {
  if (clipRatio < frameRatio) {
    const share = clipRatio / frameRatio;
    return { x: 0.5 + (point.x - 0.5) * share, y: point.y };
  }
  const share = frameRatio / clipRatio;
  return { x: point.x, y: 0.5 + (point.y - 0.5) * share };
}
