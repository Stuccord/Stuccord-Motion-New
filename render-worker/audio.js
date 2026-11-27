// The export's sound, mixed the way a dialogue engineer would: the voice is
// cleaned up and set to a known level, everything else is placed relative to
// it, and the finished mix is mastered to the loudness social platforms play
// at.
//
//   voice (the video's own sound, and each voiceover)
//     mono-centred -> cleanup measured per recording (noise.js: clipped
//     peaks rebuilt, 80 Hz low-cut, mains hum notched, clicks repaired,
//     noise reduced as hard as the room needs) -> EQ (less mud, more
//     presence and air) -> gain to VOICE_LUFS (measured per render) ->
//     3:1 compressor -> de-esser
//   music   measured, set MUSIC_UNDER_VOICE_LU under the voice at the slider's
//           default, ducked a further ~10 dB while anyone speaks
//   sounds  the graphics' sounds are calibrated in motion.js (LEVEL_TRIM_DB);
//           the user's own SFX are measured and set like a whoosh
//   master  two-pass loudnorm to MASTER (-14 LUFS, -1 dBTP), linear gain
//
// Why: measured on a real upload, the voice came in at -30 LUFS while the
// whooshes hit -13 LUFS and the music sat level with the voice; with no
// loudness target the video played quietly with the words buried.

import { spawn } from "child_process";
import { limitThreads } from "./threads.js";
import { voiceCleanup } from "./noise.js";

/** Where the voice is set before mixing (integrated loudness). */
export const VOICE_LUFS = -20;
/** How far under the voice the music sits between words, at the slider's default. */
export const MUSIC_UNDER_VOICE_LU = 12;
/** The slider value (0-100) the music level above belongs to. */
export const MUSIC_DEFAULT_VOLUME = 60;
/** Where a user's own SFX peaks (momentary loudness) at gain 1, like a whoosh. */
export const SFX_MOMENTARY_LUFS = -22;
/** The finished mix: integrated loudness, true-peak ceiling, loudness range. */
export const MASTER = { I: -14, TP: -1, LRA: 11 };
/** Most a quiet recording is raised, and most a loud one is lowered (dB). */
const MAX_BOOST_DB = 24;
const MAX_CUT_DB = 18;
/** Below this the track is silence, not a quiet voice: left alone. */
const SILENT_LUFS = -60;

const FMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

/**
 * The voice chain as one filter string, stereo in and out. `gainDb` is the
 * level correction measured for this voice (see voiceGainDb), before the
 * compressor so it always works on the same level; `trimDb` corrects, after
 * it, what the compressor took off (measured through the whole chain, see
 * voiceTrimDb), so the voice lands on VOICE_LUFS.
 */
export function voiceChain(gainDb = 0, trimDb = 0, cleanup = DEFAULT_CLEANUP) {
  return [
    voicePre(cleanup),
    `volume=${gainDb.toFixed(2)}dB`,
    VOICE_DYNAMICS,
    `volume=${trimDb.toFixed(2)}dB`,
    "pan=stereo|c0=c0|c1=c0",
  ].join(",");
}

/** What the whole voice chain at `gainDb` is measured through (for voiceTrimDb). */
export const voiceChainMeasure = (gainDb, cleanup = DEFAULT_CLEANUP) =>
  voiceChain(gainDb, 0, cleanup);

/** The trim (dB) that brings a voice measured at `lufs` through the whole chain to VOICE_LUFS. */
export function voiceTrimDb(lufs) {
  if (!Number.isFinite(lufs) || lufs < SILENT_LUFS) return 0;
  return Math.min(6, Math.max(-6, VOICE_LUFS - lufs));
}

/** The cleanup when the voice couldn't be measured: an 80 Hz low-cut and light noise reduction. */
export const DEFAULT_CLEANUP = voiceCleanup(null).filters;

/**
 * The voice chain up to the level correction: what the voice is measured
 * through. `cleanup` is the recording's own repair (noise.js voiceCleanup).
 */
