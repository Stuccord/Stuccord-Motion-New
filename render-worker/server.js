// Stuccord Motion — render worker
//
// Deploy on Render.com as a Web Service:
//   Build Command:  npm install
//   Start Command:  npm start
//
// Env vars:
//   RENDER_WORKER_SECRET   shared HMAC secret (matches the app)
//   ANTHROPIC_API_KEY      optional — a short AI hook line for videos without
//                          Motion Explainer graphics (Claude)
//   ELEVENLABS_API_KEY     optional — enables speech-to-text (Scribe v2) for captions
//                          and /transcribe (words for planning graphics), and AI
//                          voiceovers (text-to-speech, /voices and /tts)
//   PUBLIC_APP_URL         optional — the app's address; enables the once-a-minute
//                          tick that sends scheduled posts (see publish.js)
//
// The worker receives signed download/upload URLs from the app, so it does
// NOT need any Supabase service keys. It uses ffmpeg to normalize each
// source clip to the target aspect ratio (1080p, H.264 + AAC, 30fps),
// concatenates the A-roll into the main track and overlays the B-roll on top
// of it from 0:00 (matching the editor timeline). Uploaded music is looped
// under the video and ducked under the voice, with SFX on each cut. When an
// AI edit plan produces a "hook" line, that hook is burned into the first
// ~3 seconds.

// First, so error monitoring is ready before anything else loads.
import { reportError } from "./sentry.js";
import express from "express";
import crypto from "crypto";
import { spawn, spawnSync, execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import ffmpegPath from "ffmpeg-static";
import { fileURLToPath } from "url";
import { registerPublishing } from "./publish.js";
import { elevenLabsError, generateEditPlan } from "./ai.js";
import {
  MOTION_FPS,
  MUSIC_BEDS,
  SOUNDS_DIR,
  captionGaps,
  chapterStretches,
  composeArgs,
  splitRanges,
  closeShots,
  angleBlocked,
  finishFilters,
  gradeFilter,
  lookFinish,
  placeGraphics,
  renderGraphics,
  sfxTrackArgs,
  soundEvents,
  soundGain,
  storyImages,
  prepareStoryClips,
  zoomFilter,
} from "./motion.js";
import { behindRanges, personMasks, personModelReady } from "./cutout.js";
import { CaptureError, capturePage } from "./capture.js";
import { limitThreads } from "./threads.js";
import { CUTOUT_MAX_MS, pixelcutCutout, pixelcutReady } from "./pixelcut.js";
import { analyzeColour, correctColour, correctedSkin, correctionFilter, correctionParams } from "./colour.js";
import { checkHdrSupport, colourTags, hdrToSdr, probeColour } from "./hdr.js";
import { bakeGradeTable, lutFilter, packLutFilter, packSkinSafeStrength } from "./luts.js";
import {
  buildAudioMixArgs,
  masterArgs,
  measureLoudness,
  musicGainDb,
  sfxGainDb,
  limitFor,
  limiterArgs,
  voiceMeasure,
  voiceChainMeasure,
  voiceGainDb,
  voiceTrimDb,
} from "./audio.js";
import { analyzeVoice, NOISE_MODES, noiseMode, voiceCleanup } from "./noise.js";

const app = express();
app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

// The secret shared with the app, read like the app does (src/lib/worker-secret.ts):
// surrounding spaces and quotes pasted into the host's settings are ignored.
const SECRET = (process.env.RENDER_WORKER_SECRET ?? "")
  .trim()
  .replace(/^(["'])(.*)\1$/, "$2")
  .trim();
if (!SECRET) console.warn("[Worker] RENDER_WORKER_SECRET not set — every signed route will reject all requests");
if (!ffmpegPath) console.warn("[Worker] ffmpeg-static failed to resolve a binary path");
// HDR footage needs zscale and tonemap (hdr.js); without them it stays as it was.
if (ffmpegPath) checkHdrSupport(spawnSync, ffmpegPath);

let currentJobId = null;
/** How often a running render says "still working" (the app gives up after 5 minutes of quiet). */
const HEARTBEAT_MS = 60_000;

function verifySignature(req) {
  // No secret, no entry: an empty key is one anyone can sign with.
  if (!SECRET) return false;
  const sig = req.header("x-stuccord-signature") || "";
  const expected = crypto.createHmac("sha256", SECRET).update(req.rawBody || Buffer.alloc(0)).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAbsoluteHttpUrl(urlStr) {
  if (typeof urlStr !== "string" || !urlStr.trim()) return false;
  try {
    const u = new URL(urlStr.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeRelativePath(p) {
  if (typeof p !== "string" || !p.trim()) return false;
  const s = p.trim();
  if (s.startsWith("/") || s.startsWith("\\")) return false;
  if (s.includes("..")) return false;
  if (s.includes("//") || s.includes("\\\\")) return false;
  if (/^https?:\/\//i.test(s)) return false;
  return true;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateJobPayload(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return "Job payload must be a JSON object";
  }
  if (typeof job.job_id !== "string" || !UUID_REGEX.test(job.job_id)) {
    return "Invalid or missing job_id UUID";
  }
  if (!isAbsoluteHttpUrl(job.callback_url)) {
    return "callback_url must be an absolute http or https URL";
  }
  if (!Array.isArray(job.clips) || job.clips.length === 0) {
    return "clips must be a non-empty array";
  }
  const hasValidClips = job.clips.every(
    (c) => c && typeof c === "object" && isAbsoluteHttpUrl(c.download_url)
  );
  if (!hasValidClips) {
    return "Each clip must have an absolute http or https download_url";
  }
  if (!job.output || typeof job.output !== "object" || Array.isArray(job.output)) {
    return "Missing or invalid output object";
  }
  if (!isAbsoluteHttpUrl(job.output.upload_url)) {
    return "output.upload_url must be an absolute http or https URL";
  }
  if (!isSafeRelativePath(job.output.path)) {
    return "output.path must be a safe relative storage path";
  }
  return null;
}

const signBody = (body) => crypto.createHmac("sha256", SECRET || "").update(body).digest("hex");

// Progress updates are sent once. The final word (done or failed) is retried
// a few times: if it's lost, the user's page waits on a render that ended.
async function callback(url, payload) {
  const body = JSON.stringify(payload);
  const signature = signBody(body);
  const final = payload?.status === "completed" || payload?.status === "failed";
  const tries = final ? 4 : 1;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-stuccord-signature": signature },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return;
      console.error("[Worker] Callback failed with status", res.status);
      // A refused request (bad signature, unknown job) won't pass on a retry.
      if (res.status < 500) return;
    } catch (e) {
      console.error("[Worker] Callback network error", e?.message || e);
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

app.get("/", (_req, res) => res.send("Stuccord render worker up"));

app.get("/health", (_req, res) => {
  if (!ffmpegPath) {
    return res.status(503).json({ ok: false, ffmpeg: false, error: "FFmpeg unavailable" });
  }
  try {
    execFile(ffmpegPath, ["-version"], { timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (err) {
        return res.status(503).json({ ok: false, ffmpeg: false, error: "FFmpeg unavailable" });
      }
      const firstLine = (stdout || "").split("\n")[0]?.trim() || "";
      res.json({ ok: true, ffmpeg: true, version: firstLine.slice(0, 80) });
    });
  } catch {
    return res.status(503).json({ ok: false, ffmpeg: false, error: "FFmpeg unavailable" });
  }
});

// ---------- AI voiceovers (ElevenLabs text-to-speech) ----------
// Both are signed like /jobs; the app checks the user's monthly limit first.

const TTS_MODEL = "eleven_multilingual_v2";
const TTS_MAX_CHARS = 2500;
let voicesCache = null; // { at, voices }

// The voices the account can use: { voices: [{ voice_id, name, category, labels, preview_url }] }.
app.post("/voices", async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send("bad signature");
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: "AI voices aren't set up" });
  try {
    if (!voicesCache || Date.now() - voicesCache.at > 60 * 60 * 1000) {
      const r = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": key },
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        return res.status(502).json({ ok: false, error: elevenLabsError(r.status, detail, "AI voices") });
      }
      const data = await r.json();
      const voices = (Array.isArray(data?.voices) ? data.voices : [])
        .filter((v) => typeof v?.voice_id === "string" && typeof v?.name === "string")
        .map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: typeof v.category === "string" ? v.category : null,
          labels: v.labels && typeof v.labels === "object" ? v.labels : {},
          preview_url: isAbsoluteHttpUrl(v.preview_url) ? v.preview_url : null,
        }));
      voicesCache = { at: Date.now(), voices };
    }
    res.json({ ok: true, voices: voicesCache.voices });
  } catch (e) {
    console.warn("[Worker] Listing voices failed:", e?.message || e);
    res.status(502).json({ ok: false, error: "Couldn't load the voices" });
  }
});

// Speaks { text, voice_id } and returns the MP3.
app.post("/tts", async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send("bad signature");
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: "AI voices aren't set up" });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const voiceId = typeof req.body?.voice_id === "string" ? req.body.voice_id : "";
  if (!text || text.length > TTS_MAX_CHARS) {
    return res.status(400).json({ ok: false, error: `Text must be 1-${TTS_MAX_CHARS} characters` });
  }
  if (!/^[A-Za-z0-9]{8,64}$/.test(voiceId)) {
    return res.status(400).json({ ok: false, error: "Unknown voice" });
  }
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: TTS_MODEL }),
        signal: AbortSignal.timeout(2 * 60 * 1000),
      },
    );
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.warn(`[Worker] TTS failed: ${r.status} ${detail.slice(0, 200)}`);
      return res.status(502).json({ ok: false, error: elevenLabsError(r.status, detail, "The AI voice") });
    }
    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader("content-type", "audio/mpeg");
    res.send(audio);
  } catch (e) {
    console.warn("[Worker] TTS failed:", e?.message || e);
    res.status(502).json({ ok: false, error: "The AI voice couldn't be made" });
  }
});

// ---------- AI music (ElevenLabs Music) ----------
// Composes an instrumental track { prompt, length_ms } and returns the MP3.
// Signed like /jobs; the app checks the user's monthly limit first.

const MUSIC_MIN_MS = 10_000;
const MUSIC_MAX_MS = 300_000;

app.post("/music", async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send("bad signature");
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: "AI music isn't set up" });
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const lengthMs = Math.round(Number(req.body?.length_ms));
  if (!prompt || prompt.length > 1000) {
    return res.status(400).json({ ok: false, error: "The music description must be 1-1000 characters" });
  }
  if (!Number.isFinite(lengthMs) || lengthMs < MUSIC_MIN_MS || lengthMs > MUSIC_MAX_MS) {
    return res.status(400).json({ ok: false, error: `Music length must be ${MUSIC_MIN_MS / 1000}-${MUSIC_MAX_MS / 1000} s` });
  }
  try {
    // ElevenLabs answers 429 ("system_busy", heavy traffic; or too many at
    // once) at busy times: wait and try again (5 s, 15 s, 30 s) before
    // giving up, so one busy moment doesn't cost the video its music.
    let r;
    for (const waitMs of [0, 5000, 15000, 30000]) {
      if (waitMs) await new Promise((ok) => setTimeout(ok, waitMs));
      r = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ prompt, music_length_ms: lengthMs, force_instrumental: true }),
        // A few minutes of music can take a while to compose.
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      if (r.status !== 429) break;
      console.warn("[Worker] Music: ElevenLabs is busy (429), trying again");
    }
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.warn(`[Worker] Music failed: ${r.status} ${detail.slice(0, 200)}`);
      return res.status(502).json({ ok: false, error: elevenLabsError(r.status, detail, "The AI music") });
    }
    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader("content-type", "audio/mpeg");
    res.send(audio);
  } catch (e) {
    console.warn("[Worker] Music failed:", e?.message || e);
    res.status(502).json({ ok: false, error: "The AI music couldn't be made" });
  }
});

// Posting to YouTube (and later TikTok and Instagram), and the scheduled-post tick.
registerPublishing(app, { verifySignature, callback, signBody });

app.post("/jobs", async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send("bad signature");

  const job = req.body;
  const validationError = validateJobPayload(job);
  if (validationError) {
    console.warn(`[Worker] Rejected invalid job payload: ${validationError}`);
    return res.status(400).json({ ok: false, error: "Invalid job payload" });
  }

  if (currentJobId === job.job_id) {
    return res.status(409).json({ ok: false, error: "Job is already rendering" });
  }

  if (currentJobId !== null) {
    res.setHeader("Retry-After", "30");
    return res.status(503).json({ ok: false, error: "Worker is busy" });
  }

  currentJobId = job.job_id;
  res.status(202).json({ ok: true, job_id: job.job_id });

  // "Still working", once a minute, so the app can tell a long render from
  // one this worker lost in a restart (src/lib/render-lost.server.ts).
  const heartbeat = setInterval(() => {
    void callback(job.callback_url, { job_id: job.job_id, heartbeat: true });
  }, HEARTBEAT_MS);
  (async () => {
    try {
      await runRender(job);
    } catch (err) {
      console.error(`[Worker] Render failed for job=${job.job_id}:`, err?.message || err);
      reportError(err, "render", { job_id: job.job_id });
      try {
        await callback(job.callback_url, {
          job_id: job.job_id,
          status: "failed",
          error: String(err?.message ?? err).slice(0, 500),
        });
      } catch (cbErr) {
        console.error(`[Worker] Failed error-callback for job=${job.job_id}:`, cbErr?.message || cbErr);
      }
    } finally {
      clearInterval(heartbeat);
      currentJobId = null;
    }
  })();
});

