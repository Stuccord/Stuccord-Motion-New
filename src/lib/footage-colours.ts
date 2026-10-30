// Reads the colours of the set from a clip's first frames, in the browser
// (like the timeline's filmstrips, src/lib/clip-strips.ts), for the Motion
// Explainer graphics' colour (src/motion/colour.ts).

import { footageColours, type Pixels } from "@/motion/colour";

// Frames this small are plenty for colours and quick to read.
const SAMPLE_WIDTH = 96;
const TIMEOUT_MS = 20_000;

/**
 * The set's colours from the frames at `timesMs` (file time), strongest
 * first; [] when the set is grey; null when the video couldn't be read.
 */
export function readFootageColours(src: string, timesMs: number[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    const frames: Pixels[] = [];
    let i = 0;
    let done = false;
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);

    function finish(ok: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(ok && frames.length ? footageColours(frames) : null);
    }
    const next = () => {
      if (i >= timesMs.length) return finish(true);
      video.currentTime = Math.min(timesMs[i] / 1000, Math.max(0, (video.duration || 0) - 0.05));
    };

    video.addEventListener("error", () => finish(false));
    video.addEventListener("loadedmetadata", () => {
      const ratio =
        video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
      canvas.width = SAMPLE_WIDTH;
      canvas.height = Math.max(1, Math.round(SAMPLE_WIDTH * ratio));
      next();
    });
    video.addEventListener("seeked", () => {
      try {
        const g = canvas.getContext("2d", { willReadFrequently: true });
        if (!g) return finish(false);
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(g.getImageData(0, 0, canvas.width, canvas.height));
      } catch {
        // A cross-origin frame can't be read back.
        return finish(false);
      }
      i++;
      next();
    });
    video.src = src;
  });
}
