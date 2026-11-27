// The speaker's matte from Pixelcut's video background removal on fal.ai
// (hosted GPU, paid per frame), for the stretches with a graphic behind the
// speaker. Chosen 2026-11-26 over VEED and Bria on the owner's own footage
// (docs/matte-benchmark): the cleanest, most natural hair and hand edges,
// no light fringe. It replaces RVM (cutout.js personMattes) for those
// stretches; a stretch it can't do (no FAL_KEY, fal down or slow, an answer
// we can't read) goes back to RVM, so the export never fails because of it.
//
// Each stretch is sent as the frames the export shows (after its zooms), at
// 30 fps (fal charges per frame) and the matte's size; the answer's alpha is
// turned into the same lossless grey matte RVM writes (matte_<i>.mkv, one
// frame per stretch frame), so behindFilters takes it unchanged.

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { limitThreads } from "./threads.js";
import { hdrToSdr, probeColour } from "./hdr.js";

const FAL_APP = "pixelcut/video-background-removal";
const FAL_QUEUE = `https://queue.fal.run/${FAL_APP}`;
/** Longest wait for one stretch's answer (it took 128 s for 592 frames). */
const FAL_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_MS = 2000;
/** Longest stretch sent (frames at 30 fps): longer ones stay on RVM. */
const MAX_FRAMES = 30 * 90;
/** Stretches asked at the same time. */
const AT_ONCE = 3;
const FPS = 30;

/** On when there's a fal key, unless MATTE_PROVIDER=rvm turns it off. */
export const pixelcutReady = () =>
  !!process.env.FAL_KEY?.trim() && (process.env.MATTE_PROVIDER ?? "").trim().toLowerCase() !== "rvm";