export function voicePre(cleanup = DEFAULT_CLEANUP) {
  return [
    // Phone and camera mics are a mono source; summing keeps it centred and
    // avoids the phasey sound two slightly different channels make.
    "pan=mono|c0=0.5*c0+0.5*c1",
    // Clipping, rumble, hum, clicks and noise: only what was measured.
    cleanup,
    // Less boxiness, more intelligibility on phone speakers, a little air.
    "equalizer=f=250:t=q:w=1:g=-2.5",
    "equalizer=f=3500:t=q:w=1:g=3",
    "highshelf=f=10000:g=1.5",
  ].join(",");
}

/**
 * What the voice is measured through: the chain up to the level correction,
 * in stereo as it plays (a mono signal reads 3 LU quieter than the same
 * voice on both channels, which would set it 3 dB too hot against music).
 */
export const voiceMeasure = (cleanup = DEFAULT_CLEANUP) =>
  `${voicePre(cleanup)},pan=stereo|c0=c0|c1=c0`;

/**
 * The voice's dynamics, on a voice at VOICE_LUFS: a 3:1 compressor that
 * takes 2-4 dB off louder words (about 6 on a shout) and evens out soft
 * ones, then a de-esser for the sibilance the presence boost brings up.
 * (A -24 dB threshold measured ~5 dB off the whole voice: too heavy.)
 */
const VOICE_DYNAMICS = [
  "acompressor=threshold=-18dB:ratio=3:attack=8:release=150:knee=6:makeup=1",
  "deesser=i=0.35:m=0.5:f=0.5",
].join(",");

/** The gain (dB) that brings a voice measured at `lufs` to VOICE_LUFS. */
export function voiceGainDb(lufs) {
  if (!Number.isFinite(lufs) || lufs < SILENT_LUFS) return 0;
  return clampDb(VOICE_LUFS - lufs);
}

/**
 * The gain (dB) for a music file measured at `lufs` under a voice at
 * VOICE_LUFS, with the slider's 0-100 volume (0 mutes: null).
 */
export function musicGainDb(lufs, volume) {
  const v = Math.min(100, Math.max(0, Number(volume ?? MUSIC_DEFAULT_VOLUME)));
  if (v === 0) return null;
  const slider = 20 * Math.log10(v / MUSIC_DEFAULT_VOLUME);
  if (!Number.isFinite(lufs) || lufs < SILENT_LUFS) return slider;
  return clampDb(VOICE_LUFS - MUSIC_UNDER_VOICE_LU - lufs) + slider;
}

/** The gain (dB) for a user's SFX whose loudest moment measured `momentaryMax`. */
export function sfxGainDb(momentaryMax) {
  if (!Number.isFinite(momentaryMax) || momentaryMax < SILENT_LUFS) return 0;
  return clampDb(SFX_MOMENTARY_LUFS - momentaryMax);
}

const clampDb = (db) => Math.min(MAX_BOOST_DB, Math.max(-MAX_CUT_DB, db));

/**
 * Measures a file's sound (after `filters`, if any): integrated loudness,
 * true peak, loudness range and gating threshold (loudnorm's analysis), and
 * the loudest momentary (400 ms) loudness. Resolves null when it has none.
 */
export function measureLoudness(ffmpegPath, file, { filters = null, momentary = false } = {}) {
  const chain = [FMT, filters, momentary ? "ebur128" : null, "loudnorm=print_format=json"]
    .filter(Boolean)
    .join(",");
  const args = limitThreads([
    "-hide_banner", "-nostats", ...(momentary ? ["-v", "verbose"] : []),
    "-i", file, "-vn", "-af", chain, "-f", "null", "-",
  ]);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    const reader = loudnessReader();
    child.stderr.on("data", (d) => reader.push(d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`loudness measure exited ${code}: ${reader.tail(300)}`));
      const result = reader.result();
      if (result === undefined) {
        console.warn(`[Worker] No loudness reading in ffmpeg's report: ${reader.tail(300)}`);
      }
      resolve(result ?? null);
    });
  });
}