// ---------- transcribing before an export (for planning graphics) ----------
//
// The app sends the project's files that have no transcript yet, each with a
// signed download link; the worker transcribes them and reports back to the
// app's /api/public/transcribe-webhook (signed like the render callback).
// It shares the export's lock, so it never runs alongside an export.

function validateTranscribePayload(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "Payload must be a JSON object";
  if (typeof p.project_id !== "string" || !UUID_REGEX.test(p.project_id)) return "Invalid project_id";
  if (typeof p.user_id !== "string" || !UUID_REGEX.test(p.user_id)) return "Invalid user_id";
  if (!isAbsoluteHttpUrl(p.callback_url)) return "callback_url must be an absolute http or https URL";
  if (!Array.isArray(p.files) || p.files.length === 0 || p.files.length > 50) {
    return "files must be a list of 1 to 50 files";
  }
  const ok = p.files.every(
    (f) => f && typeof f === "object" && isSafeRelativePath(f.storage_path) && isAbsoluteHttpUrl(f.download_url),
  );
  return ok ? null : "Each file needs a safe storage_path and an http(s) download_url";
}

// A screenshot of a public web page for an app screen (capture.js), one at a
// time, alongside any export. Answers with the PNG, or 422 and a message.
let capturing = false;
app.post("/capture", async (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  if (typeof p.url !== "string" || p.url.length > 500 || !["phone", "browser"].includes(p.device)) {
    return res.status(400).json({ ok: false, error: "Invalid capture payload" });
  }
  if (capturing) {
    res.setHeader("Retry-After", "10");
    return res.status(503).json({ ok: false, error: "Another page is being captured" });
  }
  capturing = true;
  try {
    const { png, url } = await capturePage({ url: p.url, device: p.device });
    res.setHeader("x-captured-url", encodeURI(url).slice(0, 500));
    res.type("image/png").send(png);
  } catch (e) {
    if (!(e instanceof CaptureError)) console.warn("[Worker] Capture failed:", e?.message || e);
    res.status(422).json({
      ok: false,
      error: e instanceof CaptureError ? e.message : "Couldn't capture that page. Try again, or upload a screenshot.",
    });
  } finally {
    capturing = false;
  }
});

// ---------- the automatic edit, driven from here ----------
//
// The app's automatic edit runs on the server (src/lib/auto-edit-run.server.ts
// in the app), so it carries on when the person closes the tab. This drives
// it: it calls the app's step address (step_url, /api/public/auto-edit-step)
// again and again for two parts at the same time, the main steps and the
// music; each answer says how long to wait before the next call, or that
// the part is over. The app does the work and keeps the progress; this only
// keeps time, so it doesn't take the export's lock. A call that fails (the
// app restarting, a dropped connection) is tried again, waiting longer each
// time; after 20 minutes of failures this part gives up, and the make page
// starts the run again when it sees it has gone quiet.

const autoEdits = new Map(); // project_id -> run
const AUTO_STEP_TIMEOUT_MS = 8 * 60 * 1000;
const AUTO_GIVE_UP_MS = 20 * 60 * 1000;

async function driveAutoEdit(p, lane) {
  let failingSince = null;
  let backoff = 5000;
  for (;;) {
    // A newer run for this project took over.
    if (autoEdits.get(p.project_id) !== p.run) return;
    const body = JSON.stringify({ project_id: p.project_id, run: p.run, lane });
    let answer = null;
    try {
      const r = await fetch(p.step_url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-stuccord-signature": signBody(body) },
        body,
        signal: AbortSignal.timeout(AUTO_STEP_TIMEOUT_MS),
      });
      if (r.status === 401 || r.status === 400) {
        console.error(`[Worker] Auto edit ${p.project_id} (${lane}): the app refused (${r.status}); stopping`);
        reportError(new Error(`Auto edit: the app refused the step (${r.status})`), "auto-edit", {
          project_id: p.project_id,
          lane,
        });
        return;
      }
      if (r.ok) answer = await r.json().catch(() => null);
      else console.warn(`[Worker] Auto edit ${p.project_id} (${lane}): step answered ${r.status}`);
    } catch (e) {
      console.warn(`[Worker] Auto edit ${p.project_id} (${lane}): step call failed:`, e?.message || e);
    }
    if (answer?.done) return;
    if (answer && Number.isFinite(answer.wait_ms)) {
      failingSince = null;
      backoff = 5000;
      const ms = Math.min(Math.max(0, answer.wait_ms), 60_000);
      if (ms) await new Promise((ok) => setTimeout(ok, ms));
      continue;
    }
    failingSince ??= Date.now();
    if (Date.now() - failingSince > AUTO_GIVE_UP_MS) {
      console.error(`[Worker] Auto edit ${p.project_id} (${lane}): giving up after 20 min of failed steps`);
      reportError(new Error("Auto edit: gave up after 20 min of failed steps"), "auto-edit", {
        project_id: p.project_id,
        lane,
      });
      return;
    }
    await new Promise((ok) => setTimeout(ok, backoff));
    backoff = Math.min(backoff * 2, 60_000);
  }
}

app.post("/auto-edit", (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  if (
    typeof p.project_id !== "string" || !UUID_REGEX.test(p.project_id) ||
    typeof p.run !== "string" || !UUID_REGEX.test(p.run) ||
    !isAbsoluteHttpUrl(p.step_url)
  ) {
    return res.status(400).json({ ok: false, error: "Invalid auto edit payload" });
  }
  autoEdits.set(p.project_id, p.run);
  res.status(202).json({ ok: true });
  console.log(`[Worker] Auto edit ${p.project_id}: run ${p.run} started`);
  Promise.all([driveAutoEdit(p, "main"), driveAutoEdit(p, "music")]).finally(() => {
    if (autoEdits.get(p.project_id) === p.run) autoEdits.delete(p.project_id);
    console.log(`[Worker] Auto edit ${p.project_id}: run ${p.run} over`);
  });
});

// One frame of a video (a signed link) as a JPEG, for the automatic edit's
// speaker look. Alongside anything else; ffmpeg reads only what it needs.
app.post("/frame", (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  const at = Math.round(Number(p.at_ms));
  const width = Math.round(Number(p.width));
  if (!isAbsoluteHttpUrl(p.url) || !Number.isFinite(at) || at < 0 || !(width >= 64 && width <= 1920)) {
    return res.status(400).json({ ok: false, error: "Invalid frame payload" });
  }
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-ss", (at / 1000).toFixed(3), "-i", p.url,
    "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3",
    "-f", "image2", "-c:v", "mjpeg", "pipe:1",
  ];
  const ff = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  let err = "";
  const timer = setTimeout(() => ff.kill("SIGKILL"), 45_000);
  ff.stdout.on("data", (c) => chunks.push(c));
  ff.stderr.on("data", (c) => (err += c));
  ff.on("close", (code) => {
    clearTimeout(timer);
    const jpg = Buffer.concat(chunks);
    if (code !== 0 || jpg.length < 100) {
      console.warn("[Worker] Frame failed:", err.slice(0, 300));
      return res.status(422).json({ ok: false, error: "Couldn't read a frame" });
    }
    res.type("image/jpeg").send(jpg);
  });
});

// ---------- footage preview copies ----------
// A small copy of an uploaded video for the editor's preview (the export
// keeps using the original): the short side at most PREVIEW_SHORT px, H.264
// with a keyframe every second (so the preview jumps to a cut at once), AAC
// sound, quick-start MP4. A phone's 29 MB clip comes out at ~3-4 MB, which a
// slow connection loads in minutes instead of most of an hour. Made one at a
// time, in the background, after the app asks (src/lib/footage-preview.server.ts).
const PREVIEW_SHORT = 720;
const previewQueue = [];
const previewPaths = new Set();
let previewBusy = false;

