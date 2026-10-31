// Cuts the speaker out of video frames in the browser, for graphics behind
// the speaker in the preview (stage 6). Google's MediaPipe selfie segmenter
// (Apache 2.0; public/models/selfie_segmenter.tflite), loaded only when a
// behind graphic is first shown. Its WASM runtime is bundled with the app,
// so nothing is fetched from a CDN.

import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { maskAlpha } from "@/motion/cutout";

const MODEL_URL = "/models/selfie_segmenter.tflite";
// Frames are shrunk to this width first: the model works at 256 px anyway,
// and the mask comes back at the size it was given.
const INPUT_WIDTH = 256;

export type PersonSegmenter = {
  /**
   * Draws the person mask for the video's current frame into `out` (the
   * mask's own size, its alpha the person); false when it couldn't.
   */
  maskInto: (video: HTMLVideoElement, out: HTMLCanvasElement) => boolean;
};

let loading: Promise<PersonSegmenter | null> | null = null;

/** The segmenter, loaded once; null if this browser can't run it. */
export function loadPersonSegmenter(): Promise<PersonSegmenter | null> {
  loading ??= create().catch((e) => {
    console.warn("[preview] The speaker cut-out isn't available here:", e);
    return null;
  });
  return loading;
}

async function create(): Promise<PersonSegmenter> {
  const { ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const fileset = { wasmLoaderPath, wasmBinaryPath };
  const make = (delegate: "GPU" | "CPU") =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  // The graphics card when the browser allows it, else the processor.
  let segmenter: ImageSegmenter;
  try {
    segmenter = await make("GPU");
  } catch {
    segmenter = await make("CPU");
  }
  let pixels: ImageData | null = null;
  const small = document.createElement("canvas");
  return {
    maskInto(video, out) {
      if (video.readyState < 2 || !video.videoWidth) return false;
      const w = INPUT_WIDTH;
      const h = Math.max(1, Math.round((INPUT_WIDTH * video.videoHeight) / video.videoWidth));
      if (small.width !== w || small.height !== h) {
        small.width = w;
        small.height = h;
      }
      small.getContext("2d")?.drawImage(video, 0, 0, w, h);
      const result = segmenter.segment(small);
      const mask = result.confidenceMasks?.[0];
      try {
        if (!mask) return false;
        const conf = mask.getAsFloat32Array();
        if (out.width !== mask.width || out.height !== mask.height) {
          out.width = mask.width;
          out.height = mask.height;
          pixels = null;
        }
        pixels ??= new ImageData(mask.width, mask.height);
        const d = pixels.data;
        for (let i = 0; i < conf.length; i++) {
          d[i * 4] = 255;
          d[i * 4 + 1] = 255;
          d[i * 4 + 2] = 255;
          d[i * 4 + 3] = maskAlpha(conf[i]);
        }
        out.getContext("2d")?.putImageData(pixels, 0, 0);
        return true;
      } finally {
        result.close();
      }
    },
  };
}