function run(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    let err = "";
    const p = spawn(ffmpegPath, limitThreads(args), { stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`)),
    );
  });
}

const falHeaders = () => ({
  Authorization: `Key ${process.env.FAL_KEY.trim()}`,
  "Content-Type": "application/json",
});

/** One request to fal; the time allowed grows with what's sent (a minute + 1 s per 8 KB). */
async function falJson(url, init) {
  const sending = typeof init?.body === "string" ? init.body.length : 0;
  // A connection that drops or can't be made is tried again (3 goes, a
  // second or two apart); an answer from fal (even an error) is final.
  for (let attempt = 1; ; attempt++) {
    let r;
    try {
      r = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.round(60_000 + sending / 8)) });
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * attempt));
      continue;
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`fal ${r.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
}

/**
 * Puts the clip in fal's own storage and returns its public link: Pixelcut
 * only takes a link (it refuses a clip sent inside the request, 2026-11-26).
 */
async function uploadToFal(clipBytes, name) {
  const init = await falJson("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ content_type: "video/mp4", file_name: name }),
  });
  if (typeof init?.upload_url !== "string" || typeof init?.file_url !== "string") {
    throw new Error("fal storage gave no upload link");
  }
  // Tried twice: a dropped connection mid-upload is worth one more go.
  for (let attempt = 1; ; attempt++) {
    try {
      const put = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: clipBytes,
        // A minute plus a second per 8 KB, as falJson allows.
        signal: AbortSignal.timeout(Math.round(60_000 + clipBytes.length / 8)),
      });
      if (!put.ok) throw new Error(`fal storage upload ${put.status}`);
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
  return init.file_url;
}

/** Sends one clip to Pixelcut and waits; returns the link to its see-through video. */
async function askPixelcut(clipBytes) {
  const body = {
    video_url: await uploadToFal(clipBytes, "stretch.mp4"),
    background: "transparent",
    output_format: "webm_vp9",
  };
  const sent = await falJson(FAL_QUEUE, { method: "POST", headers: falHeaders(), body: JSON.stringify(body) });
  const statusUrl = sent.status_url ?? `${FAL_QUEUE}/requests/${sent.request_id}/status`;
  const resultUrl = sent.response_url ?? `${FAL_QUEUE}/requests/${sent.request_id}`;
  const until = Date.now() + FAL_TIMEOUT_MS;
  for (;;) {
    const s = await falJson(statusUrl, { headers: falHeaders() });
    if (s.status === "COMPLETED") break;
    if (s.status && !["IN_QUEUE", "IN_PROGRESS"].includes(s.status)) throw new Error(`fal status ${s.status}`);
    if (Date.now() > until) throw new Error("Pixelcut took too long");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const answer = await falJson(resultUrl, { headers: falHeaders() });
  const url = answer?.video?.url ?? (Array.isArray(answer?.video) ? answer.video[0]?.url : null);
  if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new Error("Pixelcut sent no video");
  return url;
}

async function download(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!r.ok) throw new Error(`Pixelcut result download ${r.status}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

/**
 * One stretch [a, b) of the shown picture: Pixelcut's matte as a lossless
 * grey video at mw x mh with exactly b - a frames (matte_<index>.mkv), or
 * null when it couldn't be made.
 */
export async function pixelcutMatte({ ffmpegPath, input, zoom, a, b, mw, mh, workdir, index }) {
  const frames = b - a;
  if (!pixelcutReady() || frames <= 0 || frames > MAX_FRAMES) return null;
  const started = Date.now();
  try {
    // The stretch as shown: its zooms, one picked frame per clip frame at 30 fps.
    const clip = path.join(workdir, `pixelcut_in_${index}.mp4`);
    const vf = [zoom, `select=between(n\\,${a}\\,${b - 1})`, "setpts=N/(30*TB)", `scale=${mw}:${mh}:flags=area`, "format=yuv420p"]
      .filter(Boolean)
      .join(",");
    await run(ffmpegPath, ["-y", "-v", "error", "-i", input, "-an", "-vf", vf, "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", clip]);
    const url = await askPixelcut(await fs.readFile(clip));
    const answer = path.join(workdir, `pixelcut_out_${index}.webm`);
    await download(url, answer);
    // Its alpha (VP9's own decoder keeps it), back on the stretch's frames:
    // 30 fps from its own timing, the matte's size, held on the last frame if
    // it came back a frame short.
    const file = path.join(workdir, `matte_px_${index}.mkv`);
    await run(ffmpegPath, [
      "-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", answer,
      "-vf", `fps=${FPS},alphaextract,scale=${mw}:${mh}:flags=bicubic,format=gray,tpad=stop_mode=clone:stop=${frames}`,
      "-frames:v", String(frames), "-c:v", "ffv1", file,
    ]);
    console.log(
      `[pixelcut] Stretch ${index} (${a}-${b}, ${frames} frames) matted in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    return file;
  } catch (e) {
    // fetch's own "fetch failed" says little: its cause names the network error.
    const why = [e?.message || e, e?.cause?.code || e?.cause?.message].filter(Boolean).join(": ");
    console.warn(`[pixelcut] Stretch ${index} (${a}-${b}) goes to RVM: ${why}`);
    return null;
  }
}

/**
 * Pixelcut mattes for the stretches, AT_ONCE at a time. Returns the mattes
 * made (as RVM's: {file, from, to, matte, run}) and the ranges it couldn't do.
 */
export async function pixelcutMattes({ ffmpegPath, input, zoom, ranges, workdir, mw, mh }) {
  const results = new Array(ranges.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      const [a, b] = ranges[i];
      results[i] = await pixelcutMatte({ ffmpegPath, input, zoom, a, b, mw, mh, workdir, index: i });
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, ranges.length) }, worker));
  const mattes = [];
  const failed = [];
  ranges.forEach(([a, b], i) => {
    if (results[i]) mattes.push({ file: results[i], from: a, to: b, matte: true, run: i });
    else failed.push([a, b]);
  });
  return { mattes, failed };
}

/** The editor preview's cut-out: the short side at most this (as its preview copies). */
const CUTOUT_SHORT = 720;
/** Longest stretch made for the preview (ms). */
export const CUTOUT_MAX_MS = 60_000;

/**
 * The editor preview's cut-out of one stretch [fromMs, toMs) of an uploaded
 * clip (in the clip's own time, upright, before any zoom): Pixelcut's matte
 * beside the picture in one video (picture left, matte right, 30 fps), so
 * the preview's speaker and its matte are always the same frame. Returns
 * the file and its frame count; throws when it can't be made.
 */
