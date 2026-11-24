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
import { limitThreads } from "./threads.js";
import { outlineReader, samOutline } from "./sam.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PERSON_MODEL = path.join(here, "models", "selfie_segmenter.onnx");
// Robust Video Matting (MobileNetV3, ONNX; GPL-3.0, see models/README.md): a
// real video matte, a soft alpha for every pixel (hair strands, beard,
// fingers) that carries what it saw in earlier frames, so edges hold still
// as the speaker moves. Used when it's in the image; else the selfie
// segmenter above (a coarse mask, refined in behindFilters).
export const MATTING_MODEL = path.join(here, "models", "rvm_mobilenetv3_fp32.onnx");
const mattingModelReady = () => fs.existsSync(MATTING_MODEL);
// The matte is made with the frame's long side at this size (then scaled to
// the frame): fine enough for hair, and quick enough on one processor.
const MATTE_LONG = 1280;
// The model's own working size inside (its downsample ratio aims the long
// side here): what it decides "person" at, before its refiner adds detail.
const MATTE_BASE = 512;
// Frames run before each stretch, so its memory has settled when the
// stretch starts (the first frames of a fresh start are less sure).
const MATTE_PREROLL = 15;

const FPS = 30;
export const BEHIND_FADE_FRAMES = 9;
export const BEHIND_DARKEN = 0.45;
export const BEHIND_BLUR = 0.006;
// The model's input and output size.
const MASK_SIZE = 256;
// Only fairly sure pixels: a lower start let a ring of the bright,
// unblurred room show around the speaker.
const MASK_LOW = 0.5;
const MASK_HIGH = 0.8;
// Least share of the picture the speaker must fill for the cut-out (a close
// talking head is 20-40%; measured: a landscape take shown small in a tall
// video was 2.7%, and its cut-out blurred the speaker's hands and face).
const MIN_PERSON_SHARE = 0.06;
// How the small mask is fitted to the full-size picture (see behindFilters).
// radius, blur and reach are shares of the frame's height; eps is the guided
// filter's smoothing (lower follows the picture's edges more closely: 0.02
// held the ear, neck and hand edges best on a real talking head, and 0.01
// punched white specks through beard and ear); sub its working scale (2:
// half size, fine enough for hair); lo/hi tighten the refined edge (mask
// values below lo are room, above hi the speaker); inPx is how far the edge
// is pulled in, in pixels at 1920 (one: the edge's room colour is taken out
// instead, see behindFilters); reach is how far past the speaker the clean
// room is read from.
export const EDGE = {
  radius: 0.004,
  eps: 0.04,
  lo: 96,
  hi: 224,
  inPx: 1,
  blur: 0.0004,
  sub: 2,
  reach: 0.006,
};

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

export const personModelReady = () => fs.existsSync(PERSON_MODEL) || mattingModelReady();

/**
 * RVM on one frame: its matte (`pha`, 0-1); the recurrent state is kept in
 * `state`.
 */
async function runMatte(ort, session, rgb, mw, mh, state) {
  const n = mw * mh;
  const src = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    src[i] = rgb[j] / 255;
    src[n + i] = rgb[j + 1] / 255;
    src[2 * n + i] = rgb[j + 2] / 255;
  }
  const feeds = {
    src: new ort.Tensor("float32", src, [1, 3, mh, mw]),
    r1i: state.r1,
    r2i: state.r2,
    r3i: state.r3,
    r4i: state.r4,
    downsample_ratio: state.ratio,
  };
  const out = await session.run(feeds);
  state.r1 = out.r1o;
  state.r2 = out.r2o;
  state.r3 = out.r3o;
  state.r4 = out.r4o;
  return out.pha.data;
}

/**
 * The speaker's matte for the stretches with RVM: one grey video per stretch
 * at MATTE_LONG (white: the speaker, soft at hair and edges). The model
 * starts fresh before each stretch and runs MATTE_PREROLL frames first.
 */