/**
 * Reads ffmpeg's report as it arrives, in pieces of any size: each momentary
 * (M:) reading, and loudnorm's JSON at the end. result() is the reading,
 * null for silence, undefined when the report had none.
 */
export function loudnessReader() {
  let text = "";
  let carry = "";
  let momentaryMax = -Infinity;
  return {
    push(chunk) {
      // A reading can be split between pieces: look for them in what's left
      // over from the last piece plus this one, but store each piece once.
      const scan = carry + chunk;
      for (const m of scan.matchAll(/ M: *(-?[\d.]+)(?=\s)/g)) {
        momentaryMax = Math.max(momentaryMax, Number(m[1]));
      }
      carry = scan.slice(-40);
      text = (text + chunk).slice(-6000);
    },
    tail: (n) => text.slice(-n),
    result() {
      const json = text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1);
      let j;
      try {
        j = JSON.parse(json);
      } catch {
        return undefined;
      }
      const n = (k) => Number(j[k]);
      if (!Number.isFinite(n("input_i"))) return undefined;
      if (n("input_i") <= -70) return null;
      return {
        i: n("input_i"),
        tp: n("input_tp"),
        lra: n("input_lra"),
        thresh: n("input_thresh"),
        momentaryMax: Number.isFinite(momentaryMax) ? momentaryMax : null,
      };
    },
  };
}

/**
 * ffmpeg arguments that mix the sound to `out` (a WAV the video's length):
 *  - the voice: the video's own audio through voiceChain(voiceGain, voiceTrim,
 *    voiceClean), or
 *    silence if it has none (quieter under a voiceover),
 *  - the music, each file at its own gain (musicGainDb), faded in and out
 *    and ducked under the voice: musicPlan { mode: "sequence", paths }
 *    plays the files one after another from 0:00, looped to the end;
 *    { mode: "segments", segments: [{ path, startMs, endMs }] } loops each
 *    file over its own span,
 *  - sfxEvents: [{ path, atMs, gain?, gainDb? }], each played once,
 *  - voiceovers: [{ path, atMs, inMs, outMs, gainDb, trimDb, cleanup }], each through the
 *    voice chain at its own gain; the video's sound and the music duck
 *    under them.
 * `musicGains` maps a music path to its gain in dB (null mutes it).
 */