async function makePreview(p) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "preview-"));
  const started = Date.now();
  try {
    const src = path.join(workdir, "source");
    await download(p.source_url, src);
    const out = path.join(workdir, "preview.mp4");
    const s = PREVIEW_SHORT;
    // HDR made normal (hdr.js), as the export will show it.
    const hdr = hdrToSdr(await probeColour(spawn, ffmpegPath, src));
    await run(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error", "-i", src,
      "-map", "0:v:0", "-map", "0:a:0?",
      // Shrunk only, never enlarged; the phone's rotation is applied.
      "-vf", [hdr, `scale=w='if(gt(iw,ih),-2,min(${s},iw))':h='if(gt(iw,ih),min(${s},ih),-2)'`].filter(Boolean).join(","),
      "-fps_mode", "passthrough",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
      "-maxrate", "2500k", "-bufsize", "5000k",
      "-pix_fmt", "yuv420p", "-g", "30", "-keyint_min", "30",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      "-movflags", "+faststart",
      out,
    ]);
    const buf = await fsp.readFile(out);
    const up = await fetch(p.upload_url, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) throw new Error(`upload failed: ${up.status} ${(await up.text()).slice(0, 200)}`);
    const inBytes = (await fsp.stat(src)).size;
    console.log(
      `[Worker] Preview copy of ${p.path}: ${(inBytes / 1e6).toFixed(1)} MB -> ${(buf.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  } catch (e) {
    console.warn(`[Worker] Preview copy of ${p.path} failed:`, e?.message || e);
  } finally {
    await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function nextPreview() {
  if (previewBusy) return;
  const p = previewQueue.shift();
  if (!p) return;
  previewBusy = true;
  try {
    await makePreview(p);
  } finally {
    previewPaths.delete(p.path);
    previewBusy = false;
    void nextPreview();
  }
}

app.post("/preview", (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  if (
    typeof p.path !== "string" || !p.path || p.path.length > 400 ||
    !isAbsoluteHttpUrl(p.source_url) || !isAbsoluteHttpUrl(p.upload_url)
  ) {
    return res.status(400).json({ ok: false, error: "Invalid preview payload" });
  }
  // Asked already (another tab, a refresh): the copy on its way serves both.
  if (!previewPaths.has(p.path)) {
    previewPaths.add(p.path);
    previewQueue.push(p);
    void nextPreview();
  }
  res.status(202).json({ ok: true, queued: previewQueue.length });
});

// ---------- the editor preview's cleaned voice ----------
// A recording's sound with the export's own cleanup (noise.js: measured on
// the whole file, the user's Noise removal setting), so the editor plays
// what the export will. Sound only (the editor plays it in step with the
// picture). One at a time, in the background, after the app asks
// (src/lib/clean-voice.server.ts), saved where it says.
const voiceQueue = [];
const voiceKeys = new Set();
let voiceBusy = false;

async function makeCleanVoice(p) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "voice-"));
  const started = Date.now();
  try {
    const src = path.join(workdir, "source");
    await download(p.source_url, src);
    const heard = await analyzeVoice(ffmpegPath, src);
    const { filters, report } = voiceCleanup(heard, p.mode);
    const out = path.join(workdir, "voice.m4a");
    await run(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error", "-i", src,
      "-map", "0:a:0", "-vn",
      // At the file's own rate, as the export cleans it.
      "-af", filters,
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
      "-movflags", "+faststart",
      out,
    ]);
    const buf = await fsp.readFile(out);
    const up = await fetch(p.upload_url, {
      method: "PUT",
      headers: { "content-type": "audio/mp4", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) throw new Error(`upload failed: ${up.status} ${(await up.text()).slice(0, 200)}`);
    console.log(
      `[Worker] Cleaned voice of ${p.path} (${p.mode}): ${JSON.stringify(report)} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  } catch (e) {
    console.warn(`[Worker] Cleaned voice of ${p.path} (${p.mode}) failed:`, e?.message || e);
  } finally {
    await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function nextCleanVoice() {
  if (voiceBusy) return;
  const p = voiceQueue.shift();
  if (!p) return;
  voiceBusy = true;
  try {
    await makeCleanVoice(p);
  } finally {
    voiceKeys.delete(p.key);
    voiceBusy = false;
    void nextCleanVoice();
  }
}

app.post("/clean-voice", (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  if (
    typeof p.path !== "string" || !p.path || p.path.length > 400 ||
    !NOISE_MODES.includes(p.mode) || p.mode === "off" ||
    !isAbsoluteHttpUrl(p.source_url) || !isAbsoluteHttpUrl(p.upload_url)
  ) {
    return res.status(400).json({ ok: false, error: "Invalid clean-voice payload" });
  }
  const key = `${p.path}@${p.mode}`;
  if (!voiceKeys.has(key)) {
    voiceKeys.add(key);
    voiceQueue.push({ ...p, key });
    void nextCleanVoice();
  }
  res.status(202).json({ ok: true, queued: voiceQueue.length });
});

// ---------- the editor preview's cut-out ----------
// The speaker's cut-out for one stretch of an uploaded clip with a graphic
// behind them (pixelcut.js pixelcutCutout: picture beside Pixelcut's matte),
// so the editor's preview shows the export's clean edge instead of its own
// rough browser cut-out. Made in the background after the app asks
// (src/lib/cutout-preview.server.ts), two at a time, saved where it says.
const cutoutQueue = [];
const cutoutKeys = new Set();
let cutoutsBusy = 0;
const CUTOUTS_AT_ONCE = 2;

async function makeCutout(p) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "cutout-"));
  const started = Date.now();
  try {
    const { file, frames } = await pixelcutCutout({
      ffmpegPath, sourceUrl: p.source_url, fromMs: p.from_ms, toMs: p.to_ms, workdir,
    });
    const buf = await fsp.readFile(file);
    const up = await fetch(p.upload_url, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) throw new Error(`upload failed: ${up.status} ${(await up.text()).slice(0, 200)}`);
    console.log(
      `[Worker] Preview cut-out of ${p.path} ${p.from_ms}-${p.to_ms} ms: ${frames} frames, ${(buf.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  } catch (e) {
    const why = [e?.message || e, e?.cause?.code || e?.cause?.message].filter(Boolean).join(": ");
    console.warn(`[Worker] Preview cut-out of ${p.path} ${p.from_ms}-${p.to_ms} ms failed: ${why}`);
  } finally {
    await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

function nextCutout() {
  while (cutoutsBusy < CUTOUTS_AT_ONCE && cutoutQueue.length) {
    const p = cutoutQueue.shift();
    cutoutsBusy++;
    void makeCutout(p).finally(() => {
      cutoutKeys.delete(p.key);
      cutoutsBusy--;
      nextCutout();
    });
  }
}

app.post("/cutout", (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  const from = Math.round(Number(p.from_ms));
  const to = Math.round(Number(p.to_ms));
  if (
    typeof p.path !== "string" || !p.path || p.path.length > 400 ||
    !isAbsoluteHttpUrl(p.source_url) || !isAbsoluteHttpUrl(p.upload_url) ||
    !(from >= 0 && to > from && to - from <= CUTOUT_MAX_MS)
  ) {
    return res.status(400).json({ ok: false, error: "Invalid cut-out payload" });
  }
  // Without Pixelcut the preview keeps its own cut-out.
  if (!pixelcutReady()) return res.status(503).json({ ok: false, error: "Cut-out not set up" });
  const key = `${p.path}@${from}-${to}`;
  if (!cutoutKeys.has(key)) {
    cutoutKeys.add(key);
    cutoutQueue.push({ ...p, from_ms: from, to_ms: to, key });
    nextCutout();
  }
  res.status(202).json({ ok: true, queued: cutoutQueue.length });
});

// The editor's preview grade: the export's whole grade on this footage (the
// correction measured on the main track's videos as the export measures
// them, then the ready-made LUT at the strength skin allows, or the look's
// LUT) baked into one table the editor draws the picture through
// (luts.js bakeGradeTable). Body: { sources: [{ url, in_ms, out_ms }],
// aspect, center, look, lut: { id, strength } | null }.
app.post("/grade-table", async (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  const sources = Array.isArray(p.sources) ? p.sources.filter((s) => isAbsoluteHttpUrl(s?.url)).slice(0, 8) : [];
  if (!sources.length || (p.look != null && typeof p.look !== "string")) {
    return res.status(400).json({ ok: false, error: "Invalid grade table payload" });
  }
  try {
    const { w, h } = aspectDims(p.aspect);
    // Each video as the export normalizes it: HDR made normal, fitted to
    // the frame, only the part on the timeline.
    const items = await Promise.all(
      sources.map(async (s) => ({
        file: s.url,
        inMs: Number(s.in_ms) || 0,
        outMs: Number(s.out_ms) || 0,
        pre: [hdrToSdr(await probeColour(spawn, ffmpegPath, s.url)), coverFilter(w, h)].filter(Boolean).join(","),
      })),
    );
    const stats = await analyzeColour(ffmpegPath, items, { center: p.center ?? null });
    const params = correctionParams(stats);
    const pick = p.lut && typeof p.lut.id === "string" ? p.lut : null;
    const k = pick ? packSkinSafeStrength(pick.id, Number(pick.strength ?? 1), correctedSkin(stats)) : 0;
    const table = bakeGradeTable({
      correct: (r, g, b) => correctColour(params, r, g, b),
      look: p.look ?? null,
      pack: pick && k > 0 ? { id: pick.id, k } : null,
    });
    res.json({
      ok: true,
      size: table.size,
      table: table.data.toString("base64"),
      lut: pick ? { id: pick.id, strength: k } : null,
      correction: params,
    });
  } catch (e) {
    console.warn("[Worker] Grade table failed:", e?.message || e);
    res.status(500).json({ ok: false, error: "Couldn't make the grade table" });
  }
});

// The colour choices on this footage, for the automatic edit's LUT pick: a
// few frames of the video, each corrected and graded exactly as the export
// does (colour.js correction, then the look's own grade or a pack LUT),
// side by side, one JPEG per choice. The AI looks at them and picks.
app.post("/grade-sheet", async (req, res) => {
  if (!SECRET || !verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body ?? {};
  const times = Array.isArray(p.times_ms) ? p.times_ms.map(Number).filter((t) => Number.isFinite(t) && t >= 0) : [];
  const choices = Array.isArray(p.choices) ? p.choices : [];
  const width = Math.round(Number(p.width) || 320);
  if (
    !isAbsoluteHttpUrl(p.url) || !times.length || times.length > 4 ||
    !choices.length || choices.length > 6 || !(width >= 128 && width <= 640) ||
    typeof p.look !== "string"
  ) {
    return res.status(400).json({ ok: false, error: "Invalid grade sheet payload" });
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "grade-sheet-"));
  try {
    // The frames, as lossless stills (HDR made normal first: hdr.js).
    const hdr = hdrToSdr(await probeColour(spawn, ffmpegPath, p.url));
    const frames = [];
    for (const [i, at] of times.entries()) {
      const out = path.join(dir, `f${i}.png`);
      await run(ffmpegPath, [
        "-hide_banner", "-loglevel", "error",
        "-ss", (at / 1000).toFixed(3), "-i", p.url,
        "-frames:v", "1", "-vf", [hdr, `scale=${width}:-2`].filter(Boolean).join(","), "-y", out,
      ]);
      frames.push(out);
    }
    // The correction from these frames (the export measures the whole video).
    const colourStats = await analyzeColour(ffmpegPath, frames, { center: p.center ?? null });
    const correction = correctionFilter(colourStats);
    const skin = correctedSkin(colourStats);
    const finish = lookFinish(p.look);
    const sheets = [];
    for (const c of choices) {
      const key = String(c?.key ?? "").slice(0, 40);
      const grade =
        c?.id === "look"
          ? (lutFilter(p.look) ?? gradeFilter(finish))
          : (() => {
              // As the export will use it: no stronger than skin allows.
              const k = packSkinSafeStrength(c?.id, Number(c?.strength ?? 1), skin);
              return k > 0 ? packLutFilter(c?.id, k) : null;
            })();
      if (!key || (c?.id !== "look" && !grade)) continue;
      const chain = [correction, grade, "format=yuv420p"].filter(Boolean).join(",");
      const inputs = frames.flatMap((f) => ["-i", f]);
      const graph =
        frames.map((_, i) => `[${i}:v]${chain}[g${i}]`).join(";") +
        `;${frames.map((_, i) => `[g${i}]`).join("")}${frames.length > 1 ? `hstack=inputs=${frames.length}` : "null"}[out]`;
      const out = path.join(dir, `${sheets.length}.jpg`);
      await run(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", ...inputs,
        "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-q:v", "3", "-y", out,
      ]);
      sheets.push({ key, jpeg: (await fsp.readFile(out)).toString("base64") });
    }
    res.json({ ok: true, sheets });
  } catch (e) {
    console.warn("[Worker] Grade sheet failed:", e?.message || e);
    res.status(422).json({ ok: false, error: "Couldn't make the grade sheet" });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

app.post("/transcribe", async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send("bad signature");
  const p = req.body;
  const validationError = validateTranscribePayload(p);
  if (validationError) {
    console.warn(`[Worker] Rejected transcribe payload: ${validationError}`);
    return res.status(400).json({ ok: false, error: "Invalid transcribe payload" });
  }
  if (currentJobId !== null) {
    res.setHeader("Retry-After", "30");
    return res.status(503).json({ ok: false, error: "Worker is busy" });
  }

  currentJobId = `transcribe:${p.project_id}`;
  res.status(202).json({ ok: true });

  (async () => {
    const report = (status, extra) =>
      callback(p.callback_url, { project_id: p.project_id, user_id: p.user_id, status, ...extra });
    let workdir = null;
    try {
      if (!process.env.ELEVENLABS_API_KEY) {
        await report("failed", { error: "Speech-to-text isn't set up on the worker (ELEVENLABS_API_KEY)." });
        return;
      }
      if (!ffmpegPath) throw new Error("ffmpeg binary not available");
      workdir = await fsp.mkdtemp(path.join(os.tmpdir(), `stuccord-transcribe-`));
      const transcripts = [];
      const errors = [];
      for (let i = 0; i < p.files.length; i++) {
        const f = p.files[i];
        try {
          const src = path.join(workdir, `src_${i}`);
          await download(f.download_url, src);
          const audioPath = path.join(workdir, `speech_${i}.m4a`);
          await run(ffmpegPath, [
            "-y", "-i", src,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k",
            audioPath,
          ]);
          await fsp.rm(src, { force: true });
          const t = await transcribe(audioPath);
          if (!t) continue;
          transcripts.push({
            storage_path: f.storage_path,
            provider: t.provider,
            model: t.model,
            language: t.language,
            words: t.words,
          });
        } catch (e) {
          console.error(`[Worker] Transcribing failed for project=${p.project_id}:`, e?.message || e);
          reportError(e, "transcribe", { project_id: p.project_id });
          errors.push(`${f.filename || `File ${i + 1}`}: ${String(e?.message ?? e).slice(0, 200)}`);
        }
      }
      if (errors.length) {
        await report("failed", {
          transcripts,
          error: `Couldn't transcribe ${errors.length} of ${p.files.length} file(s). ${errors[0]}`.slice(0, 500),
        });
      } else {
        await report("done", { transcripts });
      }
    } catch (err) {
      console.error(`[Worker] Transcribe run failed for project=${p.project_id}:`, err?.message || err);
      reportError(err, "transcribe", { project_id: p.project_id });
      await report("failed", { error: String(err?.message ?? err).slice(0, 500) });
    } finally {
      if (workdir) await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
      currentJobId = null;
    }
  })();
});

// ---------- helpers ----------

function run(cmd, args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    // Every ffmpeg run is held to a few threads (see threads.js).
    const child = spawn(cmd, cmd === ffmpegPath ? limitThreads(args) : args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      if (onProgress) onProgress(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Streamed straight to disk (a whole video held in memory can run a small
// worker out of memory), with one retry on a dropped connection.
async function download(url, dest) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // A connection that sends nothing for 60 s is dropped and retried,
    // instead of hanging the render forever.
    const ac = new AbortController();
    let stall = setTimeout(() => ac.abort(new Error("download stalled")), 60_000);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok || !r.body) throw new Error(`download failed: ${r.status}`);
      const body = Readable.fromWeb(r.body);
      body.on("data", () => {
        clearTimeout(stall);
        stall = setTimeout(() => ac.abort(new Error("download stalled")), 60_000);
      });
      await pipeline(body, fs.createWriteStream(dest));
      return;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(stall);
    }
    // A missing or expired file won't come back on a retry.
    if (/download failed: 4\d\d/.test(String(lastErr?.message))) break;
  }
  throw lastErr;
}

function aspectDims(ratio) {
  if (ratio === "16:9") return { w: 1920, h: 1080 };
  if (ratio === "1:1") return { w: 1080, h: 1080 };
  return { w: 1080, h: 1920 }; // 9:16 default
}

