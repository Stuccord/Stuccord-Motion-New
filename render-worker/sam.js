// The speaker's outline from Meta's SAM 3.1 on fal.ai (hosted GPU, paid per
// frame), used with the RVM matte in cutout.js: RVM gives the soft edges
// (hair, beard, fingers) but sometimes takes a bit of wall in a tight gap
// (between an arm and the body) for the speaker; SAM knows where the person
// is, so RVM's matte is kept only inside SAM's outline (a little widened, so
// hair isn't clipped).
//
// Only the stretches with a graphic behind the speaker are sent. Anything
// that goes wrong (no FAL_KEY, fal down or slow, an answer we can't read)
// leaves that stretch on RVM alone: the export never fails because of SAM.

import { spawn } from "child_process";
import path from "path";
import { limitThreads } from "./threads.js";

const FAL_APP = "fal-ai/sam-3-1/video-rle";
const FAL_QUEUE = `https://queue.fal.run/${FAL_APP}`;
/** What SAM looks for: every person in the picture (the speaker, mostly). */
const PROMPT = "person";
/** Longest wait for one stretch's answer. */
const FAL_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_MS = 1500;
/** Longest stretch sent (frames at 30 fps): longer ones stay on RVM alone. */
const MAX_FRAMES = 30 * 60;
/**
 * How far SAM's outline is widened before it trims RVM's matte, as a share
 * of the frame's short side (SAM's edge runs through hair; RVM's soft edge
 * must stay whole), and how softly the widened edge fades.
 */
export const SAM_GROW = 0.012;

export const samReady = () => !!process.env.FAL_KEY?.trim();

const FPS = 30;