export function buildAudioMixArgs({
  videoPath,
  hasVoice,
  durationMs,
  musicPlan,
  sfxEvents = [],
  voiceovers = [],
  voiceGain = 0,
  voiceTrim = 0,
  voiceClean = DEFAULT_CLEANUP,
  musicGains = new Map(),
  out,
}) {
  const D = (durationMs / 1000).toFixed(3);
  const inputs = ["-i", videoPath];
  const graph = [];
  const mixInputs = [];
  const gainOf = (p) => (musicGains.has(p) ? musicGains.get(p) : 0);
  const musicPaths = musicPlan.mode === "sequence" ? musicPlan.paths.filter((p) => gainOf(p) !== null) : [];
  const segments = musicPlan.mode === "segments" ? musicPlan.segments.filter((s) => gainOf(s.path) !== null) : [];
  const hasMusic = musicPaths.length > 0 || segments.length > 0;
  const vos = voiceovers.slice(0, MAX_VO);
  const sfx = sfxEvents.slice(0, MAX_SFX);
  const hasVo = vos.length > 0;
  // Inputs: the video, the music files, the SFX, then the voiceovers.
  const firstVo = 1 + musicPaths.length + segments.length + sfx.length;

  // Voiceovers: each through the voice chain at its time, on one bus.
  if (hasVo) {
    vos.forEach((vo, k) => {
      const from = (Math.max(0, vo.inMs) / 1000).toFixed(3);
      const to = vo.outMs != null ? `:end=${(vo.outMs / 1000).toFixed(3)}` : "";
      const at = Math.max(0, Math.round(vo.atMs));
      graph.push(
        `[${firstVo + k}:a]${FMT},atrim=start=${from}${to},asetpts=PTS-STARTPTS,` +
          `${voiceChain(vo.gainDb ?? 0, vo.trimDb ?? 0, vo.cleanup ?? DEFAULT_CLEANUP)},adelay=${at}:all=1[vo${k}]`,
      );
    });
    // Mixed onto silence the length of the video, which places each one by
    // its delayed timestamps (adelay shifts them at the start of a stream).
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${D}[vosil]`);
    graph.push(
      `[vosil]${vos.map((_, k) => `[vo${k}]`).join("")}amix=inputs=${vos.length + 1}:` +
        `duration=first:dropout_transition=0:normalize=0,asplit=${hasMusic ? 3 : 2}[vo][vokey]` +
        (hasMusic ? "[vokeym]" : ""),
    );
  }

  // Voice: the video's audio, cleaned and levelled (quieter under a voiceover).
  if (hasVoice) {
    graph.push(
      `[0:a]${FMT},${voiceChain(voiceGain, voiceTrim, voiceClean)}` +
        (hasMusic ? ",asplit=2[voiceraw][voicekey]" : "[voiceraw]"),
    );
    graph.push(
      hasVo
        ? "[voiceraw][vokey]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[voice]"
        : "[voiceraw]anull[voice]",
    );
  } else {
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${D}[voice]`);
    if (hasVo) graph.push("[vokey]anullsink");
  }
  mixInputs.push("[voice]");

  // Music: each file at its gain, looped to fill, faded, ducked under the voice.
  if (hasMusic) {
    const first = 1;
    const fadeOutStart = Math.max(0, durationMs / 1000 - MUSIC_FADE_OUT_S).toFixed(3);
    if (musicPaths.length) {
      musicPaths.forEach((p, i) => {
        inputs.push("-i", p);
        graph.push(`[${first + i}:a]${FMT},volume=${gainOf(p).toFixed(2)}dB[m${i}]`);
      });
      const joined = musicPaths.map((_, i) => `[m${i}]`).join("");
      graph.push(
        musicPaths.length > 1
          ? `${joined}concat=n=${musicPaths.length}:v=0:a=1[mjoined]`
          : `[m0]anull[mjoined]`,
      );
      graph.push(
        `[mjoined]aloop=loop=-1:size=2147483647,atrim=0:${D},asetpts=N/SR/TB,` +
          `afade=t=in:st=0:d=${MUSIC_FADE_IN_S}[mbus]`,
      );
    } else {
      // Each song over its own span, looped to fill it, with short fades
      // where one song hands over to the next.
      segments.forEach((seg, i) => {
        inputs.push("-i", seg.path);
        const len = ((seg.endMs - seg.startMs) / 1000).toFixed(3);
        const fade = Math.min(MUSIC_FADE_IN_S, (seg.endMs - seg.startMs) / 4000).toFixed(3);
        const outAt = Math.max(0, (seg.endMs - seg.startMs) / 1000 - Number(fade)).toFixed(3);
        graph.push(
          `[${first + i}:a]${FMT},volume=${gainOf(seg.path).toFixed(2)}dB,aloop=loop=-1:size=2147483647,` +
            `atrim=0:${len},asetpts=N/SR/TB,afade=t=in:st=0:d=${fade},afade=t=out:st=${outAt}:d=${fade},` +
            `adelay=${Math.round(seg.startMs)}:all=1[ms${i}]`,
        );
      });
      graph.push(
        segments.length > 1
          ? `${segments.map((_, i) => `[ms${i}]`).join("")}amix=inputs=${segments.length}:` +
              "duration=longest:dropout_transition=0:normalize=0[mseq]"
          : "[ms0]anull[mseq]",
      );
      graph.push(`[mseq]apad,atrim=0:${D},asetpts=N/SR/TB[mbus]`);
    }
    const ducked = hasVoice || hasVo;
    graph.push(
      `[mbus]afade=t=out:st=${fadeOutStart}:d=${MUSIC_FADE_OUT_S}` + (ducked ? "[mraw]" : "[music]"),
    );
    if (ducked) {
      if (hasVoice && hasVo) {
        graph.push("[voicekey][vokeym]amix=inputs=2:normalize=0[mkey]");
      } else {
        graph.push(`${hasVoice ? "[voicekey]" : "[vokeym]"}anull[mkey]`);
      }
      // The voice sits at VOICE_LUFS (about -20 dBFS while talking), well
      // over the -32 dBFS threshold: ~10 dB of ducking under speech, back up
      // within ~0.4 s of a pause.
      graph.push(
        "[mraw][mkey]sidechaincompress=threshold=0.025:ratio=6:attack=20:release=400[music]",
      );
    }
    mixInputs.push("[music]");
  }

  // SFX: each one once, at its time.
  const firstSfx = 1 + musicPaths.length + segments.length;
  sfx.forEach((ev, k) => {
    inputs.push("-i", ev.path);
    const at = Math.max(0, Math.round(ev.atMs));
    const gain = Number.isFinite(ev.gain) ? ev.gain : SFX_GAIN;
    const db = Number.isFinite(ev.gainDb) ? `,volume=${ev.gainDb.toFixed(2)}dB` : "";
    graph.push(`[${firstSfx + k}:a]${FMT},volume=${gain}${db},adelay=${at}:all=1[s${k}]`);
    mixInputs.push(`[s${k}]`);
  });

  if (hasVo) {
    vos.forEach((vo) => inputs.push("-i", vo.path));
    mixInputs.push("[vo]");
  }

  // Summed with headroom; the master pass sets the final level.
  graph.push(
    `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0,` +
      `atrim=0:${D}[aout]`,
  );

  return [
    "-y",
    ...inputs,
    "-filter_complex", graph.join(";"),
    "-map", "[aout]",
    "-c:a", "pcm_f32le", "-ar", "48000",
    out,
  ];
}

