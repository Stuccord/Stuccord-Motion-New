// Stuccord Motion — render worker
//
// Deploy on Render.com as a Web Service:
//   Build Command:  npm install
//   Start Command:  npm start
//
// Env vars:
//   RENDER_WORKER_SECRET   shared HMAC secret (matches the Lovable app)
//   LOVABLE_API_KEY        optional — enables AI edit-plan generation
//   ELEVENLABS_API_KEY     optional — enables speech-to-text (Scribe v2) for captions
//
// The worker receives signed download/upload URLs from the app, so it does
// NOT need any Supabase service keys. It uses ffmpeg to normalize each
// source clip to the target aspect ratio (1080p, H.264 + AAC, 30fps),
// concatenates the A-roll into the main track and overlays the B-roll on top
// of it from 0:00 (matching the editor timeline). When an AI edit plan
// produces a "hook" line, that hook is burned into the first ~3 seconds.

import express from "express";
import crypto from "crypto";
import { spawn, execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";

const app = express();
app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

const SECRET = process.env.RENDER_WORKER_SECRET;
if (!SECRET) console.warn("[Worker] RENDER_WORKER_SECRET not set — /jobs will reject all requests");
if (!ffmpegPath) console.warn("[Worker] ffmpeg-static failed to resolve a binary path");

let currentJobId = null;

function verifySignature(req) {
  const sig = req.header("x-stuccord-signature") || "";
  const expected = crypto.createHmac("sha256", SECRET || "").update(req.rawBody || Buffer.alloc(0)).digest("hex");
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

async function callback(url, payload) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", SECRET || "").update(body).digest("hex");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-stuccord-signature": signature },
      body,
    });
    if (!res.ok) console.error("[Worker] Callback failed with status", res.status);
  } catch (e) {
    console.error("[Worker] Callback network error", e?.message || e);
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

  (async () => {
    try {
      await runRender(job);
    } catch (err) {
      console.error(`[Worker] Render failed for job=${job.job_id}:`, err?.message || err);
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
      currentJobId = null;
    }
  })();
});

// ---------- helpers ----------

