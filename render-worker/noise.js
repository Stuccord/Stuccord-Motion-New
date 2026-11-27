// Measuring what's wrong with a recording's sound before cleaning it (a
// dialogue engineer listens first, then treats only what's there):
//
//   noise floor  how loud the room is in the pauses between words
//   voice level  how loud the words are, so the voice-to-noise gap (SNR)
//                says how hard the noise reduction should work
//   hum          mains hum (50 or 60 Hz and its harmonics) from lights,
//                chargers or cables: notched out, not smeared by the NR
//   clipping     samples stuck at full scale (a mic too close or too hot)
//   clicks       short spikes (mouth clicks, a knock, a bad edit)
//
// cleanupPlan turns that into the treatment (audio.js voiceCleanup).

import { spawn } from "child_process";

/** The rate the sound is measured at (enough for speech, hum and clicks). */
const RATE = 16000;
/** One measuring window: 20 ms. */
const WIN = RATE / 50;

/** Reads a file's sound as mono floats at RATE (left and right averaged). */
export function readMono(ffmpegPath, file, { maxSeconds = 600 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner", "-nostdin", "-v", "error",
      "-i", file, "-t", String(maxSeconds),
      "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "pipe:1",
    ];
    const p = spawn(ffmpegPath, args);
    const chunks = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.trim().slice(-300) || `ffmpeg exited ${code}`));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 4);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
      resolve(out);
    });
  });
}

const dB = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

/** The strength of a frequency in a stretch of samples (Goertzel), as an amplitude. */
function toneLevel(x, from, len, freq) {
  const w = (2 * Math.PI * freq) / RATE;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < len; i++) {
    // A Hann window, so nearby frequencies don't leak in.
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    const s = x[from + i] * h + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (len / 4);
}

/**
 * Measures a recording's sound: { seconds, noiseDb, voiceDb, snrDb, hum,
 * clicksPerMin }. Levels are dBFS (RMS of 20 ms windows);
 * hum is { hz: 50 | 60, aboveDb } when a mains hum stands out in the pauses
 * (aboveDb: how far its harmonics stand over the noise around them), else null.
 */
export function measureNoise(x) {
  const seconds = x.length / RATE;
  const frames = Math.floor(x.length / WIN);
  if (frames < 25) return null;
  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * WIN; i < (f + 1) * WIN; i++) s += x[i] * x[i];
    rms[f] = Math.sqrt(s / WIN);
  }
  const levels = Array.from(rms, dB).sort((a, b) => a - b);
  // The room: the quiet tenth (pauses, breaths) - its middle, so a few
  // digital-silence frames (a muted gap) don't pass for a quiet room.
  const quiet = levels.filter((l) => l > -100);
  const noiseDb = quiet.length ? percentile(quiet, 0.1) : -100;
  // The words: the loud part of what's said.
  const voiceDb = percentile(levels, 0.9);

  // Hum, listened for in the pauses only (the voice has its own 100-200 Hz).
  const pauseAt = [];
  const limit = dB(Math.pow(10, noiseDb / 20) * 2); // within 6 dB of the floor
  for (let f = 0; f < frames; f++) if (dB(rms[f]) <= limit) pauseAt.push(f);
  let hum = null;
  // Runs of 4 quiet windows (80 ms) next to each other, enough to tell 50 from 60 Hz.
  const runs = [];
  for (let k = 0; k + 3 < pauseAt.length && runs.length < 60; k++) {
    if (pauseAt[k + 3] === pauseAt[k] + 3) {
      runs.push(pauseAt[k] * WIN);
      k += 3;
    }
  }
  if (runs.length >= 3) {
    const len = WIN * 4;
    const standOut = (base) => {
      let sum = 0;
      for (const h of [1, 2, 3]) {
        const f0 = base * h;
        let tone = 0;
        let around = 0;
        for (const at of runs) {
          tone += toneLevel(x, at, len, f0);
          around += (toneLevel(x, at, len, f0 - 18) + toneLevel(x, at, len, f0 + 18)) / 2;
        }
        sum += dB(tone) - dB(around);
      }
      return sum / 3;
    };
    const s50 = standOut(50);
    const s60 = standOut(60);
    const best = s50 >= s60 ? { hz: 50, aboveDb: s50 } : { hz: 60, aboveDb: s60 };
    // A clear hum stands well over the noise either side of it.
    if (best.aboveDb >= 8) hum = { hz: best.hz, aboveDb: Number(best.aboveDb.toFixed(1)) };
  }

  // Clicks: a spike in the second difference far over what's around it,
  // short (under 1.5 ms) and well clear of the level of its window.
  let clicks = 0;
  const d2 = new Float32Array(x.length);
  for (let i = 2; i < x.length; i++) d2[i] = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
  for (let f = 0; f < frames; f++) {
    const a = f * WIN;
    const win = Array.from(d2.subarray(a, a + WIN)).sort((p, q) => p - q);
    const median = win[WIN >> 1] || 1e-6;
    const top = win[WIN - 1];
    const second = win[WIN - 26] ?? 0; // a click is a few samples, not many
    if (top > 0.04 && top > median * 25 && second < top * 0.3) clicks++;
  }

  const perMin = (n) => Number(((n / Math.max(seconds, 1)) * 60).toFixed(1));
  return {
    seconds: Number(seconds.toFixed(1)),
    noiseDb: Number(noiseDb.toFixed(1)),
    voiceDb: Number(voiceDb.toFixed(1)),
    snrDb: Number((voiceDb - noiseDb).toFixed(1)),
    hum,
    clicksPerMin: perMin(clicks),
  };
}

/**
 * Whether the recording clipped, read at its own sample rate (resampling
 * rounds off the flat tops): its peak at full scale, held there for runs
 * of samples. Returns { peakDb, peakCount, clipped }.
 */
