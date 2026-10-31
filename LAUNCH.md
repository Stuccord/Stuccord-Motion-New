# Launch checklist

Everything Stuccord needs to run online, in the order to do it. The code is
ready; these are the accounts, keys and settings only you can set.

The app runs on **Render** (two services from `render.yaml`) and stores
everything in **Supabase**. AI comes from **Anthropic** (Claude), **Google
Gemini** and **ElevenLabs**. Each AI feature switches itself off with a
clear message when its key is missing or its account is out of credit, and
starts working as soon as you add the key or credit. No code changes needed.

## 1. Supabase (database, sign-in, files)

1. **Migrations**: in the Supabase dashboard, SQL Editor, run every file in
   `supabase/migrations/` that hasn't been run yet, oldest first. The newest
   ones (needed for the AI graphics, pictures and cartoon) are:
   - `20261109120000_motion_plan.sql`
   - `20261110120000_story_images.sql`
   - `20261111120000_speaker_cartoon.sql`

   Not sure which ran? Database, Tables: if `motion_plan_runs`,
   `motion_image_runs` exist and `projects` has a `motion_character` column,
   all three are in.
2. **Auth URLs**: Authentication, URL Configuration:
   - Site URL: your app's address (e.g. `https://stuccord-motion-studio-xteb.onrender.com`,
     or your own domain later).
   - Redirect URLs: the same address followed by `/**`.
3. **Email**: Authentication, Emails: Supabase's built-in email sender is
   heavily rate limited. For real sign-ups, add your own SMTP (e.g. Resend,
   Postmark) under SMTP Settings.
4. **Upload size**: the Free plan allows files up to **50 MB**, and the app is
   set to match (`VITE_MAX_UPLOAD_MB=50`). For longer videos, upgrade to Pro,
   raise Storage, Settings, "Upload file size limit" (e.g. 500 MB), then set
   `VITE_MAX_UPLOAD_MB` on Render to the same number and redeploy.
5. **Old test user**: Authentication, Users: if `dev-user@stuccord.local`
   is there, delete it (an early migration used to create it).

## 2. Keys on Render

Render dashboard, each service, **Environment**. `render.yaml` lists every
key; these are the ones to fill in.

**App (`stuccord-motion-studio`)**

| Key | Needed for | Where to get it |
|---|---|---|
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | everything | Supabase, Project Settings, API |
| `SUPABASE_SERVICE_ROLE_KEY` | everything (server only) | same page, service_role (secret) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | everything | same page, anon / publishable |
| `PUBLIC_APP_URL` | links in emails and posts | your app's address |
| `RENDER_WORKER_URL` | exports, captions, AI voice | the worker's address + `/jobs` |
| `RENDER_WORKER_SECRET` | the same | any long random string, **the same on both services** |
| `ANTHROPIC_API_KEY` | AI graphics planning | console.anthropic.com, API Keys (add credit under Billing) |
| `GEMINI_API_KEY` | AI story pictures, speaker cartoon | aistudio.google.com, Get API key (**turn on billing** for its Google project) |
| `VITE_MAX_UPLOAD_MB` | upload limit | 50 on Supabase Free |
| `PUBLISHING_TOKEN_KEY` | posting to YouTube / TikTok / Instagram | 32 random bytes as base64 (optional) |
| `YOUTUBE_*`, `TIKTOK_*`, `INSTAGRAM_*` | each platform's posting | its developer console (optional) |

Leave `ENABLE_DEV_MOCK_AUTH=false` and `NODE_ENV=production` as they are.

**Worker (`stuccord-render-worker`)**

| Key | Needed for | Where to get it |
|---|---|---|
| `RENDER_WORKER_SECRET` | everything | the same value as the app's |
| `ELEVENLABS_API_KEY` | captions (speech-to-text), words for the AI graphics, AI voices | elevenlabs.io, Profile, API Keys (needs a plan with credits) |
| `ANTHROPIC_API_KEY` | a short AI hook line on videos without Motion graphics (optional) | the same key as the app's |
| `PUBLIC_APP_URL` | sending scheduled posts | your app's address (optional) |

After changing keys: **Manual Deploy, Deploy latest commit** on each service
(the app reads `VITE_` keys when it's built).

## 3. Render plans

- **Worker**: exports draw graphics with a headless browser and ffmpeg.
  Starter (512 MB) runs out of memory on longer videos; use **Standard
  (2 GB) or higher**. Watch an export's time in the logs and size up if
  needed.
- **App**: Starter is fine to start. Free instances sleep when idle (slow
  first load); use a paid instance for launch.

## 4. AI accounts and what they cost

| Service | Used for | Rough cost |
|---|---|---|
| Anthropic (Claude) | planning a video's graphics; hook lines | a few cents per plan |
| Google Gemini | AI pictures and the speaker cartoon | about $0.05 per picture |
| ElevenLabs | captions (speech-to-text), AI voices | per minute of audio / characters |

Free accounts get, each month: 5 exports, 3 AI graphics plans, 10 AI
pictures, 5,000 AI voice characters (`src/lib/plans.ts`,
`src/lib/ai-voice.ts`). That caps what one free account can cost you at
roughly $1 a month of AI. Set a monthly budget alert on each AI account.

## 5. Before you announce it

- Read `/terms` and `/privacy` (written to match what the app does) and have
  them checked for your country. Fill in your company details if you have a
  company.
- `support@stuccord.com` is the contact address on the site and in the
  Billing page: make sure it receives mail, or change it in
  `src/components/legal-page.tsx`, `src/routes/index.tsx`,
  `src/routes/_authenticated/billing.tsx` and `src/routes/_authenticated/help.tsx`.
- Payments aren't built yet: everyone is on the free beta. The landing page
  says so.

## 6. Smoke test after deploying

1. Open the site, sign up with a real email, confirm it, sign in.
2. New project, upload a short talking clip (under the upload limit).
3. Graphics panel: **Transcribe**, then **Plan graphics**. Graphics appear on
   the G1 track. If it says a key is missing or out of credit, check step 2/4.
4. Export (Render Video). The finished MP4 should have captions, graphics,
   zooms, sounds and music.
5. Optional: make a story scene picture and a speaker cartoon (needs Gemini
   billing), an AI voiceover (ElevenLabs), and post to a connected account.