// Build a scale+crop filter that "covers" the target box (no letterboxing).
// Down to 30 fps first, so 60 fps phone footage is only scaled half as often.
function coverFilter(w, h) {
  return `fps=30,scale=w=${w}:h=${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
}

// The whole clip in the middle of the frame, over a blurred, zoomed, slightly
// darker copy of itself that fills the rest (e.g. a vertical phone clip in a
// 16:9 video). The copy is blurred at a tenth of the size, which is cheap.
function blurFillFilter(w, h) {
  const bw = Math.round(w / 20) * 2;
  const bh = Math.round(h / 20) * 2;
  return [
    "fps=30,split=2[bg][fg]",
    `[bg]scale=w=${bw}:h=${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:2,scale=${w}:${h},eq=brightness=-0.08[bgb]`,
    `[fg]scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease:force_divisible_by=2[fgs]`,
    "[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30",
  ].join(";");
}

// Clips (nearly) the project's shape fill the frame; others are shown whole
// over a blurred copy, matching the editor preview. Unknown shape: blur fill,
// which still looks right when the shape matches.
function fitFilter(w, h, src) {
  if (src?.width && src?.height) {
    const off = Math.abs(Math.log(src.width / src.height / (w / h)));
    if (off < 0.03) return coverFilter(w, h);
  }
  return blurFillFilter(w, h);
}

// A clip moved, resized or rotated in the editor's preview, matching the app
// (src/lib/clip-transform.ts): { x, y, scale, rotation } or null for the
// default fit. x, y: the clip's centre from the frame's centre, as a share of
// the frame; scale: size compared with the default fit; rotation: degrees,
// clockwise. Kept within the app's limits.
function clipTransform(clip) {
  const t = clip?.transform;
  if (!t || typeof t !== "object") return null;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const out = {
    x: clamp(num(t.x, 0), -1.5, 1.5),
    y: clamp(num(t.y, 0), -1.5, 1.5),
    scale: clamp(num(t.scale, 1), 0.05, 4),
    rotation: ((((num(t.rotation, 0) + 180) % 360) + 360) % 360) - 180,
  };
  const identity = out.x === 0 && out.y === 0 && out.scale === 1 && out.rotation === 0;
  return identity ? null : out;
}

// The clip's box in a w x h frame: its default fit (the frame for a clip of
// the frame's shape, otherwise the whole clip as large as fits), scaled, with
// its centre moved. Even sizes, for H.264.
function transformedBox(w, h, src, t) {
  let fitW = w;
  let fitH = h;
  if (src?.width && src?.height) {
    const off = Math.abs(Math.log(src.width / src.height / (w / h)));
    if (off >= 0.03) {
      const s = Math.min(w / src.width, h / src.height);
      fitW = src.width * s;
      fitH = src.height * s;
    }
  }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return {
    bw: even(fitW * t.scale),
    bh: even(fitH * t.scale),
    cx: w / 2 + t.x * w,
    cy: h / 2 + t.y * h,
  };
}

// The clip filling its box (cropped to the box's shape, which only trims a
// clip of the frame's shape), an image slowly zooming inside it.
function boxFillFilter(bw, bh, imageLengthS) {
  let f = `fps=30,scale=w=${bw}:h=${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},setsar=1`;
  if (imageLengthS != null) {
    const len = Math.max(0.1, imageLengthS).toFixed(3);
    f += `,scale=w='trunc(${bw}*(1+${IMAGE_ZOOM}*t/${len})/2)*2':h=-2:eval=frame,crop=${bw}:${bh}`;
  }
  return f;
}

// Turns the picture clockwise by `deg`, growing it to fit, with the new
// corners see-through.
function rotateFilter(deg) {
  const rad = ((deg * Math.PI) / 180).toFixed(6);
  return `format=rgba,rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`;
}

// A main-track clip that's been moved, resized or rotated: its blurred copy
// fills the frame and the clip sits in its box on top (as in the preview).
function transformedMainFilter(w, h, src, t, imageLengthS) {
  const { bw, bh, cx, cy } = transformedBox(w, h, src, t);
  // Zoomed in so the clip covers the whole frame (a landscape take filling a
  // tall video): crop the part that shows, then scale it to the frame. The
  // same picture as scaling the whole clip up and placing it, at a fraction
  // of the work (no 3400-pixel-wide frames), and no blurred copy is needed.
  const left = bw / 2 - cx;
  const top = bh / 2 - cy;
  if (
    !t.rotation &&
    imageLengthS == null &&
    src?.width &&
    src?.height &&
    left >= 0 &&
    top >= 0 &&
    left + w <= bw + 0.5 &&
    top + h <= bh + 0.5
  ) {
    const sx = src.width / bw;
    const sy = src.height / bh;
    const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
    const cw = Math.min(even(w * sx), even(src.width));
    const ch = Math.min(even(h * sy), even(src.height));
    const x = Math.min(Math.max(0, Math.round(left * sx)), src.width - cw);
    const y = Math.min(Math.max(0, Math.round(top * sy)), src.height - ch);
    return `fps=30,crop=${cw}:${ch}:${x}:${y},scale=${w}:${h},setsar=1,format=yuv420p`;
  }
  const blurW = Math.round(w / 20) * 2;
  const blurH = Math.round(h / 20) * 2;
  const fg = boxFillFilter(bw, bh, imageLengthS) + (t.rotation ? `,${rotateFilter(t.rotation)}` : "");
  return [
    "fps=30,split=2[bg][fg]",
    `[bg]scale=w=${blurW}:h=${blurH}:force_original_aspect_ratio=increase,crop=${blurW}:${blurH},boxblur=6:2,scale=${w}:${h},eq=brightness=-0.08[bgb]`,
    `[fg]${fg}[fgb]`,
    `[bgb][fgb]overlay=x='${cx.toFixed(2)}-w/2':y='${cy.toFixed(2)}-h/2',setsar=1,fps=30,format=yuv420p`,
  ].join(";");
}

// Images (photos, screenshots) as clips, matching the app (src/lib/media-kind.ts):
// a clip shows for its trimmed length and slowly zooms in by IMAGE_ZOOM.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const IMAGE_ZOOM = 0.08;
const IMAGE_DEFAULT_MS = 3000;
const isImageClip = (clip) => IMAGE_EXT.test(String(clip?.filename ?? ""));

// Slow push-in over `lengthS`, applied after the fit filter (input w x h):
// scale up a little more each frame and crop the middle back to w x h.
function kenBurnsFilter(w, h, lengthS) {
  const len = Math.max(0.1, lengthS).toFixed(3);
  return `scale=w='trunc(${w}*(1+${IMAGE_ZOOM}*t/${len})/2)*2':h=-2:eval=frame,crop=${w}:${h}`;
}

// Where clips sit on a track, matching the app (src/lib/timeline-layout.ts):
// a clip with start_ms sits there; one without follows the clip before it.
// Clips are in order and never overlap (one that would start inside the
// previous one starts at its end). Returns each clip's start in ms.
function layoutStarts(clips, lengthsMs) {
  const starts = [];
  let end = 0;
  clips.forEach((c, i) => {
    const want = c.start_ms == null ? end : Number(c.start_ms);
    const start = Math.max(end, Math.round(Number.isFinite(want) ? want : end));
    starts.push(start);
    end = start + Math.max(0, lengthsMs[i] ?? 0);
  });
  return starts;
}

// Where each song starts, matching the app (musicStarts in
// src/lib/timeline-layout.ts): a placed song at its time, others right after
// the song before. A song plays (looping) until the next one starts, so it
// only has to start no earlier than the one before it.
function musicStartsMs(songs, lengthsMs) {
  const starts = [];
  let prevStart = 0;
  let prevEnd = 0;
  songs.forEach((c, i) => {
    const want = c.start_ms == null ? prevEnd : Number(c.start_ms);
    const start = Math.max(prevStart, Math.round(Number.isFinite(want) ? want : prevEnd));
    starts.push(start);
    prevStart = start;
    prevEnd = start + Math.max(0, lengthsMs[i] ?? 0);
  });
  return starts;
}

// A clip's length on the timeline from its trims (used when its rendered
// file's length can't be read).
function trimmedLengthMs(clip) {
  const inMs = Math.max(0, Number(clip.trim_in_ms ?? 0));
  if (isImageClip(clip)) return Math.max(100, Number(clip.trim_out_ms ?? IMAGE_DEFAULT_MS) - inMs);
  const outMs = clip.trim_out_ms ?? clip.duration_ms;
  return outMs != null ? Math.max(0, Number(outMs) - inMs) : 0;
}

// Black and silence for a gap in the main track, encoded like the
// normalized clips so the track still joins by copying streams.
async function makeGapClip(out, ms, w, h) {
  await run(ffmpegPath, [
    "-y",
    "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:r=30`,
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-t", (ms / 1000).toFixed(3),
    "-vf", "setsar=1",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    out,
  ]);
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ");
}

// ---------- brand kit ----------
// The account's brand kit, sent with the job (matching src/lib/brand-kit.ts):
// caption font, colours, size and position, the hook's box colour, and a
// logo. Anything missing or invalid falls back to the standard look.

const FONTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
// Font files in ./fonts and the family name inside each. "Bold" picks the
// bold face where the family has one; display fonts are bold already.
const BRAND_FONTS = {
  poppins: { file: "Poppins-Bold.ttf", family: "Poppins", bold: true },
  lato: { file: "Lato-Black.ttf", family: "Lato Black", bold: false },
  anton: { file: "Anton-Regular.ttf", family: "Anton", bold: false },
  bebas: { file: "BebasNeue-Regular.ttf", family: "Bebas Neue", bold: false },
  archivo: { file: "ArchivoBlack-Regular.ttf", family: "Archivo Black", bold: false },
  luckiest: { file: "LuckiestGuy-Regular.ttf", family: "Luckiest Guy", bold: false },
};
const CAPTION_SIZE = { s: 0.06, m: 0.075, l: 0.09 };
// Clean captions (the Minimal look): this much smaller, the words not being
// spoken this see-through (ASS alpha, 00 solid to FF clear).
const CLEAN_CAPTION_SCALE = 0.85;
const CLEAN_DIM_ALPHA = "60";

function brandKitFromJob(job) {
  const v = job?.brand_kit && typeof job.brand_kit === "object" ? job.brand_kit : {};
  const hex = (x, d) => (typeof x === "string" && /^#[0-9A-Fa-f]{6}$/.test(x) ? x.toUpperCase() : d);
  const pick = (x, allowed, d) => (allowed.includes(x) ? x : d);
  const num = (x, lo, hi, d) => (Number.isFinite(Number(x)) ? Math.min(hi, Math.max(lo, Number(x))) : d);
  const logo = v.logo && typeof v.logo === "object" && isAbsoluteHttpUrl(v.logo.url) ? v.logo : null;
  return {
    font: pick(v.font, Object.keys(BRAND_FONTS), "default"),
    textColor: hex(v.textColor, "#FFFFFF"),
    highlightColor: hex(v.highlightColor, "#FFD700"),
    outlineColor: hex(v.outlineColor, "#000000"),
    size: pick(v.size, ["s", "m", "l"], "m"),
    position: pick(v.position, ["bottom", "middle", "top"], "bottom"),
    hookBoxColor: hex(v.hookBoxColor, "#000000"),
    logo: logo
      ? {
          url: logo.url,
          corner: pick(logo.corner, ["tl", "tr", "bl", "br"], "br"),
          width: num(logo.width, 0.06, 0.3, 0.14),
          opacity: num(logo.opacity, 0.2, 1, 0.85),
        }
      : null,
  };
}

/** The brand font's file, if the kit picked one and it's here. */
function brandFontFile(kit) {
  const f = BRAND_FONTS[kit.font];
  if (!f) return null;
  const file = path.join(FONTS_DIR, f.file);
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** "#RRGGBB" as an ASS colour (&HAABBGGRR, opaque). */
function assColor(hex) {
  const n = hex.replace("#", "");
  return `&H00${n.slice(4, 6)}${n.slice(2, 4)}${n.slice(0, 2)}`.toUpperCase();
}

/** Where a mark goes: `corner` (tl/tr/bl/br), m px in from the edges. */
function cornerXY(corner, m) {
  return {
    x: corner.endsWith("l") ? `${m}` : `W-w-${m}`,
    y: corner.startsWith("t") ? `${m}` : `H-h-${m}`,
  };
}

/**
 * The "Made with Stuccord" watermark on free plans' exports (the job's
 * `watermark`): the logo and name on a soft dark pill (assets/watermark.png),
 * a third of the frame's short side wide, in a bottom corner below where
 * captions sit (they keep 20% of the height clear), the one the brand logo
 * isn't in.
 */
const WATERMARK_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "watermark.png");
const WATERMARK_WIDTH = 0.32;
const WATERMARK_OPACITY = 0.9;

function watermarkMark(kit, w, h) {
  const corner = kit.logo?.corner === "bl" ? "br" : "bl";
  return {
    file: WATERMARK_FILE,
    width: Math.max(2, Math.round((Math.min(w, h) * WATERMARK_WIDTH) / 2) * 2),
    opacity: WATERMARK_OPACITY,
    ...cornerXY(corner, Math.round(Math.min(w, h) * 0.04)),
  };
}

/** The brand logo in its corner (4% of the shorter side in from the edges, as the preview shows it). */
function logoMark(kit, logoPath, w, h) {
  return {
    file: logoPath,
    width: Math.max(2, Math.round((w * kit.logo.width) / 2) * 2),
    opacity: kit.logo.opacity,
    ...cornerXY(kit.logo.corner, Math.round(Math.min(w, h) * 0.04)),
  };
}

/** Puts pictures (the brand logo, the watermark) over the video, in one more encode. */
async function overlayMarks(input, marks, out) {
  const graph = [];
  let last = "0:v";
  marks.forEach((mk, i) => {
    graph.push(`[${i + 1}:v]scale=${mk.width}:-1,format=rgba,colorchannelmixer=aa=${mk.opacity.toFixed(2)}[m${i}]`);
    graph.push(`[${last}][m${i}]overlay=x=${mk.x}:y=${mk.y}:format=auto[o${i}]`);
    last = `o${i}`;
  });
  graph.push(`[${last}]format=yuv420p[vout]`);
  await run(ffmpegPath, [
    "-y", "-i", input, ...marks.flatMap((mk) => ["-i", mk.file]),
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    out,
  ]);
  return out;
}

function findSystemFont() {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch { /* keep looking */ }
  }
  return null;
}

// ---------- transcripts on the timeline ----------

// Duration (ms), whether there's an audio stream, and the picture's shape as
// shown (width/height after the phone's rotation), read from what ffmpeg
// prints when given an input and no output. Unreadable values are null.
function probeMedia(file) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", () =>
      resolve({ durationMs: null, hasAudio: false, width: null, height: null }),
    );
    child.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const size = stderr.match(/Stream #\d+:\d+.*: Video:.*?\b(\d{2,5})x(\d{2,5})\b/);
      const rotation = stderr.match(/rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/);
      const turned = rotation && Math.abs(Math.round(Number(rotation[1] ?? rotation[2]))) % 180 === 90;
      const w = size ? Number(size[1]) : null;
      const h = size ? Number(size[2]) : null;
      resolve({
        durationMs: m
          ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000)
          : null,
        hasAudio: /Stream #\d+:\d+.*: Audio:/.test(stderr),
        width: turned ? h : w,
        height: turned ? w : h,
        // Its colour (HDR or not: hdr.js).
        colour: colourTags(stderr.split("\n").find((l) => /Stream #\d+:\d+.*: Video:/.test(l))),
      });
    });
  });
}

