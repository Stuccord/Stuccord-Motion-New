// Studio voice: AI voice isolation (ElevenLabs Voice Isolator, $0.12 a
// minute) for recordings with noise under the words (street, wind, music,
// other people), which a noise reducer can't take out without eating the
// voice. The recording's sound goes up once; the answer (the voice alone,
// an MP3 the same length and in step with the picture: measured 0.2 ms off
// on a test, 2026-11-27) is saved next to the recording by the app's link
// and reused by every export and preview after that. The app decides who
// may use it (the monthly allowance, src/lib/studio-voice.server.ts).

import fsp from "fs/promises";
import path from "path";
import { spawn } from "child_process";

/** The service takes up to an hour and 500 MB. */
const MAX_SECONDS = 60 * 60;
/** A long recording takes a while (7.6 s took 12 s). */
const TIMEOUT_MS = 15 * 60 * 1000;

export const isolationReady = () => !!process.env.ELEVENLABS_API_KEY?.trim();

function run(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim().slice(-300) || `ffmpeg exited ${code}`)),
    );
  });
}

/**
 * The voice alone from a recording (a video or a sound file): its sound
 * sent to the voice isolator as lossless FLAC (not the whole video), the
 * answer written to `<workdir>/isolated.mp3`. Returns its path.
 */
export async function isolateVoice(ffmpegPath, file, workdir) {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error("voice isolation isn't set up (no ELEVENLABS_API_KEY)");
  const flac = path.join(workdir, "isolate-in.flac");
  await run(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", file,
    "-map", "0:a:0", "-vn", "-t", String(MAX_SECONDS),
    "-ac", "1", "-ar", "44100", "-c:a", "flac",
    flac,
  ]);
  const form = new FormData();
  form.append("audio", new Blob([await fsp.readFile(flac)], { type: "audio/flac" }), "audio.flac");
  const started = Date.now();
  const r = await fetch("https://api.elevenlabs.io/v1/audio-isolation", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`voice isolation failed: HTTP ${r.status} ${detail.slice(0, 200)}`);
  }
  const out = path.join(workdir, "isolated.mp3");
  await fsp.writeFile(out, Buffer.from(await r.arrayBuffer()));
  console.log(
    `[Worker] Voice isolated in ${((Date.now() - started) / 1000).toFixed(1)} s (cost ${r.headers.get("character-cost") ?? "?"})`,
  );
  await fsp.rm(flac, { force: true }).catch(() => {});
  return out;
}

/**
 * A recording's isolated voice, ready to use: downloaded when it's been
 * made before (`url`), else made now and saved where the app said
 * (`uploadUrl`, best-effort: a failed save only means it's made again next
 * time). Returns the local file, or null when there's neither.
 */
export async function isolatedVoiceFor({ ffmpegPath, file, url, uploadUrl, workdir, download }) {
  if (url) {
    const local = path.join(workdir, `isolated-${Date.now()}.mp3`);
    await download(url, local);
    return local;
  }
  if (!uploadUrl) return null;
  const made = await isolateVoice(ffmpegPath, file, workdir);
  try {
    const up = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "audio/mpeg", "x-upsert": "true" },
      body: await fsp.readFile(made),
    });
    if (!up.ok) console.warn(`[Worker] Saving the isolated voice failed: ${up.status}`);
  } catch (e) {
    console.warn("[Worker] Saving the isolated voice failed:", e?.message || e);
  }
  return made;
}