export async function pixelcutCutout({ ffmpegPath, sourceUrl, fromMs, toMs, workdir }) {
  const lengthMs = toMs - fromMs;
  if (!pixelcutReady()) throw new Error("no FAL_KEY (or MATTE_PROVIDER=rvm)");
  if (!(lengthMs > 0 && lengthMs <= CUTOUT_MAX_MS)) throw new Error(`bad stretch ${fromMs}-${toMs}`);
  const s = CUTOUT_SHORT;
  // The stretch, upright (ffmpeg turns phone footage), 30 fps, shrunk only;
  // HDR made normal first (hdr.js), as the export shows it.
  const hdr = hdrToSdr(await probeColour(spawn, ffmpegPath, sourceUrl));
  const clip = path.join(workdir, "cutout_in.mp4");
  await run(ffmpegPath, [
    "-y", "-v", "error", "-ss", (fromMs / 1000).toFixed(3), "-t", (lengthMs / 1000).toFixed(3),
    "-i", sourceUrl, "-an",
    "-vf", [hdr, `fps=${FPS},scale=w='if(gt(iw,ih),-2,min(${s},iw))':h='if(gt(iw,ih),min(${s},ih),-2)',format=yuv420p`].filter(Boolean).join(","),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", clip,
  ]);
  const frames = await countFrames(ffmpegPath, clip);
  if (!frames) throw new Error("the stretch has no frames");
  const url = await askPixelcut(await fs.readFile(clip));
  const answer = path.join(workdir, "cutout_out.webm");
  await download(url, answer);
  // Picture | matte, the matte held on its last frame if it came back short.
  const out = path.join(workdir, "cutout.mp4");
  await run(ffmpegPath, [
    "-y", "-v", "error", "-i", clip, "-c:v", "libvpx-vp9", "-i", answer,
    "-filter_complex",
    `[1:v]fps=${FPS},alphaextract,format=gray,tpad=stop_mode=clone:stop=${frames}[m0];` +
      `[m0][0:v]scale2ref=flags=bicubic[m][p];[m]format=yuv420p[mm];[p][mm]hstack=inputs=2[v]`,
    "-map", "[v]", "-frames:v", String(frames), "-an",
    // A keyframe every half second: the preview jumps into it quickly.
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
    "-g", "15", "-movflags", "+faststart", out,
  ]);
  return { file: out, frames };
}

/**
 * The export's matte for stretch [a, b) (frames of the shown picture) from a
 * saved preview cut-out (pixelcutCutout) instead of asking Pixelcut again:
 * its matte half from frame `skip` on, fitted to the w x h frame as the clip
 * was (coverFilter: same shape, filled), zoomed as the picture is at those
 * frames, at mw x mh. Same file as pixelcutMatte makes; null on failure.
 */
export async function savedMatte({ ffmpegPath, url, skip, cover, zoom, a, b, mw, mh, workdir, index }) {
  const frames = b - a;
  if (frames <= 0) return null;
  const started = Date.now();
  try {
    // The zoom counts the picture's frames from the start (`in`): these
    // start at frame a.
    const shifted = zoom ? zoom.replace(/\bin\b/g, `(in+${a})`) : null;
    const file = path.join(workdir, `matte_sv_${index}.mkv`);
    const vf = [
      `crop=iw/2:ih:iw/2:0`,
      `trim=start_frame=${skip}`,
      "setpts=PTS-STARTPTS",
      cover,
      shifted,
      `scale=${mw}:${mh}:flags=area`,
      "format=gray",
      `tpad=stop_mode=clone:stop=${frames}`,
    ].filter(Boolean).join(",");
    await run(ffmpegPath, ["-y", "-v", "error", "-i", url, "-an", "-vf", vf, "-frames:v", String(frames), "-c:v", "ffv1", file]);
    console.log(`[pixelcut] Stretch ${index} (${a}-${b}) from a saved cut-out in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return file;
  } catch (e) {
    console.warn(`[pixelcut] Saved cut-out for stretch ${index} (${a}-${b}) unusable: ${e?.message || e}`);
    return null;
  }
}

/** How many frames a video has (read through, exact). */
function countFrames(ffmpegPath, file) {
  return new Promise((resolve, reject) => {
    let err = "";
    const p = spawn(ffmpegPath, limitThreads(["-v", "error", "-i", file, "-map", "0:v:0", "-f", "null", "-progress", "pipe:1", "-"]), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`));
      const all = [...out.matchAll(/frame=(\d+)/g)];
      resolve(all.length ? Number(all[all.length - 1][1]) : 0);
    });
  });
}

/** Reads a grey video one frame at a time (mw x mh); next() is null at the end. */
export function grayFrames(ffmpegPath, file, mw, mh) {
  const p = spawn(ffmpegPath, limitThreads(["-v", "error", "-i", file, "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"]), {
    stdio: ["ignore", "pipe", "ignore"],
  });
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