function run(ffmpegPath, args, stdin) {
  return new Promise((resolve, reject) => {
    let err = "";
    const p = spawn(ffmpegPath, limitThreads(args), {
      stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"],
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`)),
    );
  });
}

/** The stretch's frames [a, b), as shown (after the zooms), as a small MP4 for fal. */
async function stretchClip({ ffmpegPath, input, zoom, a, b, mw, mh, file }) {
  const vf = [
    zoom,
    `select=between(n\\,${a}\\,${b - 1})`,
    // Each picked frame one frame of the clip, at 30 fps, so SAM's masks
    // line up with the stretch frame for frame.
    "setpts=N/(30*TB)",
    `scale=${mw}:${mh}:flags=area`,
    "format=yuv420p",
  ]
    .filter(Boolean)
    .join(",");
  await run(ffmpegPath, [
    "-y", "-v", "error", "-i", input, "-an", "-vf", vf, "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", file,
  ]);
}

const falHeaders = () => ({
  Authorization: `Key ${process.env.FAL_KEY.trim()}`,
  "Content-Type": "application/json",
});

async function falJson(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`fal ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Sends one clip to SAM 3.1 through fal's queue and waits for the answer. */
async function askFal(clipBytes) {
  const body = {
    video_url: `data:video/mp4;base64,${clipBytes.toString("base64")}`,
    prompt: PROMPT,
    apply_mask: false,
    detection_threshold: 0.4,
    max_num_objects: 4,
  };
  const sent = await falJson(FAL_QUEUE, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify(body),
  });
  const statusUrl = sent.status_url ?? `${FAL_QUEUE}/requests/${sent.request_id}/status`;
  const resultUrl = sent.response_url ?? `${FAL_QUEUE}/requests/${sent.request_id}`;
  const until = Date.now() + FAL_TIMEOUT_MS;
  for (;;) {
    const s = await falJson(statusUrl, { headers: falHeaders() });
    if (s.status === "COMPLETED") break;
    if (s.status && !["IN_QUEUE", "IN_PROGRESS"].includes(s.status)) {
      throw new Error(`fal status ${s.status}`);
    }
    if (Date.now() > until) throw new Error("fal took too long");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return falJson(resultUrl, { headers: falHeaders() });
}

/**
 * A frame's mask whose person is smaller than this share of the stretch's
 * usual (median) size is taken as a miss (SAM lost the speaker for a
 * moment): that frame is written all white, so RVM's matte stays whole.
 */
const MISS_SHARE = 0.4;

/** The answer's per-frame masks: a list of strings, or a JSON file of them. */
async function falRle(answer) {
  let rle = answer?.rle;
  if (rle && !Array.isArray(rle) && typeof rle.url === "string") {
    const r = await fetch(rle.url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`SAM masks file ${r.status}`);
    rle = await r.json();
    if (!Array.isArray(rle)) rle = rle?.rle;
  }
  if (!Array.isArray(rle) || !rle.length) throw new Error("SAM sent no masks");
  return rle;
}

/**
 * One frame's mask from fal's RLE: "start length start length ..." over
 * the pixels row by row at the size sent (checked 2026-11-24: one string per
 * frame of the clip, matching it frame for frame). Returns the mask and how
 * many pixels are a person.
 */
export function decodeRle(text, mw, mh) {
  const buf = Buffer.alloc(mw * mh);
  let area = 0;
  const nums = String(text ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const start = Math.max(0, nums[i]);
    const end = Math.min(buf.length, nums[i] + nums[i + 1]);
    if (end > start) {
      buf.fill(255, start, end);
      area += end - start;
    }
  }
  return { buf, area };
}

/**
 * Writes SAM's per-frame masks (white: a person) as raw grey frames to
 * `write`, `frames` of them at mw x mh. If fal sent a different number of
 * masks than frames, each frame takes the mask nearest in time.
 */
async function writeFalMasks(answer, frames, mw, mh, write) {
  const rle = await falRle(answer);
  const masks = rle.map((t) => decodeRle(t, mw, mh));
  const areas = masks.map((m) => m.area).sort((x, y) => x - y);
  const median = areas[Math.floor(areas.length / 2)];
  if (!median) throw new Error("SAM found no person");
  const white = Buffer.alloc(mw * mh, 255);
  let misses = 0;
  for (let f = 0; f < frames; f++) {
    const i =
      rle.length === frames ? f : Math.min(rle.length - 1, Math.floor((f * rle.length) / frames));
    const m = masks[i];
    if (m.area < median * MISS_SHARE) {
      misses++;
      await write(white);
    } else {
      await write(m.buf);
    }
  }
  if (rle.length !== frames) {
    console.warn(`[sam] ${rle.length} masks for ${frames} frames: matched by time`);
  }
  if (misses) console.warn(`[sam] ${misses} frame(s) without the speaker: RVM alone there`);
}

/**
 * SAM's outline for one stretch [a, b), as a lossless grey video at mw x mh
 * (white: a person), or null when it can't be had (see the top of the file).
 */
export async function samOutline({ ffmpegPath, input, zoom, a, b, mw, mh, workdir, index }) {
  if (!samReady() || b <= a || b - a > MAX_FRAMES) return null;
  const started = Date.now();
  try {
    const clip = path.join(workdir, `sam_in_${index}.mp4`);
    await stretchClip({ ffmpegPath, input, zoom, a, b, mw, mh, file: clip });
    const fs = await import("fs/promises");
    const answer = await askFal(await fs.readFile(clip));

    const file = path.join(workdir, `sam_${index}.mkv`);
    let err = "";
    const enc = spawn(
      ffmpegPath,
      limitThreads(["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${mw}x${mh}`,
        "-r", String(FPS), "-i", "pipe:0", "-c:v", "ffv1", file]),
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    enc.stderr.on("data", (d) => (err += d));
    const closed = new Promise((resolve, reject) =>
      enc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`sam encode exited ${code}: ${err.slice(-300)}`)))),
    );
    const write = (buf) =>
      new Promise((resolve, reject) => enc.stdin.write(buf, (e) => (e ? reject(e) : resolve())));
    try {
      await writeFalMasks(answer, b - a, mw, mh, write);
    } finally {
      enc.stdin.end();
    }
    await closed;
    console.log(`[sam] Stretch ${index} (${b - a} frames) outlined in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return file;
  } catch (e) {
    console.warn(`[sam] Stretch ${index} stays on RVM alone: ${e?.message || e}`);
    return null;
  }
}

/**
 * Reads a SAM outline back one frame at a time, widened by SAM_GROW and
 * softened (worked out at a quarter size, so it's quick), at mw x mh grey.
 * next() gives the next frame, or null once the video has ended.
 */
export function outlineReader(ffmpegPath, file, mw, mh) {
  const qw = Math.max(2, Math.round(mw / 4));
  const qh = Math.max(2, Math.round(mh / 4));
  // Each dilation reaches one pixel at quarter size (four at full size).
  const passes = Math.max(1, Math.round((SAM_GROW * Math.min(mw, mh)) / 4));
  const vf = [
    `scale=${qw}:${qh}:flags=area`,
    ...Array(passes).fill("dilation"),
    "gblur=sigma=1",
    `scale=${mw}:${mh}:flags=bilinear`,
    "format=gray",
  ].join(",");
  const p = spawn(
    ffmpegPath,
    limitThreads(["-v", "error", "-i", file, "-vf", vf, "-f", "rawvideo", "pipe:1"]),
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const size = mw * mh;
  const it = p.stdout[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  let ended = false;
  return {
    async next() {
      while (pending.length < size && !ended) {
        const r = await it.next();
        if (r.done) ended = true;
        else pending = pending.length ? Buffer.concat([pending, r.value]) : r.value;
      }
      if (pending.length < size) return null;
      const frame = pending.subarray(0, size);
      pending = pending.subarray(size);
      return frame;
    },
    close() {
      p.kill();
    },
  };
}