/**
 * The peak limit (linear, for alimiter) a mix measured as `m` needs so that
 * mastering's gain up to MASTER.I leaves its true peak under MASTER.TP (with
 * a 1 dB margin: alimiter limits samples, true peaks between samples run a
 * little higher). null when the peaks already fit, so loudnorm can stay in
 * its linear mode (one gain for the whole video, no pumping).
 */
export function limitFor(m) {
  if (!m) return null;
  const gain = MASTER.I - m.i;
  const ceilingDb = MASTER.TP - gain - 1;
  if (m.tp <= ceilingDb) return null;
  return Number(Math.min(1, 10 ** (ceilingDb / 20)).toFixed(4));
}

/** ffmpeg arguments that peak-limit `input` (a WAV) to `limit` into `out`. */
export function limiterArgs(input, limit, out) {
  return [
    "-y", "-i", input,
    "-af", `alimiter=limit=${limit}:attack=5:release=50:level=false`,
    "-c:a", "pcm_f32le", "-ar", "48000",
    out,
  ];
}

/**
 * ffmpeg arguments that put the mastered mix under the video: the video
 * stream copied, the mix (`mixPath`, measured as `measured`) normalised to
 * MASTER in loudnorm's second, linear pass, as AAC.
 */
export function masterArgs({ videoPath, mixPath, measured, durationMs, out }) {
  const m = measured;
  const norm =
    `loudnorm=I=${MASTER.I}:TP=${MASTER.TP}:LRA=${MASTER.LRA}` +
    (m
      ? `:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:linear=true`
      : "");
  return [
    "-y",
    "-i", videoPath,
    "-i", mixPath,
    "-map", "0:v", "-map", "1:a",
    "-af", `${norm},aresample=48000`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-t", (durationMs / 1000).toFixed(3),
    "-movflags", "+faststart",
    out,
  ];
}

export const MUSIC_FADE_IN_S = 0.5;
export const MUSIC_FADE_OUT_S = 1.5;
const SFX_GAIN = 0.8;
const MAX_SFX = 100;
const MAX_VO = 50;