/** How long a clip's sound runs once trimmed (ms), or null when it can't be told. */
function clipSoundMs(durationMs, trimInMs, trimOutMs) {
  const out = trimOutMs != null && Number(trimOutMs) > 0 ? Number(trimOutMs) : null;
  // A trim past the end of the file stops where the file does.
  const end = out != null && Number.isFinite(durationMs) ? Math.min(out, durationMs) : (out ?? durationMs);
  if (!Number.isFinite(end)) return null;
  const len = end - trimInMs;
  return len > 0 ? len : null;
}

/** Fades at a clip's cut points (CUT_FADE_MS in and out). */
const CUT_FADE_MS = 10;
function cutFades(lengthMs) {
  const d = (CUT_FADE_MS / 1000).toFixed(3);
  const outAt = Math.max(0, (lengthMs - CUT_FADE_MS) / 1000).toFixed(3);
  return `afade=t=in:st=0:d=${d},afade=t=out:st=${outAt}:d=${d}`;
}

async function probeDurationMs(file) {
  return (await probeMedia(file)).durationMs;
}

// Keeps only well-formed words ({ text, start_ms, end_ms }), in time order.
// Saved transcripts include the user's edits, so don't trust their shape.
function sanitizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .filter(
      (w) =>
        w &&
        typeof w.text === "string" &&
        w.text.trim() &&
        Number.isFinite(w.start_ms) &&
        Number.isFinite(w.end_ms) &&
        w.end_ms >= w.start_ms,
    )
    .map((w) => ({
      text: w.text.trim(),
      start_ms: Math.round(w.start_ms),
      end_ms: Math.round(w.end_ms),
    }))
    .sort((a, b) => a.start_ms - b.start_ms);
}

/**
 * Converts each clip's source-file words to final-video time. A clip plays
 * source time [trimInMs, trimInMs + durationMs) starting at offsetMs in the
 * final video; words that start outside that window aren't shown.
 */
function placeWordsOnTimeline(segments) {
  const placed = [];
  for (const { words, trimInMs, durationMs, offsetMs, clipId } of segments) {
    const windowEnd = trimInMs + durationMs;
    for (const [wordIndex, w] of words.entries()) {
      if (w.start_ms < trimInMs || w.start_ms >= windowEnd) continue;
      placed.push({
        // Which clip and word it is, for graphics anchored to words.
        clip_id: clipId,
        word_index: wordIndex,
        text: w.text,
        start_ms: offsetMs + (w.start_ms - trimInMs),
        end_ms: offsetMs + (Math.min(w.end_ms, windowEnd) - trimInMs),
      });
    }
  }
  return placed;
}

// ---------- music & SFX mix (see audio.js) ----------

const SFX_LEAD_MS = 150; // start an SFX just before the cut so it leads in

// ---------- captions ----------

const CAPTION_MAX_WORDS = 3;
const CAPTION_MAX_GAP_MS = 400; // a longer pause starts a new caption
const CAPTION_MAX_SPAN_MS = 1500; // and so does a caption running this long
const CAPTION_HOLD_MS = 250; // keep the last word up briefly after it's spoken

// Groups transcript words into short captions of up to three words, breaking
// on pauses and at punctuation so each caption reads as one phrase.
function groupCaptionWords(words) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const startNew =
      prev &&
      (cur.length >= CAPTION_MAX_WORDS ||
        w.start_ms - prev.end_ms > CAPTION_MAX_GAP_MS ||
        /[.!?,;:]$/.test(prev.text) ||
        w.end_ms - cur[0].start_ms > CAPTION_MAX_SPAN_MS);
    if (startNew) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// ASS timestamps are H:MM:SS.cc (centiseconds).
