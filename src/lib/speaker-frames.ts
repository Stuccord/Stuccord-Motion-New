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