async function personMattes({ ffmpegPath, input, zoom, ranges, workdir, onProgress, w, h }) {
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(MATTING_MODEL, {
    intraOpNumThreads: 2,
    graphOptimizationLevel: "all",
  });
  const s = Math.min(1, MATTE_LONG / Math.max(w, h));
  const mw = Math.max(2, Math.round((w * s) / 2) * 2);
  const mh = Math.max(2, Math.round((h * s) / 2) * 2);
  const ratio = Math.min(1, MATTE_BASE / Math.max(mw, mh));
  const zero = () => new ort.Tensor("float32", new Float32Array([0]), [1, 1, 1, 1]);
  // Each stretch with its run-in (never reaching back into the stretch before).
  const runs = [];
  let prevEnd = 0;
  for (const [a, b] of ranges) {
    const start = Math.max(prevEnd, a - MATTE_PREROLL, 0);
    runs.push({ start, a, b });
    prevEnd = b;
  }
  // SAM's outline of the speaker for each stretch, asked for straight away
  // (fal works while RVM runs here), one stretch after another so only one
  // extra decode runs at a time; null where it can't be had (sam.js).
  let chain = Promise.resolve();
  const outlines = runs.map((r, index) => {
    const next = chain.then(() =>
      samOutline({ ffmpegPath, input, zoom, a: r.a, b: r.b, mw, mh, workdir, index }),
    );
    chain = next;
    return next;
  });
  let outline = null;
  const pick = runs.map((r) => `between(n\\,${r.start}\\,${r.b - 1})`).join("+");
  const filters = [zoom, `select=${pick}`, `scale=${mw}:${mh}:flags=area`, "format=rgb24"]
    .filter(Boolean)
    .join(",");
  const decoder = spawn(
    ffmpegPath,
    limitThreads(["-v", "error", "-i", input, "-an", "-vf", filters, "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"]),
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let decodeErr = "";
  decoder.stderr.on("data", (d) => (decodeErr += d));

  const frameBytes = mw * mh * 3;
  const total = runs.reduce((t, r) => t + (r.b - r.start), 0);
  const bytes = Buffer.alloc(mw * mh);
  const out = [];
  const encoded = [];
  let encoder = null;
  const encode = (file, pixFmt, codec) => {
    let err = "";
    const p = spawn(
      ffmpegPath,
      limitThreads(["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", pixFmt, "-s", `${mw}x${mh}`,
        "-r", String(FPS), "-i", "pipe:0", ...codec, file]),
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    p.stderr.on("data", (d) => (err += d));
    encoded.push(
      new Promise((resolve, reject) =>
        p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`matte encode exited ${code}: ${err.slice(-300)}`)))),
      ),
    );
    return p;
  };
  // Per stretch: the matte, lossless grey.
  const openEncoder = (i) => {
    const file = path.join(workdir, `matte_${i}.mkv`);
    out.push({ file, from: runs[i].a, to: runs[i].b, matte: true });
    return encode(file, "gray", ["-c:v", "ffv1"]);
  };
  const write = (p, buf) =>
    new Promise((resolve, reject) => p.stdin.write(buf, (e) => (e ? reject(e) : resolve())));

  let runIndex = 0;
  let at = runs[0].start; // the frame number of the next frame from the decoder
  let state = null;
  let personShare = 0;
  let written = 0;
  let done = 0;
  let pending = Buffer.alloc(0);
  for await (const chunk of decoder.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes && runIndex < runs.length) {
      const run = runs[runIndex];
      if (at === run.start) {
        state = { r1: zero(), r2: zero(), r3: zero(), r4: zero(), ratio: new ort.Tensor("float32", new Float32Array([ratio]), [1]) };
      }
      const pha = await runMatte(ort, session, pending.subarray(0, frameBytes), mw, mh, state);
      pending = pending.subarray(frameBytes);
      if (at >= run.a) {
        if (at === run.a) {
          const file = await outlines[runIndex];
          outline = file ? outlineReader(ffmpegPath, file, mw, mh) : null;
        }
        // RVM's matte, kept only inside SAM's outline when there is one.
        const sam = outline ? await outline.next() : null;
        let sure = 0;
        const n = bytes.length;
        const byte = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
        for (let i = 0; i < n; i++) {
          const v = sam ? (pha[i] * sam[i]) / 255 : pha[i];
          bytes[i] = byte(v);
          if (v > 0.5) sure++;
        }
        personShare += sure / n;
        written++;
        if (!encoder) encoder = openEncoder(runIndex);
        await write(encoder, bytes);
      }
      done++;
      onProgress?.(done / total);
      at++;
      if (at >= run.b) {
        encoder?.stdin.end();
        encoder = null;
        outline?.close();
        outline = null;
        runIndex++;
        if (runIndex < runs.length) at = runs[runIndex].start;
      }
    }
  }
  outline?.close();
  // Outlines still being made for stretches past the video's end.
  await Promise.allSettled(outlines);
  if (encoder) {
    // The video ended inside this stretch.
    out[out.length - 1].to = runs[runIndex].a + Math.max(0, at - runs[runIndex].a);
    encoder.stdin.end();
  }
  const code = await new Promise((resolve) =>
    decoder.exitCode != null ? resolve(decoder.exitCode) : decoder.on("close", resolve),
  );
  await Promise.all(encoded);
  if (code !== 0) throw new Error(`matte decode exited ${code}: ${decodeErr.slice(-300)}`);
  if (written && personShare / written < MIN_PERSON_SHARE) {
    console.warn(
      `[cutout] Speaker too small to cut out (${((100 * personShare) / written).toFixed(1)}% of the picture): graphics go in front`,
    );
    return [];
  }
  return out.filter((m) => m.to > m.from);
}

