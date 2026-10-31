// Graphics behind the speaker in the export (stage 6). Mirrors
// src/motion/cutout.ts (the editor's preview): while a behind graphic is on
// screen the room darkens and softly blurs, the graphic goes over it, and
// the speaker, cut out by an AI person mask, stays in front.
//
// The mask comes from Google's MediaPipe selfie segmenter (Apache 2.0), the
// same model the preview uses, converted to ONNX (models/README.md) and run
// with onnxruntime-node on the processor, only for the frames that need it.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PERSON_MODEL = path.join(here, "models", "selfie_segmenter.onnx");

const FPS = 30;
export const BEHIND_FADE_FRAMES = 9;
export const BEHIND_DARKEN = 0.45;
export const BEHIND_BLUR = 0.006;
// The model's input and output size.
const MASK_SIZE = 256;
const MASK_LOW = 0.3;
const MASK_HIGH = 0.7;

/** Frame stretches with a behind graphic on screen (touching ones joined). */
export function behindRanges(graphics) {
  const spans = graphics
    .filter((g) => g.behind && g.to > g.from)
    .map((g) => [g.from, g.to])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** How long a stretch's fades are (frames). */
export function behindFade([a, b]) {
  return Math.min(BEHIND_FADE_FRAMES, (b - a) / 3);
}

/** The person mask's opacity (0-255) from the model's confidence (0-1). */
export function maskAlpha(confidence) {
  const t = Math.min(1, Math.max(0, (confidence - MASK_LOW) / (MASK_HIGH - MASK_LOW)));
  return Math.round(t * t * (3 - 2 * t) * 255);
}

export const personModelReady = () => fs.existsSync(PERSON_MODEL);

/**
 * Makes the person masks for the stretches: one small grey video per
 * stretch (white: the speaker), from the picture as it will be shown (after
 * the zooms). Returns [{ file, from, to }] in frames.
 */
export async function personMasks({ ffmpegPath, input, zoom, ranges, workdir, onProgress }) {
  if (!ranges.length) return [];
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(PERSON_MODEL, {
    intraOpNumThreads: 2,
    graphOptimizationLevel: "all",
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  // Only the frames in the stretches, at the model's size, as raw RGB.
  const pick = ranges.map(([a, b]) => `between(n\\,${a}\\,${b - 1})`).join("+");
  const filters = [zoom, `select=${pick}`, `scale=${MASK_SIZE}:${MASK_SIZE}:flags=area`, "format=rgb24"]
    .filter(Boolean)
    .join(",");
  const decoder = spawn(
    ffmpegPath,
    ["-v", "error", "-i", input, "-an", "-vf", filters, "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let decodeErr = "";
  decoder.stderr.on("data", (d) => (decodeErr += d));

  const frameBytes = MASK_SIZE * MASK_SIZE * 3;
  const total = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  const tensorData = new Float32Array(MASK_SIZE * MASK_SIZE * 3);
  const maskBytes = Buffer.alloc(MASK_SIZE * MASK_SIZE);
  const out = [];
  let rangeIndex = 0;
  let inRange = 0;
  let done = 0;
  let encoder = null;
  let encodeErr = "";
  let encoded = [];

  const openEncoder = (i) => {
    const file = path.join(workdir, `mask_${i}.mkv`);
    encodeErr = "";
    const p = spawn(
      ffmpegPath,
      ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${MASK_SIZE}x${MASK_SIZE}`,
        "-r", String(FPS), "-i", "pipe:0", "-c:v", "ffv1", file],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    p.stderr.on("data", (d) => (encodeErr += d));
    const closed = new Promise((resolve, reject) =>
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`mask encode exited ${code}: ${encodeErr.slice(-300)}`)))),
    );
    encoded.push(closed);
    out.push({ file, from: ranges[i][0], to: ranges[i][1] });
    return p;
  };
  const write = (p, buf) =>
    new Promise((resolve, reject) => p.stdin.write(buf, (e) => (e ? reject(e) : resolve())));

  let pending = Buffer.alloc(0);
  for await (const chunk of decoder.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes && rangeIndex < ranges.length) {
      const frame = pending.subarray(0, frameBytes);
      for (let i = 0; i < frameBytes; i++) tensorData[i] = frame[i] / 255;
      pending = pending.subarray(frameBytes);
      const tensor = new ort.Tensor("float32", tensorData, [1, MASK_SIZE, MASK_SIZE, 3]);
      const result = await session.run({ [inputName]: tensor });
      const conf = result[outputName].data;
      for (let i = 0; i < maskBytes.length; i++) maskBytes[i] = maskAlpha(conf[i]);
      if (!encoder) encoder = openEncoder(rangeIndex);
      await write(encoder, maskBytes);
      inRange++;
      done++;
      onProgress?.(done / total);
      if (inRange >= ranges[rangeIndex][1] - ranges[rangeIndex][0]) {
        encoder.stdin.end();
        encoder = null;
        inRange = 0;
        rangeIndex++;
      }
    }
  }
  if (encoder) {
    // The video ended inside this stretch.
    out[out.length - 1].to = out[out.length - 1].from + inRange;
    encoder.stdin.end();
  }
  const code = await new Promise((resolve) =>
    decoder.exitCode != null ? resolve(decoder.exitCode) : decoder.on("close", resolve),
  );
  await Promise.all(encoded);
  if (code !== 0) throw new Error(`mask decode exited ${code}: ${decodeErr.slice(-300)}`);
  // The video may end inside a stretch: keep only the masks that were made.
  return out;
}

/**
 * The filters (and extra inputs) that put the behind graphics between the
 * room and the speaker. `picture` is the label of the zoomed picture,
 * `firstInput` the index of the first extra input. Returns the graph lines,
 * the inputs to add, and the label of the result.
 */
export function behindFilters({ picture, pieces, masks, w, h, firstInput }) {
  const inputs = [];
  const graph = [];
  const n = masks.length;
  if (!n) return { inputs, graph, last: picture };
  const blur = Math.max(0.5, BEHIND_BLUR * h).toFixed(2);
  const k = (1 - BEHIND_DARKEN).toFixed(3);
  const dark =
    `gblur=sigma=${blur},` +
    // Like the preview's CSS brightness(): every colour scaled (video black is 16).
    `lutyuv=y='(val-16)*${k}+16':u='(val-128)*${k}+128':v='(val-128)*${k}+128'`;
  const copies = [`[room]`, ...masks.map((_, i) => `[dk${i}]`), ...masks.map((_, i) => `[ps${i}]`)];
  graph.push(`[${picture}]split=${copies.length}${copies.join("")}`);

  // The room, darkened and blurred over each stretch, fading in and out.
  let last = "room";
  masks.forEach((m, i) => {
    const len = (m.to - m.from) / FPS;
    const fade = (behindFade([m.from, m.to]) / FPS).toFixed(4);
    const start = (m.from / FPS).toFixed(4);
    graph.push(
      `[dk${i}]trim=start_frame=${m.from}:end_frame=${m.to},setpts=PTS-STARTPTS,${dark},format=yuva420p,` +
        `fade=t=in:st=0:d=${fade}:alpha=1,fade=t=out:st=${(len - Number(fade)).toFixed(4)}:d=${fade}:alpha=1,` +
        `setpts=PTS+${start}/TB[dko${i}]`,
    );
    graph.push(`[${last}][dko${i}]overlay=0:0:eof_action=pass:format=auto[dr${i}]`);
    last = `dr${i}`;
  });

  // The behind graphics.
  pieces.forEach((p, i) => {
    inputs.push("-itsoffset", p.startS.toFixed(4), "-i", p.file);
    graph.push(`[${last}][${firstInput + i}:v]overlay=0:0:eof_action=pass:format=auto[bg${i}]`);
    last = `bg${i}`;
  });

  // The speaker on top: the picture through its mask (softened over three
  // frames, scaled up smoothly, then blurred a little so the small mask's
  // steps don't show at full size).
  const edgeBlur = Math.max(1, h * 0.0025).toFixed(2);
  masks.forEach((m, i) => {
    const input = firstInput + pieces.length + i;
    inputs.push("-i", m.file);
    const start = (m.from / FPS).toFixed(4);
    graph.push(
      `[${input}:v]format=gray,tmix=frames=3:weights='1 2 1',scale=${w}:${h}:flags=bicubic,` +
        `gblur=sigma=${edgeBlur}[mk${i}]`,
    );
    graph.push(
      `[ps${i}]trim=start_frame=${m.from}:end_frame=${m.to},setpts=PTS-STARTPTS[pt${i}]`,
    );
    graph.push(`[pt${i}][mk${i}]alphamerge,setpts=PTS+${start}/TB[po${i}]`);
    graph.push(`[${last}][po${i}]overlay=0:0:eof_action=pass:format=auto[sp${i}]`);
    last = `sp${i}`;
  });
  return { inputs, graph, last };
}
