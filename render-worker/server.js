// Stuccord Motion — render worker
//
// Deploy on Render.com as a Web Service:
//   Build Command:  npm install
//   Start Command:  npm start
//
// Env vars:
//   RENDER_WORKER_SECRET   shared HMAC secret (matches the Lovable app)
//   LOVABLE_API_KEY        optional — enables AI edit-plan generation
//
// The worker receives signed download/upload URLs from the app, so it does
// NOT need any Supabase service keys. It uses ffmpeg to normalize each
// source clip to the target aspect ratio (1080p, H.264 + AAC, 30fps) and
// concatenates them into a single deliverable video. When an AI edit plan
// produces a "hook" line, that hook is burned into the first ~3 seconds.

import express from "express";
import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";

const app = express();
app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

const SECRET = process.env.RENDER_WORKER_SECRET;
if (!SECRET) console.warn("RENDER_WORKER_SECRET not set — /jobs will reject all requests");
if (!ffmpegPath) console.warn("ffmpeg-static failed to resolve a binary path");

function verifySignature(req) {
  const sig = req.header("x-stuccord-signature") || "";
  const expected = crypto.createHmac("sha256", SECRET || "").update(req.rawBody).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function callback(url, payload) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-stuccord-signature": signature },
      body,
    });
    if (!res.ok) console.error("callback failed", res.status, await res.text().catch(() => ""));
  } catch (e) {
    console.error("callback error", e);
  }
}

app.get("/", (_req, res) => res.send("Stuccord render worker up"));
app.get("/health", (_req, res) => res.json({ ok: true, ffmpeg: Boolean(ffmpegPath) }));

app.post("/jobs", async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send("bad signature");
  const job = req.body;
  res.status(202).json({ ok: true, job_id: job.job_id });
  runRender(job).catch(async (err) => {
    console.error("render failed", err);
    await callback(job.callback_url, {
      job_id: job.job_id,
      status: "failed",
      error: String(err?.message ?? err),
    });
  });
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
    const clips = job.clips.filter((c) => c.download_url);
    if (!clips.length) throw new Error("No downloadable clips provided");

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


    // 4. Concat via demuxer
    const listPath = path.join(workdir, "list.txt");
    await fsp.writeFile(
      listPath,
      normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const concatOut = path.join(workdir, "concat.mp4");
    await run(ffmpegPath, [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-movflags", "+faststart",
      concatOut,
    ]);

    // 5. Optional: burn hook text on the first 3 seconds
    let finalOut = concatOut;
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
          "-y", "-i", concatOut,
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
      edit_plan: plan,
    });
  } finally {
    await cleanup();
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("worker listening on", port));