/**
 * How the picture is fed to the model, which takes 256x256 squares: the
 * frame is scaled so its short side is 256 and covered by overlapping
 * squares along its long side (two for a tall or wide video), so the person
 * keeps their real shape and every mask pixel is the same small square of
 * the picture. (Squeezing a 1080x1920 frame into one square made each mask
 * pixel 4x7.5 px, too coarse for hair and fingers.) The squares' masks are
 * joined (the most confident wins) into one mask of the frame's shape.
 */
export function maskTiles(w, h) {
  const portrait = h >= w;
  const long = Math.max(2, Math.round((MASK_SIZE * Math.max(w, h)) / Math.min(w, h) / 2) * 2);
  const count = Math.max(1, Math.ceil(long / MASK_SIZE));
  const offsets = Array.from({ length: count }, (_, i) =>
    count === 1 ? 0 : Math.round((i * (long - MASK_SIZE)) / (count - 1)),
  );
  return portrait
    ? { mw: MASK_SIZE, mh: long, tiles: offsets.map((y) => ({ x: 0, y })) }
    : { mw: long, mh: MASK_SIZE, tiles: offsets.map((x) => ({ x, y: 0 })) };
}

/**
 * Makes the person masks for the stretches: one small grey video per
 * stretch (white: the speaker), in the frame's shape (see maskTiles), from
 * the picture as it will be shown (after the zooms). Returns
 * [{ file, from, to }] in frames.
 */
