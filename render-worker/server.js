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

    // 4a. Transcribe the main track's audio (best-effort). Word timings are
    //     relative to the start of the final video, since B-roll and the hook
    //     don't change the audio or its timing. Stored with the edit plan;
    //     captions are built from it in a later step.
    let editPlan = plan;
    if (process.env.ELEVENLABS_API_KEY) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 72,
        stage_message: "Transcribing speech",
      });
      try {
        const audioPath = path.join(workdir, "speech.m4a");
        await run(ffmpegPath, [
          "-y", "-i", concatOut,
          "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k",
          audioPath,
        ]);
        const transcript = await transcribe(audioPath);
        if (transcript) editPlan = { ...(plan ?? {}), transcript };
      } catch (e) {
        console.error(`[Worker] Transcription failed for job=${job.job_id}:`, e?.message || e);
        editPlan = { ...(plan ?? {}), transcript_error: String(e?.message ?? e).slice(0, 300) };
      }
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

    // 5. Optional: burn hook text on the first 3 seconds
    let finalOut = composedOut;
    const font = findSystemFont();
    if (hook && font) {
      await callback(job.callback_url, {
        job_id: job.job_id, status: "rendering", progress: 85,
        stage_message: "Adding hook caption",
      });
      const burnOut = path.join(workdir, "final.mp4");
      const fontSize = Math.round(h * 0.055);
      const drawtext =
        `drawtext=fontfile='${font}':text='${escapeDrawtext(hook)}':` +
        `fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.55:boxborderw=24:` +
        `x=(w-text_w)/2:y=h*0.08:enable='lt(t,3)'`;
      try {
        await run(ffmpegPath, [
          "-y", "-i", composedOut,
          "-vf", drawtext,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
          "-c:a", "copy", "-movflags", "+faststart",
          burnOut,
        ]);
        finalOut = burnOut;
      } catch (e) {
        console.warn("drawtext failed, using concat output", e);
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