export function measureClipping(ffmpegPath, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, [
      "-hide_banner", "-nostdin", "-i", file, "-vn",
      "-af", "astats=measure_overall=Peak_level+Peak_count+Flat_factor:measure_perchannel=none",
      "-f", "null", "-",
    ]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.trim().slice(-300) || `ffmpeg exited ${code}`));
      const num = (label) => {
        const m = [...err.matchAll(new RegExp(String.raw`${label}:\s*(-?[\d.]+|-?inf)`, "g"))].pop();
        return m ? Number(m[1].replace("inf", "Infinity")) : null;
      };
      const peakDb = num("Peak level dB");
      const peakCount = num("Peak count");
      const flat = num("Flat factor");
      resolve({
        peakDb,
        peakCount,
        clipped: peakDb != null && peakDb > -0.5 && (flat ?? 0) > 0 && (peakCount ?? 0) >= 10,
      });
    });
  });
}

/** Measures a voice recording for its cleanup (voiceCleanup): noise, hum, clicks, clipping. */
export async function analyzeVoice(ffmpegPath, file) {
  const [noise, clip] = await Promise.all([
    readMono(ffmpegPath, file).then(measureNoise),
    measureClipping(ffmpegPath, file),
  ]);
  return noise ? { ...noise, clipped: clip.clipped, peakDb: clip.peakDb } : null;
}

// ---------- the treatment ----------

/** Most the noise is turned down (dB): past this a voice starts to sound underwater, and a little room tone should stay. */
const MAX_REDUCTION_DB = 20;
/**
 * The noise reducer only treats what's under its noise floor setting, which
 * sits about this far above the room's level as measured here. Calibrated
 * 2026-11-27 on a clean voice mixed with fan, hiss, street and hum noise,
 * scored against the clean voice: at 10 every noisy case came out both
 * quieter between words (9-18 dB) and closer to the clean voice; higher
 * settings took more noise off but started to wear at the voice.
 */
const FLOOR_ABOVE_ROOM_DB = 10;
/** More clicks than this a minute are worth repairing. */
const CLICKS_PER_MIN = 10;

/** The noise reduction's steps (dB): a clean room barely, a noisy one most. */
const REDUCTION_STEPS = [6, 10, 15, MAX_REDUCTION_DB];
/** Strong goes one step past the usual most (the user asked for it: some wear on the voice is accepted). */
const STRONG_MAX_DB = 25;

/** The user's Noise removal setting (the editor's): Auto picks the strength from the room. */
export const NOISE_MODES = ["auto", "off", "light", "strong"];
export const noiseMode = (m) => (NOISE_MODES.includes(m) ? m : "auto");

/**
 * How hard the noise reduction works (dB) for a voice-to-noise gap, at the
 * user's setting: Light one step gentler than Auto, Strong one step harder.
 */
export function reductionFor(snrDb, mode = "auto") {
  let step = !Number.isFinite(snrDb) ? 0 : snrDb >= 45 ? 0 : snrDb >= 35 ? 1 : snrDb >= 25 ? 2 : 3;
  if (mode === "light") step = Math.max(0, step - 1);
  if (mode === "strong") return step + 1 < REDUCTION_STEPS.length ? REDUCTION_STEPS[step + 1] : STRONG_MAX_DB;
  return REDUCTION_STEPS[step];
}

/**
 * The cleanup for a measured voice (analyzeVoice), as ffmpeg filters on a
 * mono voice, in the order a dialogue engineer works: clipped peaks
 * rebuilt first (before anything reshapes them), rumble cut, mains hum
 * notched out (narrow, so the voice is untouched), clicks repaired, then the
 * steady noise reduced (after hum and clicks, which it can't treat well,
 * and before compression, which would bring the noise back up). Each step
 * only when its problem was measured. Unmeasured: the light default.
 * `mode` is the user's setting (NOISE_MODES): Off leaves only the low-cut.
 * Returns { filters, report } (report: what was found and done, for the
 * export's notes).
 */
export function voiceCleanup(m, mode = "auto") {
  mode = noiseMode(mode);
  // Off: only the low-cut below the voice (rumble and handling, not noise removal).
  if (mode === "off") return { filters: "highpass=f=80:poles=2", report: m ? { mode, ...found(m) } : { mode } };
  if (!m) {
    return {
      filters: "highpass=f=80:poles=2,afftdn=nr=6:nf=-60:tn=1",
      report: null,
    };
  }
  const steps = [];
  if (m.clipped) steps.push("adeclip");
  steps.push("highpass=f=80:poles=2");
  if (m.hum) {
    for (let k = 1; k <= 4; k++) steps.push(`bandreject=f=${m.hum.hz * k}:t=h:w=3`);
  }
  const declick = m.clicksPerMin > CLICKS_PER_MIN;
  if (declick) steps.push("adeclick");
  const nr = reductionFor(m.snrDb, mode);
  const nf = Math.round(Math.min(-20, Math.max(-80, m.noiseDb + FLOOR_ABOVE_ROOM_DB)));
  // A fixed floor from the measurement (the reducer's own tracking drifted
  // with the voice and left hiss behind).
  steps.push(`afftdn=nr=${nr}:nf=${nf}`);
  return {
    filters: steps.join(","),
    report: { mode, ...found(m), reduction_db: nr, declicked: declick },
  };
}

/** What the measurement found, for the export's notes. */
function found(m) {
  return {
    noise_db: m.noiseDb,
    voice_db: m.voiceDb,
    snr_db: m.snrDb,
    hum_hz: m.hum?.hz ?? null,
    clicks_per_min: m.clicksPerMin,
    clipped: !!m.clipped,
  };
}