export async function personMasks({ ffmpegPath, input, zoom, ranges, workdir, onProgress, w = 1080, h = 1920 }) {
  if (!ranges.length) return [];
  // The real video matte when its model is in the image (see MATTING_MODEL).
  if (mattingModelReady()) {
    return personMattes({ ffmpegPath, input, zoom, ranges, workdir, onProgress, w, h });
  }
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(PERSON_MODEL, {
    intraOpNumThreads: 2,
    graphOptimizationLevel: "all",
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  // Only the frames in the stretches, at the mask's size, as raw RGB.
  const { mw, mh, tiles } = maskTiles(w, h);
  const pick = ranges.map(([a, b]) => `between(n\\,${a}\\,${b - 1})`).join("+");
  const filters = [zoom, `select=${pick}`, `scale=${mw}:${mh}:flags=area`, "format=rgb24"]
    .filter(Boolean)
    .join(",");
  const decoder = spawn(
    ffmpegPath,
    limitThreads(["-v", "error", "-i", input, "-an", "-vf", filters, "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"]),
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let decodeErr = "";
  decoder.stderr.on("data", (d) => (decodeErr += d));

  const frameBytes = mw * mh * 3;
  const total = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  const tensorData = new Float32Array(MASK_SIZE * MASK_SIZE * 3);
  const conf = new Float32Array(mw * mh);
  const maskBytes = Buffer.alloc(mw * mh);
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
      limitThreads(["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${mw}x${mh}`,
        "-r", String(FPS), "-i", "pipe:0", "-c:v", "ffv1", file]),
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

  // How much of the picture the model sees as the speaker, on average: too
  // little (a small figure far from the camera, or no one) can't be cut out
  // cleanly, and the blur would land on them. Then no masks are returned and
  // the graphics go in front instead.
  let personShare = 0;
  let pending = Buffer.alloc(0);
  for await (const chunk of decoder.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes && rangeIndex < ranges.length) {
      const frame = pending.subarray(0, frameBytes);
      conf.fill(0);
      for (const t of tiles) {
        // This square of the frame, as the model's input.
        for (let y = 0; y < MASK_SIZE; y++) {
          const row = ((t.y + y) * mw + t.x) * 3;
          tensorData.set(
            Float32Array.from(frame.subarray(row, row + MASK_SIZE * 3), (v) => v / 255),
            y * MASK_SIZE * 3,
          );
        }
        const tensor = new ort.Tensor("float32", tensorData, [1, MASK_SIZE, MASK_SIZE, 3]);
        const result = await session.run({ [inputName]: tensor });
        const c = result[outputName].data;
        for (let y = 0; y < MASK_SIZE; y++) {
          for (let x = 0; x < MASK_SIZE; x++) {
            const at = (t.y + y) * mw + t.x + x;
            const v = c[y * MASK_SIZE + x];
            if (v > conf[at]) conf[at] = v;
          }
        }
      }
      pending = pending.subarray(frameBytes);
      let sure = 0;
      for (let i = 0; i < maskBytes.length; i++) {
        maskBytes[i] = maskAlpha(conf[i]);
        if (conf[i] > MASK_LOW) sure++;
      }
      personShare += sure / maskBytes.length;
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
  if (done && personShare / done < MIN_PERSON_SHARE) {
    console.warn(
      `[cutout] Speaker too small to cut out (${((100 * personShare) / done).toFixed(1)}% of the picture): graphics go in front`,
    );
    return [];
  }
  // The video may end inside a stretch: keep only the masks that were made.
  return out;
}

/**
 * The filters (and extra inputs) that put the behind graphics between the
 * room and the speaker. `picture` is the label of the zoomed picture,
 * `firstInput` the index of the first extra input. Returns the graph lines,
 * the inputs to add, and the label of the result.
 */
export function behindFilters({ picture, pieces, masks, w, h, firstInput, edge = EDGE }) {
  const inputs = [];
  const graph = [];
  const n = masks.length;
  if (!n) return { inputs, graph, last: picture };
  const blur = Math.max(0.5, BEHIND_BLUR * h).toFixed(2);
  const k = (1 - BEHIND_DARKEN).toFixed(3);
  // A grey (one-plane) picture as RGB with that value in every channel, made
  // exactly (no range conversion), for the per-pixel maths below.
  const rgb = (from, to) => {
    graph.push(`[${from}]split=3[${to}x0][${to}x1][${to}x2]`);
    graph.push(`[${to}x0][${to}x1][${to}x2]mergeplanes=0x001020:gbrp[${to}]`);
  };
  const copies = [`[bbase]`, ...masks.map((_, i) => `[bpc${i}]`)];
  graph.push(`[${picture}]split=${copies.length}${copies.join("")}`);
  // The extra inputs in the order they're numbered below: the behind
  // graphics (firstInput + i), then the masks (after them).
  pieces.forEach((p) => inputs.push("-itsoffset", p.startS.toFixed(4), "-i", p.file));
  masks.forEach((m) => inputs.push("-i", m.file));

  // The speaker's matte for each stretch. The model's mask (see maskTiles)
  // is softened over three frames, so its edge doesn't flicker, scaled up,
  // and fitted to the full-size picture with a guided filter, so it snaps
  // to the real edges (hair against the wall); then tightened and softened
  // by about a pixel.
  const radius = Math.min(20, Math.max(2, Math.round(h * edge.radius)));
  const edgeIn = Math.max(0, Math.round((edge.inPx * h) / 1920));
  const edgeBlur = Math.max(0.5, h * edge.blur).toFixed(2);
  const erode = edgeIn ? `${Array(edgeIn).fill("erosion").join(",")},` : "";
  const tighten = `lut=y='clip((val-${edge.lo})*255/${edge.hi - edge.lo},0,255)'`;
  // How far past the speaker's edge the room is read from (the clean room):
  // enough that none of the speaker is in it.
  const reach = Math.max(1, h * edge.reach).toFixed(2);
  masks.forEach((m, i) => {
    const input = firstInput + pieces.length + i;
    if (m.matte) {
      // A real video matte (RVM): already soft and exact at hair, beard and
      // fingers, and steady over time, so it's only scaled to the frame; the
      // fixes below for a coarse mask would only blur or shrink it.
      graph.push(`[bpc${i}]trim=start_frame=${m.from}:end_frame=${m.to},setpts=PTS-STARTPTS,split=2[pb${i}][pd${i}]`);
      graph.push(`[${input}:v]format=gray,scale=${w}:${h}:flags=bicubic,split=3[ad${i}][an${i}][am${i}]`);
    } else {
      graph.push(`[${input}:v]format=gray,tmix=frames=3:weights='1 2 1',scale=${w}:${h}:flags=bicubic[mu${i}]`);
      graph.push(`[bpc${i}]trim=start_frame=${m.from}:end_frame=${m.to},setpts=PTS-STARTPTS,split=3[pg${i}][pb${i}][pd${i}]`);
      graph.push(`[pg${i}]format=gray[gd${i}]`);
      graph.push(
        `[gd${i}][mu${i}]guided=radius=${radius}:eps=${edge.eps}:mode=fast:sub=${edge.sub}:guidance=on,` +
          // (median: no lone specks where the fit wavered on texture)
          `${tighten},median=radius=1,${erode}gblur=sigma=${edgeBlur},split=3[ad${i}][an${i}][am${i}]`,
      );
    }
    // Where the room is: everything but the speaker and a margin round them.
    graph.push(`[ad${i}]gblur=sigma=${reach},lut=y='if(gt(val,4),0,255)'[wr${i}g]`);
    rgb(`wr${i}g`, `wr${i}`);
    graph.push(`[wr${i}]split[wa${i}][wb${i}]`);
    // The clean room (B): the picture blurred over the room only (a blur
    // weighted by where the room is), so the speaker's own colours never
    // smear into it: no dark ghost round a moving hand, and the true colour
    // of the wall right at the speaker's edge.
    graph.push(`[pb${i}]format=gbrp,split=2[pr${i}][pf${i}]`);
    graph.push(`[pr${i}][wa${i}]premultiply=inplace=0,gblur=sigma=${blur}[num${i}]`);
    graph.push(`[wb${i}]gblur=sigma=${blur},split=2[den${i}][dw${i}]`);
    graph.push(`[num${i}][den${i}]unpremultiply=inplace=0[bn${i}]`);
    // A pocket of room with little room round it (between hands and a desk,
    // say) has nothing to read the clean room from: it takes the plain blur.
    graph.push(`[pf${i}]gblur=sigma=${blur}[bf${i}]`);
    graph.push(`[dw${i}]lut=c0='min(255,val*16)':c1='min(255,val*16)':c2='min(255,val*16)'[dm${i}]`);
    graph.push(`[bf${i}][bn${i}][dm${i}]maskedmerge[bc${i}]`);
    // 1 - matte (how much of what's behind shows through).
    graph.push(`[an${i}]negate[nag${i}]`);
    rgb(`nag${i}`, `naF${i}`);
    // The speaker's edge darkened as much as the room is, in proportion to
    // how much room is in each edge pixel: an edge pixel is part speaker,
    // part room (hair strands, a soft edge, or a pixel of wall the matte took
    // in), and only the room part should take the room's darkening; the
    // speaker's own pixels (matte full) keep their colour exactly. This is
    // what removes the ring of the old, brighter room round them. (Taking
    // the room colour out exactly, (I - (1-a)B)/a, turned edge pixels black
    // wherever the matte was a little short, so this robust form is used.)
    graph.push(`[am${i}]split=2[am1${i}][am2${i}]`);
    graph.push(`[am1${i}]lut=y='255-(255-val)*${BEHIND_DARKEN}'[ef${i}g]`);
    rgb(`ef${i}g`, `ef${i}`);
    rgb(`am2${i}`, `ma${i}`);
    graph.push(`[pd${i}]format=gbrp[pdg${i}]`);
    graph.push(`[pdg${i}][ef${i}]premultiply=inplace=0[pe${i}]`);
    graph.push(`[pe${i}][ma${i}]premultiply=inplace=0[fp${i}]`);
    // The room behind the graphics: the clean room, darkened like the
    // preview's CSS brightness(), fading in and out.
    const len = (m.to - m.from) / FPS;
    const fade = (behindFade([m.from, m.to]) / FPS).toFixed(4);
    const start = (m.from / FPS).toFixed(4);
    graph.push(
      `[bc${i}]lutrgb=r='val*${k}':g='val*${k}':b='val*${k}',format=yuva420p,` +
        `fade=t=in:st=0:d=${fade}:alpha=1,fade=t=out:st=${(len - Number(fade)).toFixed(4)}:d=${fade}:alpha=1,` +
        `setpts=PTS+${start}/TB[dko${i}]`,
    );
  });

  // The room over the whole picture, stretch by stretch.
  let last = "bbase";
  masks.forEach((_, i) => {
    graph.push(`[${last}][dko${i}]overlay=0:0:eof_action=pass:format=yuv420[dr${i}]`);
    last = `dr${i}`;
  });

  // The behind graphics.
  pieces.forEach((_, i) => {
    // In the video's own format first (see composeArgs in motion.js): faster.
    graph.push(`[${firstInput + i}:v]format=yuva420p[bp${i}]`);
    graph.push(`[${last}][bp${i}]overlay=0:0:eof_action=pass:format=yuv420[bg${i}]`);
    last = `bg${i}`;
  });

  // The speaker in front: their decontaminated colour (already multiplied
  // by the matte) plus whatever is behind them (room and graphics) where
  // the matte lets it through.
  const behindCopies = [`[bgm]`, ...masks.map((_, i) => `[gs${i}]`)];
  graph.push(`[${last}]split=${behindCopies.length}${behindCopies.join("")}`);
  last = "bgm";
  masks.forEach((m, i) => {
    const start = (m.from / FPS).toFixed(4);
    graph.push(`[gs${i}]trim=start_frame=${m.from}:end_frame=${m.to},setpts=PTS-STARTPTS,format=gbrp[gt${i}]`);
    graph.push(`[gt${i}][naF${i}]premultiply=inplace=0[gw${i}]`);
    graph.push(`[fp${i}][gw${i}]blend=all_mode=addition,format=yuv420p,setpts=PTS+${start}/TB[po${i}]`);
    graph.push(`[${last}][po${i}]overlay=0:0:eof_action=pass:format=yuv420[sp${i}]`);
    last = `sp${i}`;
  });
  return { inputs, graph, last };
}