function assTime(ms) {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// Braces and backslashes are ASS override syntax; keep them out of the text.
function assText(text) {
  return String(text).replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
}

// Font family name of the font findSystemFont() picked, for the ASS style.
function fontFamily(fontPath) {
  if (/dejavu/i.test(fontPath)) return "DejaVu Sans";
  if (/arial/i.test(fontPath)) return "Arial";
  return path.basename(fontPath).replace(/\.[^.]+$/, "").replace(/-.*$/, "");
}

/**
 * Builds an ASS subtitle file for word-by-word captions: white bold text with
 * a black outline in the lower third, showing up to three words at a time
 * with the word being spoken highlighted yellow. Returns null when the
 * transcript has no words.
 */
function buildCaptionsAss(words, { w, h, fontName, kit = brandKitFromJob({}), bold = true, clean = false }) {
  const groups = groupCaptionWords(words);
  if (!groups.length) return null;

  // Clean (the Minimal look): a little smaller, not bold, no outline, on a
  // soft shadow; the spoken word bright and the others dimmed instead of a
  // highlight colour (the preview's PreviewOverlay the same).
  const fontSize = Math.round(Math.min(w, h) * CAPTION_SIZE[kit.size] * (clean ? CLEAN_CAPTION_SCALE : 1));
  const outline = clean ? 0 : Math.max(2, Math.round(fontSize * 0.08));
  const shadow = clean ? Math.max(1, Math.round(fontSize * 0.04)) : 0;
  const marginX = Math.round(w * 0.08);
  // 20% of the height from the bottom; at the top 24%, to clear the hook.
  const marginV = Math.round(h * (kit.position === "top" ? 0.24 : 0.2));
  // Colours are &HAABBGGRR (yellow #FFD700 is &H0000D7FF).
  const WHITE = assColor(kit.textColor);
  const HIGHLIGHT = assColor(kit.highlightColor);
  const OUTLINE = assColor(kit.outlineColor);
  // Lower third, middle or top (numpad layout); the margin is from the
  // bottom or top edge, as the preview places them.
  const alignment = kit.position === "top" ? 8 : kit.position === "middle" ? 5 : 2;

  const events = [];
  groups.forEach((group, gi) => {
    const nextStart = groups[gi + 1]?.[0].start_ms ?? Infinity;
    group.forEach((word, i) => {
      const start = word.start_ms;
      const end =
        i < group.length - 1
          ? group[i + 1].start_ms
          : Math.min(word.end_ms + CAPTION_HOLD_MS, nextStart);
      if (end <= start) return;
      const text = group
        .map((g, j) => {
          const t = assText(g.text);
          if (clean) return j === i ? t : `{\\1a&H${CLEAN_DIM_ALPHA}&}${t}{\\1a&H00&}`;
          return j === i ? `{\\c${HIGHLIGHT}&}${t}{\\c${WHITE}&}` : t;
        })
        .join(" ");
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`);
    });
  });

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${fontName},${fontSize},${WHITE},${WHITE},${OUTLINE},${clean ? "&H70000000" : "&H80000000"},${bold && !clean ? -1 : 0},0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},${marginX},${marginX},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

// Quotes a file path for use inside an ffmpeg filter argument. Everything
// inside single quotes is literal; a quote in the path closes, escapes and
// reopens the quoting. A colon (a Windows drive, "C:") is escaped as well, or
// the filter's own options read it as a separator; Linux paths have none.
function filterPath(p) {
  return `'${String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}'`;
}

// ---------- speech-to-text ----------


// Transcribes an audio file with ElevenLabs Scribe v2 and returns the spoken
// words with their timings in milliseconds from the start of the file.
// Returns null when no ELEVENLABS_API_KEY is configured.
async function transcribe(audioPath) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;

  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([await fsp.readFile(audioPath)], { type: "audio/mp4" }), "audio.m4a");

  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.warn(`[Worker] Speech-to-text failed: ${r.status} ${detail.slice(0, 200)}`);
    throw new Error(elevenLabsError(r.status, detail, "Transcribing"));
  }
  const data = await r.json();

  // Keep spoken words only (the response also has "spacing" and
  // "audio_event" entries) and drop any without timings.
  const words = (Array.isArray(data?.words) ? data.words : [])
    .filter(
      (w) =>
        w?.type === "word" &&
        typeof w.text === "string" &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end),
    )
    .map((w) => ({
      text: w.text.trim(),
      start_ms: Math.round(w.start * 1000),
      end_ms: Math.round(w.end * 1000),
    }))
    .filter((w) => w.text);

  return {
    provider: "elevenlabs",
    model: "scribe_v2",
    language: typeof data?.language_code === "string" ? data.language_code : null,
    text: typeof data?.text === "string" ? data.text : "",
    words,
  };
}

// ---------- render pipeline ----------

async function runRender(job) {
  if (!ffmpegPath) throw new Error("ffmpeg binary not available");

  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), `stuccord-${job.job_id}-`));
  const cleanup = async () => { try { await fsp.rm(workdir, { recursive: true, force: true }); } catch {} };

  try {
    // 1. Download all source clips
    await callback(job.callback_url, {
      job_id: job.job_id, status: "transcribing", progress: 10,
      stage_message: `Downloading ${job.clips.length} clip${job.clips.length === 1 ? "" : "s"}`,
    });
    // Video tracks in timeline order. A-roll ("aroll"/"auto") plays back to
    // back as the main picture and sound. B-roll plays back to back from 0:00
    // on top of it, muted, and is cut where the A-roll ends: the same layout
    // the editor timeline shows. With no A-roll, the B-roll is the main track.
    const videoClips = job.clips.filter(
      (c) => c.download_url && c.role !== "music" && c.role !== "sfx" && c.role !== "voiceover",
    );
    if (!videoClips.length) throw new Error("No downloadable clips provided");
    let mainClips = videoClips.filter((c) => c.role !== "broll");
    let brollClips = videoClips.filter((c) => c.role === "broll");
    if (!mainClips.length) {
      mainClips = brollClips;
      brollClips = [];
    }
    const clips = [...mainClips, ...brollClips];

    // Each file once: pieces cut from one take (the automatic pause cut makes
    // many) share its download. Up to 3 files download at the same time.
    const sources = [];
    const fileOf = new Map(); // storage path (or URL) -> { dest, url }
    for (let i = 0; i < clips.length; i++) {
      const key = clips[i].storage_path || clips[i].download_url;
      if (!fileOf.has(key)) {
        // Images keep their extension: ffmpeg picks the image reader by it.
        const ext = isImageClip(clips[i])
          ? String(clips[i].filename).match(IMAGE_EXT)[0].toLowerCase()
          : ".mp4";
        fileOf.set(key, { dest: path.join(workdir, `src_${fileOf.size}${ext}`), url: clips[i].download_url });
      }
      sources.push(fileOf.get(key).dest);
    }
    const files = [...fileOf.values()];
    for (let i = 0; i < files.length; i += 3) {
      await Promise.all(files.slice(i, i + 3).map((f) => download(f.url, f.dest)));
    }

    // 2. AI edit plan (best-effort)
    await callback(job.callback_url, {
      job_id: job.job_id, status: "planning", progress: 30,
      stage_message: "Planning cuts, captions & hook",
    });
    // Motion Explainer graphics from the app's plan, when they're on. They
    // cover the opening, so the old AI hook line isn't made for them.
    const motionJob =
      job.motion && Array.isArray(job.motion.elements) && job.motion.elements.length
        ? job.motion
        : null;
    const plan = motionJob ? null : await generateEditPlan(job);
    const hook = typeof plan?.hook === "string" ? plan.hook.trim() : "";

    // 3. Normalize each source to target aspect at 1080p / 30fps / H.264 + AAC.
    //    This makes the concat step lossless-safe (identical codec params).
    const { w, h } = aspectDims(job.aspect_ratio);

    await callback(job.callback_url, {
      job_id: job.job_id, status: "rendering", progress: 45,
      stage_message: `Normalizing clips to ${job.aspect_ratio}`,
      edit_plan: plan,
    });

    const normalized = [];
    // What each source file holds (shape, sound), for normalizing and for
    // choosing which files to transcribe.
    const probes = [];
    // The voice's cleanup, one per recording (noise.js): listened to once,
    // over the whole file, and applied to every clip cut from it, so each
    // piece of a recording sounds the same (and the editor's preview, which
    // cleans the same file the same way, sounds like this).
    const noise = noiseMode(job.noise);
    const cleanups = new Map();
    const cleanupOf = async (file) => {
      if (!cleanups.has(file)) {
        const heard = noise === "off"
          ? null
          : await analyzeVoice(ffmpegPath, file).catch((e) => {
              console.warn(`[Worker] Listening to ${path.basename(file)} failed:`, e?.message || e);
              return null;
            });
        cleanups.set(file, voiceCleanup(heard, noise));
      }
      return cleanups.get(file);
    };
    for (let i = 0; i < sources.length; i++) {
      const out = path.join(workdir, `norm_${i}.mp4`);
      const probe = await probeMedia(sources[i]);
      probes.push(probe);
      const image = isImageClip(clips[i]);
      const trimInMs = Math.max(0, Number(clips[i].trim_in_ms ?? 0));
      const trimOutMs = clips[i].trim_out_ms;
      const args = ["-y"];
      // Moved, resized or rotated in the editor: the main track gets its
      // blurred copy behind it; a B-roll clip is kept to its box and placed
      // over the main video when the tracks are combined (4b).
      const transform = clipTransform(clips[i]);
      const onTop = i >= mainClips.length;
      const imageLengthS = image
        ? Math.max(100, Number(trimOutMs ?? IMAGE_DEFAULT_MS) - trimInMs) / 1000
        : null;
      let vf;
      if (!transform) {
        vf = fitFilter(w, h, probe);
        if (image) vf = `${vf},${kenBurnsFilter(w, h, imageLengthS)}`;
      } else if (onTop) {
        const { bw, bh } = transformedBox(w, h, probe, transform);
        vf = boxFillFilter(bw, bh, imageLengthS);
      } else {
        vf = transformedMainFilter(w, h, probe, transform, imageLengthS);
      }
      // HDR footage made normal first (hdr.js), before it's fitted and graded.
      const hdr = image ? null : hdrToSdr(probe.colour);
      if (hdr) {
        vf = `${hdr},${vf}`;
        console.log(`[Worker] Clip ${i + 1} is HDR (${probe.colour.transfer}): tone-mapped to normal video`);
      }
      if (image) {
        // A still: repeat it for its length on the timeline, slowly zooming.
        // A GIF plays its animation on a loop for that length instead.
        if (/\.gif$/i.test(sources[i])) args.push("-ignore_loop", "0");
        else args.push("-f", "image2", "-loop", "1", "-framerate", "30");
        args.push("-t", imageLengthS.toFixed(3), "-i", sources[i]);
      } else {
        // Per-clip trim: -ss (in) and -to (out) as INPUT-side seek so audio stays in sync.
        if (trimInMs > 0) args.push("-ss", (trimInMs / 1000).toFixed(3));
        if (trimOutMs != null && Number(trimOutMs) > 0) {
          args.push("-to", (Number(trimOutMs) / 1000).toFixed(3));
        }
        args.push("-i", sources[i]);
      }
      // Every piece needs a sound track for the tracks to join cleanly
      // (they're joined by copying streams): images and silent videos get
      // silence, as long as the picture.
      if (image || !probe.hasAudio) {
        args.push(
          "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
          "-map", "0:v:0", "-map", "1:a:0", "-shortest",
        );
      }
      // A tiny fade at each end of a clip's sound, so a cut (a filler or a
      // retake taken out, the join to the next clip) never clicks: a cut
      // mid-waveform jumps, and a jump is a click. 10 ms is too short to hear.
      const soundMs = !image && probe.hasAudio ? clipSoundMs(probe.durationMs, trimInMs, trimOutMs) : null;
      // The main track is the voice: cleaned here, per recording. B-roll
      // keeps its own sound as it is (it's the room, on purpose).
      const clean = !onTop && !image && probe.hasAudio ? (await cleanupOf(sources[i])).filters : null;
      const af = [clean, soundMs ? cutFades(soundMs) : null].filter(Boolean).join(",");
      if (af) args.push("-af", af);
      args.push(
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        out,
      );
      await run(ffmpegPath, args);
      normalized.push(out);
      const pct = 45 + Math.round(((i + 1) / sources.length) * 25);
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: pct,
        stage_message: `Processed clip ${i + 1} of ${sources.length}`,
      });
    }


    // 4. Concat each track via demuxer
    const concatTrack = async (files, name, extraArgs = []) => {
      const listPath = path.join(workdir, `${name}.txt`);
      await fsp.writeFile(
        listPath,
        files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
      );
      const out = path.join(workdir, `${name}.mp4`);
      await run(ffmpegPath, [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        ...extraArgs,
        "-c", "copy", "-movflags", "+faststart",
        out,
      ]);
      return out;
    };
    // Real length of each main clip as rendered (trimmed and normalized), for
    // placing clips, caption words and SFX. null where it couldn't be read.
    const mainDurationsMs = [];
    for (let i = 0; i < mainClips.length; i++) {
      mainDurationsMs.push(await probeDurationMs(normalized[i]));
    }
    // Where each main clip starts (placed, or right after the one before);
    // gaps between them are black and silent.
    const mainLengthsMs = mainClips.map((c, i) => mainDurationsMs[i] ?? trimmedLengthMs(c));
    const mainStartsMs = layoutStarts(mainClips, mainLengthsMs);
    const mainParts = [];
    let mainCursor = 0;
    for (let i = 0; i < mainClips.length; i++) {
      const gapMs = mainStartsMs[i] - mainCursor;
      if (gapMs >= 34) {
        const gapOut = path.join(workdir, `gap_${i}.mp4`);
        await makeGapClip(gapOut, gapMs, w, h);
        mainParts.push(gapOut);
      }
      mainParts.push(normalized[i]);
      mainCursor = mainStartsMs[i] + mainLengthsMs[i];
    }
    // Where the main track ends, and the B-roll's timing: the video runs
    // until the last clip on either track ends, so B-roll past the main
    // track pads it with black (and silence, filled by the B-roll's own
    // sound in 4b), matching the app (videoEndMs in src/lib/timeline-layout.ts).
    const mainEndMs = mainCursor;
    const brollFiles = normalized.slice(mainClips.length);
    const brollLengthsMs = [];
    for (let i = 0; i < brollClips.length; i++) {
      brollLengthsMs.push((await probeDurationMs(brollFiles[i])) ?? trimmedLengthMs(brollClips[i]));
    }
    const brollStartsMs = layoutStarts(brollClips, brollLengthsMs);
    const brollEndMs = Math.max(0, ...brollStartsMs.map((s, i) => s + brollLengthsMs[i]));
    if (brollEndMs - mainEndMs >= 34) {
      const tailOut = path.join(workdir, "gap_tail.mp4");
      await makeGapClip(tailOut, brollEndMs - mainEndMs, w, h);
      mainParts.push(tailOut);
    }
    const concatOut = await concatTrack(mainParts, "concat");

    // 4a. Captions words (best-effort; skipped when the user turned captions
    //     off). Transcripts belong to whole source files, in source time, so
    //     each file is transcribed once and the user's corrections survive
    //     trims, splits and reorders. The app sends saved transcripts as
    //     clip.transcript_words; only main-track files without one are
    //     transcribed here, and new ones are reported back to be saved.
    const wantCaptions = job.captions !== false;
    let editPlan = plan;
    let captionWords = [];
    // Every placed word, with its clip and index (graphics are anchored to them).
    let placedWords = [];
    if (wantCaptions || motionJob) {
      const sourceKey = (c) => c.storage_path || c.id;
      const sourceWords = new Map();
      for (const c of mainClips) {
        if (Array.isArray(c.transcript_words)) {
          sourceWords.set(sourceKey(c), sanitizeWords(c.transcript_words));
        }
      }

      // One main clip per source file that still needs transcribing.
      const toTranscribe = [];
      const queued = new Set();
      mainClips.forEach((c, i) => {
        const key = sourceKey(c);
        if (sourceWords.has(key) || queued.has(key)) return;
        // Images and silent videos have no speech.
        if (isImageClip(c) || !probes[i]?.hasAudio) return;
        queued.add(key);
        toTranscribe.push(i);
      });

      const transcriptErrors = [];
      const newTranscripts = [];
      if (toTranscribe.length && process.env.ELEVENLABS_API_KEY) {
        await callback(job.callback_url, {
          job_id: job.job_id, status: "rendering", progress: 72,
          stage_message: `Transcribing speech (${toTranscribe.length} file${toTranscribe.length === 1 ? "" : "s"})`,
        });
        for (const i of toTranscribe) {
          const clip = mainClips[i];
          try {
            // The whole source file, untrimmed, so later trim changes still
            // have words to show.
            const audioPath = path.join(workdir, `speech_${i}.m4a`);
            await run(ffmpegPath, [
              "-y", "-i", sources[i],
              "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k",
              audioPath,
            ]);
            const transcript = await transcribe(audioPath);
            if (!transcript) continue;
            sourceWords.set(sourceKey(clip), transcript.words);
            if (clip.storage_path) {
              newTranscripts.push({
                storage_path: clip.storage_path,
                provider: transcript.provider,
                model: transcript.model,
                language: transcript.language,
                words: transcript.words,
              });
            }
          } catch (e) {
            console.error(
              `[Worker] Transcription failed for job=${job.job_id} clip=${clip.id}:`,
              e?.message || e,
            );
            transcriptErrors.push(`${clip.filename || clip.id}: ${String(e?.message ?? e)}`);
          }
        }
        // Report right away so the transcripts are kept even if the render
        // fails later on.
        if (newTranscripts.length) {
          await callback(job.callback_url, {
            job_id: job.job_id, status: "rendering", progress: 74,
            stage_message: "Transcripts saved",
            transcripts: newTranscripts,
          });
        }
      } else if (toTranscribe.length) {
        console.warn(`[Worker] ELEVENLABS_API_KEY not set; ${toTranscribe.length} file(s) not transcribed`);
      }

      // Place each main clip's words at its position in the final video,
      // using the real length of its normalized (trimmed) file.
      const segments = [];
      for (let i = 0; i < mainClips.length; i++) {
        const durationMs = mainDurationsMs[i];
        if (durationMs == null) {
          transcriptErrors.push(`Could not read the length of clip ${i + 1}; captions stop there`);
          break;
        }
        segments.push({
          clipId: mainClips[i].id,
          words: sourceWords.get(sourceKey(mainClips[i])) ?? [],
          trimInMs: Math.max(0, Math.round(Number(mainClips[i].trim_in_ms ?? 0))),
          durationMs,
          offsetMs: mainStartsMs[i],
        });
      }
      placedWords = placeWordsOnTimeline(segments);
      if (wantCaptions) captionWords = placedWords;

      editPlan = {
        ...(plan ?? {}),
        transcript: { words: captionWords },
        ...(transcriptErrors.length
          ? { transcript_error: transcriptErrors.join("; ").slice(0, 500) }
          : {}),
      };
    }

    // 4b. Overlay the B-roll, each clip at its own time on its track (placed,
    //     or right after the one before). It's silent over the main track;
    //     past the main track's end (the padded tail) its own sound plays.
    let composedOut = concatOut;
    if (brollClips.length) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 75,
        stage_message: "Overlaying B-roll",
      });
      const inputs = ["-i", concatOut];
      const graph = [];
      let last = "0:v";
      brollFiles.forEach((file, i) => {
        inputs.push("-i", file);
        const startS = (brollStartsMs[i] / 1000).toFixed(3);
        const endS = ((brollStartsMs[i] + brollLengthsMs[i]) / 1000).toFixed(3);
        // A moved, resized or rotated clip was kept to its box: turn it and
        // put its centre where it belongs. Others fill the frame.
        const t = clipTransform(brollClips[i]);
        const turn = t?.rotation ? `,${rotateFilter(t.rotation)}` : "";
        graph.push(`[${i + 1}:v]setpts=PTS-STARTPTS+${startS}/TB${turn}[b${i}]`);
        const at = t
          ? `x='${(w / 2 + t.x * w).toFixed(2)}-w/2':y='${(h / 2 + t.y * h).toFixed(2)}-h/2':`
          : "";
        graph.push(
          `[${last}][b${i}]overlay=${at}eof_action=pass:enable='between(t,${startS},${endS})'[v${i}]`,
        );
        last = `v${i}`;
      });
      // The B-roll's sound after the main track ends, at its place in time.
      const tails = [];
      brollFiles.forEach((_file, i) => {
        const startMs = brollStartsMs[i];
        if (startMs + brollLengthsMs[i] <= mainEndMs + 1) return;
        const fromMs = Math.max(0, mainEndMs - startMs);
        const atMs = Math.round(startMs + fromMs);
        graph.push(
          `[${i + 1}:a]atrim=start=${(fromMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,adelay=${atMs}|${atMs}[ta${i}]`,
        );
        tails.push(`[ta${i}]`);
      });
      if (tails.length) {
        graph.push(
          `[0:a]${tails.join("")}amix=inputs=${tails.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`,
        );
      }
      const overlayOut = path.join(workdir, "overlay.mp4");
      await run(ffmpegPath, [
        "-y", ...inputs,
        "-filter_complex", graph.join(";"),
        "-map", `[${last}]`,
        ...(tails.length ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "160k"] : ["-map", "0:a?", "-c:a", "copy"]),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        overlayOut,
      ]);
      composedOut = overlayOut;
    }

    // 4c. The sound (best-effort): the voice cleaned and levelled, music
    //     (skipped when the user turned Music off) looped under the whole
    //     video and ducked while the voice speaks, an SFX at each cut
    //     between main clips, voiceovers either way, then mastered to the
    //     platforms' loudness. See audio.js.
    const musicOn = job.music?.enabled !== false;
    const musicClips = musicOn
      ? job.clips.filter((c) => c.download_url && c.role === "music")
      : [];
    const sfxClips = musicOn ? job.clips.filter((c) => c.download_url && c.role === "sfx") : [];
    const voClips = (Array.isArray(job.voiceovers) ? job.voiceovers : []).filter(
      (c) => c && isAbsoluteHttpUrl(c.download_url),
    );
    // Motion Explainer graphics on the final video (from their words), for
    // their sounds and music here and their drawing in 4d.
    const placedMotion = motionJob ? placeGraphics(motionJob.elements, placedWords) : null;
    const graphicsSounds = !!placedMotion && motionJob.sound?.enabled !== false;
    const builtInMusic = !!placedMotion && musicOn && musicClips.length === 0;
    const composedProbe = await probeMedia(composedOut);
    if (
      composedProbe.hasAudio ||
      musicClips.length || sfxClips.length || voClips.length || graphicsSounds || builtInMusic
    ) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 80,
        stage_message: "Mixing and mastering the sound",
      });
      try {
        const fetchAudio = async (clips, prefix) => {
          const paths = [];
          for (let i = 0; i < clips.length; i++) {
            const ext = path.extname(clips[i].filename || "").slice(0, 6) || ".bin";
            const dest = path.join(workdir, `${prefix}_${i}${ext}`);
            await download(clips[i].download_url, dest);
            paths.push(dest);
          }
          return paths;
        };
        const musicPaths = await fetchAudio(musicClips, "music");
        const sfxPaths = await fetchAudio(sfxClips, "sfx");
        const voPaths = await fetchAudio(voClips, "vo");

        const video = await probeMedia(composedOut);
        if (video.durationMs == null) throw new Error("could not read the video length");

        // Music: untouched projects keep the songs one after another from
        // 0:00, looped to the end. Once any song is placed, each one starts
        // at its time and loops until the next song (or the end).
        let musicPlan = { mode: "sequence", paths: musicPaths };
        if (musicClips.some((c) => c.start_ms != null)) {
          const lengths = [];
          for (const p of musicPaths) lengths.push((await probeDurationMs(p)) ?? 0);
          const starts = musicStartsMs(musicClips, lengths);
          const segments = [];
          starts.forEach((startMs, i) => {
            const endMs = Math.min(video.durationMs, starts[i + 1] ?? video.durationMs);
            if (endMs - startMs >= 100) segments.push({ path: musicPaths[i], startMs, endMs });
          });
          musicPlan = { mode: "segments", segments };
        }
        // With Motion Explainer graphics, the music changes at each chapter:
        // the built-in beds when no song was added, or the added songs in
        // turn (when there are two or more and none was placed by hand).
        if (placedMotion && musicOn) {
          const chapters = placedMotion.graphics.some((g) => g.type === "chapter");
          const stretchesOf = (pick) =>
            chapterStretches(placedMotion.graphics, video.durationMs, pick)
              .filter((st) => st.endMs - st.startMs >= 100)
              .map((st) => ({ path: st.what, startMs: st.startMs, endMs: st.endMs }));
          if (!musicClips.length) {
            musicPlan = {
              mode: "segments",
              segments: stretchesOf((i) => path.join(SOUNDS_DIR, `${MUSIC_BEDS[i % MUSIC_BEDS.length]}.m4a`)),
            };
          } else if (chapters && musicPaths.length >= 2 && !musicClips.some((c) => c.start_ms != null)) {
            musicPlan = { mode: "segments", segments: stretchesOf((i) => musicPaths[i % musicPaths.length]) };
          }
        }
        // No graphics and no song (the automatic edit's captions-only
        // fallback asks for this): a built-in bed under the whole video.
        if (!placedMotion && musicOn && !musicClips.length && job.music?.bed === true) {
          musicPlan = {
            mode: "segments",
            segments: [{ path: path.join(SOUNDS_DIR, `${MUSIC_BEDS[0]}.m4a`), startMs: 0, endMs: video.durationMs }],
          };
        }

        // SFX: one with no start plays on every cut (where each main clip
        // after the first starts), taking turns with the others; a placed
        // one plays once at its time.
        const autoSfx = sfxPaths.filter((_, i) => sfxClips[i].start_ms == null);
        const sfxEvents = [];
        if (autoSfx.length) {
          mainStartsMs.slice(1).forEach((cutMs, k) => {
            sfxEvents.push({ path: autoSfx[k % autoSfx.length], atMs: cutMs - SFX_LEAD_MS });
          });
        }
        sfxClips.forEach((c, i) => {
          if (c.start_ms != null) sfxEvents.push({ path: sfxPaths[i], atMs: Number(c.start_ms) });
        });
        // The graphics' sounds, mixed into one track first (best-effort).
        if (graphicsSounds) {
          try {
            const events = soundEvents(placedMotion.graphics, placedMotion.zooms, motionJob.sound, motionJob.look).map(
              (e) => ({ ...e, gain: soundGain(e.kind, motionJob.sound) }),
            );
            const trackPath = path.join(workdir, "graphics-sounds.wav");
            const runs = sfxTrackArgs(events, video.durationMs, trackPath);
            if (runs) {
              for (const args of runs) await run(ffmpegPath, args);
              sfxEvents.push({ path: trackPath, atMs: 0, gain: 1 });
            }
          } catch (e) {
            console.warn(`[Worker] Graphics sounds failed for job=${job.job_id}:`, e?.message || e);
            editPlan = { ...(editPlan ?? {}), sounds_error: String(e?.message ?? e).slice(0, 300) };
          }
        }

        // Measure, so each part is set by its real loudness: the voice
        // (through the cleanup it gets), each voiceover, each song, and the
        // user's own SFX (the graphics' sounds are calibrated in motion.js).
        const measure = (file, opts) =>
          measureLoudness(ffmpegPath, file, opts).catch((e) => {
            console.warn(`[Worker] Measuring ${path.basename(file)} failed:`, e?.message || e);
            return null;
          });
        // A voice is listened to first (noise, hum, clicks, clipping: its
        // cleanup, noise.js), then set in two measurements through that
        // cleanup: its level into the compressor, then a trim for what the
        // compressor took off. One cleanup for the whole track, so the
        // background stays the same across every cut.
        const levelVoice = async (file, given = null) => {
          const { filters: cleanup, report } = given ?? (await cleanupOf(file));
          const before = await measure(file, { filters: voiceMeasure(cleanup) });
          const gainDb = voiceGainDb(before?.i);
          const after = before
            ? await measure(file, { filters: voiceChainMeasure(gainDb, cleanup) })
            : null;
          return { lufs: before?.i ?? null, gainDb, trimDb: voiceTrimDb(after?.i), cleanup, report };
        };
        // The main track was cleaned clip by clip (each recording its own way).
        const voiceLevel = video.hasAudio
          ? await levelVoice(composedOut, { filters: "anull", report: null })
          : null;
        const musicGains = new Map();
        const musicFiles = musicPlan.mode === "sequence"
          ? musicPlan.paths
          : musicPlan.segments.map((sg) => sg.path);
        for (const p of new Set(musicFiles)) {
          musicGains.set(p, musicGainDb((await measure(p))?.i, job.music?.volume));
        }
        const sfxGain = new Map();
        for (const p of new Set(sfxPaths)) {
          sfxGain.set(p, sfxGainDb((await measure(p, { momentary: true }))?.momentaryMax));
        }
        const voiceovers = [];
        for (let i = 0; i < voClips.length; i++) {
          const c = voClips[i];
          const atMs = Number(c.start_ms ?? 0);
          if (!Number.isFinite(atMs) || atMs >= video.durationMs) continue;
          const level = await levelVoice(voPaths[i]);
          voiceovers.push({
            path: voPaths[i],
            atMs,
            inMs: Number(c.trim_in_ms ?? 0),
            outMs: c.trim_out_ms != null ? Number(c.trim_out_ms) : null,
            gainDb: level.gainDb,
            trimDb: level.trimDb,
            cleanup: level.cleanup,
          });
        }

        let mixPath = path.join(workdir, "mix.wav");
        await run(
          ffmpegPath,
          buildAudioMixArgs({
            videoPath: composedOut,
            hasVoice: video.hasAudio,
            durationMs: video.durationMs,
            musicPlan,
            sfxEvents: sfxEvents
              .filter((e) => e.atMs < video.durationMs)
              .map((e) => (sfxGain.has(e.path) ? { ...e, gainDb: sfxGain.get(e.path) } : e)),
            voiceovers,
            voiceGain: voiceLevel?.gainDb ?? 0,
            voiceTrim: voiceLevel?.trimDb ?? 0,
            voiceClean: voiceLevel?.cleanup,
            musicGains,
            out: mixPath,
          }),
        );
        // Mastered in loudnorm's second pass from the mix's measurement
        // (linear gain, so no pumping), under the video: peak-limited first
        // when the gain would push its peaks past the ceiling.
        let mixLevel = await measure(mixPath);
        const limit = limitFor(mixLevel);
        if (limit) {
          const limitedPath = path.join(workdir, "mix-limited.wav");
          await run(ffmpegPath, limiterArgs(mixPath, limit, limitedPath));
          mixPath = limitedPath;
          mixLevel = await measure(mixPath);
        }
        const mixedOut = path.join(workdir, "mixed.mp4");
        await run(
          ffmpegPath,
          masterArgs({
            videoPath: composedOut,
            mixPath,
            measured: mixLevel,
            durationMs: video.durationMs,
            out: mixedOut,
          }),
        );
        composedOut = mixedOut;
        editPlan = {
          ...(editPlan ?? {}),
          sound: {
            voice_lufs: voiceLevel?.lufs ?? null,
            mix_lufs: mixLevel?.i ?? null,
            // What each recording's cleanup found and did (noise.js voiceCleanup).
            noise_removal: noise,
            cleanup: [...cleanups.values()].map((c) => c.report).filter(Boolean),
          },
        };
      } catch (e) {
        console.warn(`[Worker] Music mix failed for job=${job.job_id}:`, e?.message || e);
        editPlan = { ...(editPlan ?? {}), music_error: String(e?.message ?? e).slice(0, 300) };
      }
    }

    // 4d. Motion Explainer graphics (best-effort: a problem keeps the video
    //     without them). Drawn with Remotion where they're on screen, then
    //     laid over the picture with the zooms in the text encode below.
    let graphicPieces = [];
    let zoom = null;
    // The look's finish: its colour grade, camera pace and captions.
    const finish = lookFinish(motionJob?.look);
    // The picture's colour: every video is measured and corrected (exposure,
    // contrast, colour cast; see colour.js), then the look's grade goes on
    // top. Best-effort: a failed measurement leaves the footage as filmed.
    let correction = null;
    let colourStats = null;
    try {
      // (exposed for the speaker's skin: their face's place, when the plan has
      // it). Measured on the main track's videos (trimmed, fitted, HDR made
      // normal), as the editor's preview measures them (/grade-table), so
      // both grade with the same numbers; the whole video when there are none.
      const mainVideos = normalized.slice(0, mainClips.length).filter((_, k) => !isImageClip(mainClips[k]));
      colourStats = await analyzeColour(ffmpegPath, mainVideos.length ? mainVideos : composedOut, {
        center: motionJob?.angles?.center ?? null,
      });
      correction = correctionFilter(colourStats);
    } catch (e) {
      console.warn(`[Worker] Colour analysis failed for job=${job.job_id}:`, e?.message || e);
    }
    // The colour: a ready-made LUT picked for the video (by the AI or by
    // hand, at its strength), else the look's own LUT (luts.js), else the
    // look's simple grade.
    const pick = motionJob?.lut;
    // A ready-made LUT goes on only as strongly as the speaker's skin allows
    // (tried on the video's own skin colours: luts.js packSkinSafeStrength).
    let pickStrength = pick ? (pick.strength ?? 1) : 0;
    if (pick) {
      const safe = packSkinSafeStrength(pick.id, pickStrength, correctedSkin(colourStats));
      if (safe < pickStrength) {
        console.log(`[Worker] LUT ${pick.id} at ${safe} instead of ${pickStrength} for job=${job.job_id}: kinder to skin`);
        editPlan = { ...(editPlan ?? {}), lut_note: safe ? `${pick.id} lowered to ${safe} to keep skin natural` : `${pick.id} left out: it harmed skin` };
      }
      pickStrength = safe;
    }
    const lookGrade = motionJob
      ? ((pick && pickStrength > 0 ? packLutFilter(pick.id, pickStrength) : null) ??
        lutFilter(motionJob.look) ??
        gradeFilter(finish))
      : null;
    const grade = [correction, lookGrade].filter(Boolean).join(",") || null;
    const filmFinish = motionJob ? finishFilters(finish, w, h) : [];
    // A saved preview cut-out (the editor asked for it: pixelcut.js
    // pixelcutCutout) holding stretch [a, b) of the picture: when it lies in
    // one main video clip shown as filmed (not moved or resized, the frame's
    // own shape) with no B-roll over it. {url, skip, cover} or null.
    const savedCutoutFor = ([a, b]) => {
      const fromMs = (a / MOTION_FPS) * 1000;
      const toMs = (b / MOTION_FPS) * 1000;
      const i = mainClips.findIndex(
        (c, k) => mainDurationsMs[k] != null && mainStartsMs[k] <= fromMs + 1 && toMs <= mainStartsMs[k] + mainDurationsMs[k] + 1,
      );
      const clip = mainClips[i];
      if (!clip || !Array.isArray(clip.cutouts) || !clip.cutouts.length) return null;
      if (isImageClip(clip) || clipTransform(clip)) return null;
      const probe = probes[i];
      if (!probe?.width || !probe?.height || Math.abs(Math.log(probe.width / probe.height / (w / h))) >= 0.03) return null;
      if (brollStartsMs.some((s0, k) => s0 < toMs && s0 + brollLengthsMs[k] > fromMs)) return null;
      const trimIn = Math.max(0, Number(clip.trim_in_ms ?? 0));
      const srcFrom = trimIn + fromMs - mainStartsMs[i];
      const srcTo = trimIn + toMs - mainStartsMs[i];
      const c = clip.cutouts.find(
        (x) => isAbsoluteHttpUrl(x?.url) && Number(x.from_ms) <= srcFrom + 1 && Number(x.to_ms) >= srcTo - 34,
      );
      if (!c) return null;
      return {
        url: c.url,
        skip: Math.max(0, Math.round(((srcFrom - Number(c.from_ms)) / 1000) * 30)),
        cover: coverFilter(w, h),
      };
    };
    // Notes pages: when the speaker moves aside for them.
    let split = null;
    // Graphics behind the speaker: their clips and the speaker's masks
    // (none: they're drawn in front with the others).
    let behind = null;
    if (motionJob) {
      try {
        const placed = placedMotion;
        const totalMs = await probeDurationMs(composedOut);
        const totalFrames = Math.ceil(((totalMs ?? 0) / 1000) * MOTION_FPS);
        // Camera angles: on unless the plan turns them off.
        const anglesOn = motionJob.angles?.enabled !== false;
        zoom = zoomFilter(placed.zooms, w, h, {
          shots: anglesOn
            ? closeShots(placedWords, angleBlocked(placed.zooms, placed.graphics), finish.pace)
            : [],
          center: motionJob.angles?.center ?? null,
          closeScale: finish.angleClose,
          move: finish.angleMove,
        });
        const ranges = splitRanges(placed.graphics);
        split = ranges.length ? { ranges, portrait: h > w } : null;
        // Behind the speaker only when the cut-out model is in the image.
        const cutout = personModelReady();
        const front = placed.graphics.filter((g) => !(cutout && g.behind));
        const back = placed.graphics.filter((g) => cutout && g.behind);
        if (totalFrames > 0 && placed.graphics.length) {
          await callback(job.callback_url, {
            job_id: job.job_id, status: "rendering", progress: 80,
            stage_message: "Drawing graphics",
          });
          // Animated story clips, converted once so drawing them is quick.
          const story = await prepareStoryClips(storyImages(motionJob.images), {
            ffmpegPath, jobId: job.job_id, w, h, workdir, download, run,
            elements: motionJob.elements,
          });
          try {
          let lastPct = -1;
          const draw = (graphics, name, from, share) =>
            renderGraphics({
              graphics,
              theme: motionJob.theme,
              images: story.images,
              // A card stream ends on the brand kit's logo.
              logo: brandKitFromJob(job).logo?.url ?? null,
              look: motionJob.look,
              w,
              h,
              totalFrames,
              workdir,
              name,
              onProgress: (part) => {
                const pct = Math.round((from + part * share) * 100);
                if (pct >= lastPct + 20) {
                  lastPct = pct;
                  void callback(job.callback_url, {
                    job_id: job.job_id, status: "rendering", progress: 80 + Math.round(pct / 25),
                    stage_message: `Drawing graphics (${pct}%)`,
                  });
                }
              },
            });
          const share = back.length ? front.length / placed.graphics.length : 1;
          graphicPieces = await draw(front, "graphics", 0, share);
          if (back.length) {
            const backPieces = await draw(back, "behind", share, 1 - share);
            try {
              await callback(job.callback_url, {
                job_id: job.job_id, status: "rendering", progress: 84,
                stage_message: "Cutting you out for the graphics behind you",
              });
              const masks = await personMasks({
                ffmpegPath,
                input: composedOut,
                zoom,
                ranges: behindRanges(back),
                workdir,
                saved: savedCutoutFor,
                // The frame's shape, for the mask's squares (cutout.js maskTiles).
                w,
                h,
              });
              behind = masks.length ? { pieces: backPieces, masks, w, h } : null;
              if (!behind) graphicPieces = [...graphicPieces, ...backPieces];
            } catch (e) {
              // Without the cut-out: those graphics go in front.
              console.warn(`[Worker] Cut-out failed for job=${job.job_id}:`, e?.message || e);
              editPlan = { ...(editPlan ?? {}), cutout_error: String(e?.message ?? e).slice(0, 300) };
              graphicPieces = [...graphicPieces, ...backPieces];
            }
          }
          } finally {
            await story.cleanup();
          }
        }
        // Captions step aside while a key line or chapter fills their space.
        if ((graphicPieces.length || behind) && captionWords.length) {
          const gaps = captionGaps(placed.graphics);
          captionWords = captionWords.filter(
            (wd) => !gaps.some(([a, b]) => wd.start_ms >= a && wd.start_ms < b),
          );
        }
      } catch (e) {
        console.warn(`[Worker] Graphics failed for job=${job.job_id}:`, e?.message || e);
        graphicPieces = [];
        behind = null;
        zoom = null;
        editPlan = { ...(editPlan ?? {}), graphics_error: String(e?.message ?? e).slice(0, 300) };
      }
    }

    // 5. Burn in text: word-by-word captions in the lower third and the AI
    //    hook at the top for the first 3 seconds, in a single encode (with
    //    the graphics and zooms, when there are some).
    let finalOut = composedOut;
    // The brand kit's font when it picked one (bundled in ./fonts), else the system's.
    const kit = brandKitFromJob(job);
    const brandFont = brandFontFile(kit);
    const font = brandFont ?? findSystemFont();
    if (!font && (hook || captionWords.length)) {
      console.warn(`[Worker] No system font found; skipping captions and hook for job=${job.job_id}`);
    }
    let captionsFilter = null;
    if (font && captionWords.length) {
      const ass = buildCaptionsAss(captionWords, {
        w,
        h,
        fontName: brandFont ? BRAND_FONTS[kit.font].family : fontFamily(font),
        kit,
        bold: brandFont ? BRAND_FONTS[kit.font].bold : true,
        clean: finish.captions === "clean",
      });
      if (ass) {
        const assPath = path.join(workdir, "captions.ass");
        await fsp.writeFile(assPath, ass, "utf8");
        captionsFilter =
          `ass=filename=${filterPath(assPath)}:fontsdir=${filterPath(path.dirname(font))}`;
      }
    }
    let hookFilter = null;
    if (font && hook) {
      const fontSize = Math.round(h * 0.055);
      const rgb = (hex) => `0x${hex.slice(1)}`;
      hookFilter =
        `drawtext=fontfile=${filterPath(font)}:text='${escapeDrawtext(hook)}':` +
        `fontcolor=${rgb(kit.textColor)}:fontsize=${fontSize}:box=1:boxcolor=${rgb(kit.hookBoxColor)}@0.55:boxborderw=24:` +
        `x=(w-text_w)/2:y=h*0.08:enable='lt(t,3)'`;
    }

    const burnText = async (filters, name) => {
      const out = path.join(workdir, name);
      await run(ffmpegPath, [
        "-y", "-i", composedOut,
        "-vf", filters.join(","),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart",
        out,
      ]);
      return out;
    };

    const textFilters = [captionsFilter, hookFilter].filter(Boolean);
    let graphicsDone = false;
    if (graphicPieces.length || behind || zoom || split || grade || filmFinish.length) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 85,
        stage_message: "Adding graphics and captions",
      });
      const out = path.join(workdir, "final-graphics.mp4");
      // ffmpeg's "time=" lines say how far it got, so the page shows this
      // pass moving (it's the longest one on a small server).
      const lengthMs = (await probeDurationMs(composedOut)) ?? 0;
      let lastStep = -1;
      const onProgress = (text) => {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
        if (!m || lengthMs <= 0) return;
        const ms = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000;
        const pct = Math.min(99, Math.floor((ms / lengthMs) * 100));
        const step = Math.floor(pct / 10);
        if (step <= lastStep) return;
        lastStep = step;
        void callback(job.callback_url, {
          job_id: job.job_id, status: "rendering", progress: 85 + Math.floor(pct / 10),
          stage_message: `Adding graphics and captions (${pct}%)`,
        });
      };
      const compose = (pieces, withBehind) => {
        lastStep = -1;
        return run(
          ffmpegPath,
          composeArgs({ input: composedOut, pieces, zoom, textFilters, output: out, behind: withBehind, split, grade, finish: filmFinish }),
          { onProgress },
        );
      };
      try {
        try {
          await compose(graphicPieces, behind);
        } catch (e) {
          if (!behind) throw e;
          // Again without the cut-out: the behind graphics go in front.
          console.warn(`[Worker] Cut-out compose failed for job=${job.job_id}:`, e?.message || e);
          editPlan = { ...(editPlan ?? {}), cutout_error: String(e?.message ?? e).slice(0, 300) };
          await compose([...graphicPieces, ...behind.pieces], null);
        }
        finalOut = out;
        graphicsDone = true;
      } catch (e) {
        // Without the graphics: the captions and hook still go on below.
        console.warn(`[Worker] Adding graphics failed for job=${job.job_id}:`, e?.message || e);
        editPlan = { ...(editPlan ?? {}), graphics_error: String(e?.message ?? e).slice(0, 300) };
      }
    }

    if (!graphicsDone && (captionsFilter || hookFilter)) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 85,
        stage_message: captionsFilter ? "Adding captions" : "Adding hook caption",
      });
      try {
        finalOut = await burnText([captionsFilter, hookFilter].filter(Boolean), "final.mp4");
      } catch (e) {
        console.warn(`[Worker] Burning text failed for job=${job.job_id}:`, e?.message || e);
        // A captions problem shouldn't also cost the hook: retry with the hook alone.
        if (captionsFilter && hookFilter) {
          try {
            finalOut = await burnText([hookFilter], "final-hook.mp4");
          } catch (e2) {
            console.warn(`[Worker] Hook-only burn failed for job=${job.job_id}:`, e2?.message || e2);
          }
        }
        if (captionsFilter) {
          editPlan = {
            ...(editPlan ?? {}),
            captions_error: String(e?.message ?? e).slice(0, 300),
          };
        }
      }
    }

    // 5b. The brand logo in its corner and, on free plans, the watermark
    // (best-effort: a problem keeps the video without them).
    {
      const marks = [];
      if (kit.logo) {
        try {
          const logoPath = path.join(workdir, "logo.png");
          await download(kit.logo.url, logoPath);
          marks.push(logoMark(kit, logoPath, w, h));
        } catch (e) {
          console.warn(`[Worker] Logo download failed for job=${job.job_id}:`, e?.message || e);
          editPlan = { ...(editPlan ?? {}), logo_error: String(e?.message ?? e).slice(0, 300) };
        }
      }
      if (job.watermark === true) marks.push(watermarkMark(kit, w, h));
      if (marks.length) {
        try {
          finalOut = await overlayMarks(finalOut, marks, path.join(workdir, "final-marks.mp4"));
        } catch (e) {
          console.warn(`[Worker] Logo/watermark overlay failed for job=${job.job_id}:`, e?.message || e);
          editPlan = { ...(editPlan ?? {}), logo_error: String(e?.message ?? e).slice(0, 300) };
        }
      }
    }

    // 6. Upload via signed URL
    await callback(job.callback_url, {
      job_id: job.job_id, status: "rendering", progress: 92,
      stage_message: "Uploading final video",
    });
    const buf = await fsp.readFile(finalOut);
    const up = await fetch(job.output.upload_url, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text().catch(() => "")}`);

    // 7. A small copy for playing it in the app (src/lib/render-preview.ts):
    //    the export is ~8 Mbit/s, more than a slow connection can play
    //    without stopping. Best-effort: without it the app plays the export.
    if (isAbsoluteHttpUrl(job.output.preview_upload_url)) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 96,
        stage_message: "Making a quick-play copy",
      });
      try {
        const started = Date.now();
        const copy = path.join(workdir, "play.mp4");
        await run(ffmpegPath, [
          "-y", "-hide_banner", "-loglevel", "error", "-i", finalOut,
          "-map", "0:v:0", "-map", "0:a:0?",
          "-vf", `scale=w='if(gt(iw,ih),-2,min(${PREVIEW_SHORT},iw))':h='if(gt(iw,ih),min(${PREVIEW_SHORT},ih),-2)'`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
          "-maxrate", "1800k", "-bufsize", "3600k",
          "-pix_fmt", "yuv420p", "-g", "30",
          "-c:a", "aac", "-b:a", "96k", "-ac", "2",
          "-movflags", "+faststart",
          copy,
        ]);
        const small = await fsp.readFile(copy);
        const upCopy = await fetch(job.output.preview_upload_url, {
          method: "PUT",
          headers: { "content-type": "video/mp4", "x-upsert": "true" },
          body: small,
        });
        if (!upCopy.ok) throw new Error(`upload ${upCopy.status}`);
        console.log(
          `[Worker] Play copy for job=${job.job_id}: ${(buf.length / 1e6).toFixed(1)} MB -> ${(small.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`,
        );
      } catch (e) {
        console.warn(`[Worker] Play copy failed for job=${job.job_id}:`, e?.message || e);
      }
    }

    await callback(job.callback_url, {
      job_id: job.job_id, status: "completed", progress: 100,
      stage_message: "Done",
      output_path: job.output.path,
      edit_plan: editPlan,
    });
  } finally {
    await cleanup();
  }
}

const port = Number(process.env.PORT) || 3000;
const host = "0.0.0.0";
app.listen(port, host, () => {
  console.log(`[Worker] Listening on ${host}:${port}`);
});