function run(cmd, args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
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

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download failed: ${r.status}`);
  await fsp.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

function aspectDims(ratio) {
  if (ratio === "16:9") return { w: 1920, h: 1080 };
  if (ratio === "1:1") return { w: 1080, h: 1080 };
  return { w: 1080, h: 1920 }; // 9:16 default
}

// Build a scale+crop filter that "covers" the target box (no letterboxing)
function coverFilter(w, h) {
  return `scale=w=${w}:h=${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30`;
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ");
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

// Duration of a media file in ms, read from the "Duration:" line ffmpeg
// prints when given an input and no output. Returns null if unreadable.
function probeDurationMs(file) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) : null);
    });
  });
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
  for (const { words, trimInMs, durationMs, offsetMs } of segments) {
    const windowEnd = trimInMs + durationMs;
    for (const w of words) {
      if (w.start_ms < trimInMs || w.start_ms >= windowEnd) continue;
      placed.push({
        text: w.text,
        start_ms: offsetMs + (w.start_ms - trimInMs),
        end_ms: offsetMs + (Math.min(w.end_ms, windowEnd) - trimInMs),
      });
    }
  }
  return placed;
}

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
function buildCaptionsAss(words, { w, h, fontName }) {
  const groups = groupCaptionWords(words);
  if (!groups.length) return null;

  const fontSize = Math.round(Math.min(w, h) * 0.075);
  const outline = Math.max(2, Math.round(fontSize * 0.08));
  const marginX = Math.round(w * 0.08);
  const marginV = Math.round(h * 0.2);
  // Colours are &HAABBGGRR. Yellow #FFD700 is &H0000D7FF.
  const WHITE = "&H00FFFFFF";
  const HIGHLIGHT = "&H0000D7FF";

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
    `Style: Caption,${fontName},${fontSize},${WHITE},${WHITE},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,${marginX},${marginX},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

// Quotes a file path for use inside an ffmpeg filter argument. Everything
// inside single quotes is literal; a quote in the path closes, escapes and
// reopens the quoting.
function filterPath(p) {
  return `'${String(p).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

// ---------- AI edit plan ----------

async function generateEditPlan(job) {
  if (!process.env.LOVABLE_API_KEY) return null;
  const sys = `You are an expert short-form video editor in the style of Iman Gadzhi.
Return a compact JSON edit plan with fields:
  hook   — a punchy 3-7 word on-screen caption for the first 3 seconds
  cuts   — array of {clip_id, in, out, role}
  captions — array of {t, text, style}
  broll_cues — array of {t, note}
  music_vibe — string
Return ONLY JSON, no prose.`;
  const user = `Style: ${job.style_preset}. Aspect: ${job.aspect_ratio}.
Title: ${job.title}
Script:\n${job.script || "(none — infer from footage)"}
Brief:\n${job.brief || "(none)"}
Clips: ${JSON.stringify(job.clips.map((c) => ({ id: c.id, role: c.role, filename: c.filename })))}`;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { raw: text };
    try { return JSON.parse(match[0]); } catch { return { raw: text }; }
  } catch (e) {
    console.error("ai plan failed", e);
    return null;
  }
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
    throw new Error(`speech-to-text failed: ${r.status} ${detail.slice(0, 200)}`);
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
      (c) => c.download_url && c.role !== "music" && c.role !== "sfx",
    );
    if (!videoClips.length) throw new Error("No downloadable clips provided");
    let mainClips = videoClips.filter((c) => c.role !== "broll");
    let brollClips = videoClips.filter((c) => c.role === "broll");
    if (!mainClips.length) {
      mainClips = brollClips;
      brollClips = [];
    }
    const clips = [...mainClips, ...brollClips];

    const sources = [];
    for (let i = 0; i < clips.length; i++) {
      const dest = path.join(workdir, `src_${i}.mp4`);
      await download(clips[i].download_url, dest);
      sources.push(dest);
    }

    // 2. AI edit plan (best-effort)
    await callback(job.callback_url, {
      job_id: job.job_id, status: "planning", progress: 30,
      stage_message: "Planning cuts, captions & hook",
    });
    const plan = await generateEditPlan(job);
    const hook = typeof plan?.hook === "string" ? plan.hook.trim() : "";

    // 3. Normalize each source to target aspect at 1080p / 30fps / H.264 + AAC.
    //    This makes the concat step lossless-safe (identical codec params).
    const { w, h } = aspectDims(job.aspect_ratio);
    const filter = coverFilter(w, h);

    await callback(job.callback_url, {
      job_id: job.job_id, status: "rendering", progress: 45,
      stage_message: `Normalizing clips to ${job.aspect_ratio}`,
      edit_plan: plan,
    });

    const normalized = [];
    for (let i = 0; i < sources.length; i++) {
      const out = path.join(workdir, `norm_${i}.mp4`);
      // Per-clip trim: -ss (in) and -to (out) as INPUT-side seek so audio stays in sync.
      const trimIn = Math.max(0, Number(clips[i].trim_in_ms ?? 0)) / 1000;
      const trimOutMs = clips[i].trim_out_ms;
      const args = ["-y"];
      if (trimIn > 0) args.push("-ss", trimIn.toFixed(3));
      if (trimOutMs != null && Number(trimOutMs) > 0) {
        args.push("-to", (Number(trimOutMs) / 1000).toFixed(3));
      }
      args.push(
        "-i", sources[i],
        "-vf", filter,
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
    const concatOut = await concatTrack(normalized.slice(0, mainClips.length), "concat");

    // 4a. Captions words (best-effort; skipped when the user turned captions
    //     off). Transcripts belong to whole source files, in source time, so
    //     each file is transcribed once and the user's corrections survive
    //     trims, splits and reorders. The app sends saved transcripts as
    //     clip.transcript_words; only main-track files without one are
    //     transcribed here, and new ones are reported back to be saved.
    const wantCaptions = job.captions !== false;
    let editPlan = plan;
    let captionWords = [];
    if (wantCaptions) {
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
      let offsetMs = 0;
      for (let i = 0; i < mainClips.length; i++) {
        const durationMs = await probeDurationMs(normalized[i]);
        if (durationMs == null) {
          transcriptErrors.push(`Could not read the length of clip ${i + 1}; captions stop there`);
          break;
        }
        segments.push({
          words: sourceWords.get(sourceKey(mainClips[i])) ?? [],
          trimInMs: Math.max(0, Math.round(Number(mainClips[i].trim_in_ms ?? 0))),
          durationMs,
          offsetMs,
        });
        offsetMs += durationMs;
      }
      captionWords = placeWordsOnTimeline(segments);

      editPlan = {
        ...(plan ?? {}),
        transcript: { words: captionWords },
        ...(transcriptErrors.length
          ? { transcript_error: transcriptErrors.join("; ").slice(0, 500) }
          : {}),
      };
    }

    // 4b. Overlay the B-roll track (video only). eof_action=pass shows the
    //     A-roll again once the B-roll runs out, and the output ends with the
    //     A-roll, so B-roll past that point is cut.
    let composedOut = concatOut;
    if (brollClips.length) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 75,
        stage_message: "Overlaying B-roll",
      });
      const brollOut = await concatTrack(normalized.slice(mainClips.length), "broll", ["-an"]);
      const overlayOut = path.join(workdir, "overlay.mp4");
      await run(ffmpegPath, [
        "-y", "-i", concatOut, "-i", brollOut,
        "-filter_complex", "[0:v][1:v]overlay=eof_action=pass[v]",
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart",
        overlayOut,
      ]);
      composedOut = overlayOut;
    }

    // 5. Burn in text: word-by-word captions in the lower third and the AI
    //    hook at the top for the first 3 seconds, in a single encode.
    let finalOut = composedOut;
    const font = findSystemFont();
    if (!font && (hook || captionWords.length)) {
      console.warn(`[Worker] No system font found; skipping captions and hook for job=${job.job_id}`);
    }
    let captionsFilter = null;
    if (font && captionWords.length) {
      const ass = buildCaptionsAss(captionWords, { w, h, fontName: fontFamily(font) });
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
      hookFilter =
        `drawtext=fontfile='${font}':text='${escapeDrawtext(hook)}':` +
        `fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.55:boxborderw=24:` +
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

    if (captionsFilter || hookFilter) {
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
