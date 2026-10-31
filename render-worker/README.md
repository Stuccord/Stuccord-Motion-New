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

The worker runs as a **Docker** service (see `render.yaml` and `Dockerfile`):
Motion Explainer graphics are drawn with Remotion's headless Chrome, which
needs Linux system libraries that a native Node service can't install.

1. Render → the worker service → Settings: Runtime **Docker**,
   Dockerfile path `./render-worker/Dockerfile`, Docker build context `.`
   (the repository root: the graphics are built from the app's `src/motion`).
   Or sync the Blueprint (`render.yaml`), which sets the same.
2. Instance type: graphics are drawn on the CPU, so more CPUs mean faster
   exports (see the timings measured in the Stage 3 notes).
3. Environment variables (Render dashboard → Environment):
   - `RENDER_WORKER_SECRET` — must match the value stored in your Lovable app.
   - `ELEVENLABS_API_KEY` *(optional)* — speech-to-text for captions and
     graphics, and AI voiceovers.
   - `LOVABLE_API_KEY` *(optional)* — the older AI hook line, for projects
     without Motion Explainer graphics.
   - `PUBLIC_APP_URL` *(optional)* — scheduled posts.

The image installs the libraries, a system font for captions, and (at build,
`node build-graphics.mjs`) bundles the graphics and downloads the headless
Chrome. `ffmpeg-static` still provides ffmpeg.

Graphics behind the speaker cut the speaker out with an AI person mask
(`cutout.js`): Google's MediaPipe selfie segmenter in `models/` (see
`models/README.md`), run by `onnxruntime-node` on the CPU only over the
frames that need it. The image skips onnxruntime's NVIDIA (CUDA) download.
Without the model file, those graphics are drawn in front instead.

## Endpoints

- `GET /health` → `{ ok: true, ffmpeg: true }`
- `POST /jobs` → accepts signed job payloads from the Lovable app
- `POST /transcribe` → transcribes clips before export (for planning graphics)

## Local test

```
cd render-worker
npm install
npm run build   # bundles the graphics, downloads headless Chrome
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
