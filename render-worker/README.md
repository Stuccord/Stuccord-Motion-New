# Stuccord render worker

Real ffmpeg-based render pipeline for Stuccord Motion. Receives signed URLs
from the Lovable app, so it never needs Supabase service keys.

## What it does per job

1. Downloads every source clip (via the signed URLs in the job payload).
2. Asks Lovable AI for a compact edit plan (hook, cuts, caption ideas).
3. Normalizes each clip to the target aspect ratio (9:16, 16:9, or 1:1) at
   1080p, 30fps, H.264 + AAC — so concat is glitch-free.
4. Concatenates the clips.
5. Burns the AI-generated hook caption over the first 3 seconds.
6. Uploads the finished MP4 back through the signed upload URL.

## Deploy on Render.com

1. Push this folder to GitHub (or use the existing repo).
2. Render → **New → Web Service** → connect the repo.
3. Root directory: `render-worker`
4. Runtime: **Node**
5. Build Command: `npm install`
6. Start Command: `npm start`
7. Instance type: at least **Starter** (ffmpeg is CPU-heavy; the free tier
   will time out on longer clips).
8. Environment variables (Render dashboard → Environment):
   - `RENDER_WORKER_SECRET` — must match the value stored in your Lovable app.
   - `LOVABLE_API_KEY` *(optional but recommended)* — enables the AI hook /
     edit plan. Without it the worker still renders, just without the hook
     overlay.

The `ffmpeg-static` npm dependency bundles a working ffmpeg binary, so
Render's Node image needs no extra system packages.

## Endpoints

- `GET /health` → `{ ok: true, ffmpeg: true }`
- `POST /jobs` → accepts signed job payloads from the Lovable app

## Local test

```
cd render-worker
npm install
RENDER_WORKER_SECRET=dev npm start
```

Then hit `http://localhost:3000/health`.

## Extending

`runRender` in `server.js` is the whole pipeline. Natural next steps:

- Auto-captions via Whisper (Lovable AI Gateway STT) → SRT → `subtitles=` filter.
- Background music mix using `amix` + sidechain ducking.
- B-roll insertion driven by `plan.broll_cues`.
- Per-clip trim/reorder using `plan.cuts` (currently the worker uses the
  order the user uploaded them in).
