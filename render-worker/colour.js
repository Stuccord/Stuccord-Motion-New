// Automatic colour correction (every export): the footage is measured, then
// set right before the look's grade goes on top, the way a colourist starts
// every grade with a technical correction. People first:
//
//   exposure  set for the speaker's SKIN, not the frame's average. A bright
//             wall behind a darker-skinned speaker made the old average
//             darken everything: the face went from 42 to 15 (of 255) and
//             61% of it to near black (owner's footage, 2026-11-27). Skin
//             that's already well exposed is left alone; skin that's too
//             dark is lifted (a gamma curve: highlights compressed, never
//             clipped), skin that's too bright brought down a little.
//   blacks    held where they were: a lift never greys the blacks.
//   cast      measured on what should be neutral (nearly colourless,
//             mid-bright pixels that aren't skin: a grey shirt, white paper)
//             and pulled halfway back; never from skin (a grey-world
//             correction turns skin grey), never from a coloured wall (a
//             cream wall is cream, not a cast: taking it as one turned the
//             owner's skin blue-ish), and never turning skin's hue by more
//             than a few degrees.
//
// Without skin in view (a screen recording, a product shot) it falls back to
// a gentle correction from the frame's average, as before.

import { spawn } from "child_process";
import { limitThreads } from "./threads.js";

/** Skin's luma (0-1, video levels) kept within this band: below it lifted, above it lowered. */
const SKIN_MIN = 0.3;
const SKIN_MAX = 0.72;
/** Skin's hue in the chroma plane (atan2(cr, cb), degrees) and how far it reaches. */
const SKIN_HUE_LO = 95;
const SKIN_HUE_HI = 150;
/** The gamma's limits (out = in^gamma: below 1 lifts). */
const GAMMA_LO = 0.62;
const GAMMA_HI = 1.25;
/** How much of a measured cast is taken out, and the most it moves chroma (0-1 units). */
const CAST_SHARE = 0.5;
const MAX_CAST = 0.02;
/** Only this colourless counts as neutral (chroma, 0-1): a cream or beige wall is a colour, not a cast. */
const NEUTRAL_CHROMA = 0.03;
/** The most the cast correction may turn skin's hue (degrees). */
const SKIN_HUE_KEEP = 5;
/**
 * Skin is a strong colour for its brightness (chroma / luma): a pale warm
 * wall has the same hue as skin but far less colour for how bright it is
 * (owner's cream wall 0.09; dark and light skin 0.15 and up).
 */
const SKIN_MIN_SAT = 0.13;
/** Without skin: where the average luma is brought (old behaviour, gentler). */
const TARGET_Y = 0.44;
/** How much colour comes back with a lift (per unit of gamma below 1). */
const SAT_BACK = 0.35;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => Number(v.toFixed(4));
/** Pixels per side each measured frame is shrunk to (aspect ignored: only statistics are kept). */
const SIDE = 160;

/** BT.709 Y'CbCr (Y 0-1, Cb/Cr -0.5..0.5) from 0-1 RGB. */
function toYcc(r, g, b) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [y, (b - y) / 1.8556, (r - y) / 1.5748];
}
function toRgb(y, cb, cr) {
  const r = y + 1.5748 * cr;
  const b = y + 1.8556 * cb;
  const g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
  return [r, g, b];
}
const hueOf = (cb, cr) => ((Math.atan2(cr, cb) * 180) / Math.PI + 360) % 360;
const isSkinHue = (h) => h >= SKIN_HUE_LO && h <= SKIN_HUE_HI;

/**
 * Reads frames (a frame a second, at most 60; a still: itself) as SIDE x
 * SIDE RGB. `item` is a file (or link), or { file, inMs, outMs, pre }: only
 * that stretch of it, through filters `pre` first (HDR made normal, fitted
 * to the video's frame), as the export sees it.
 */
async function readFrames(ffmpegPath, item) {
  const it = typeof item === "string" ? { file: item } : item;
  return (await readWith(ffmpegPath, it, "fps=1,")) ?? (await readWith(ffmpegPath, it, ""));
}

function readWith(ffmpegPath, { file, inMs, outMs, pre }, rate) {
  const start = Math.max(0, Number(inMs) || 0);
  const from = start > 0 ? ["-ss", (start / 1000).toFixed(3)] : [];
  const length =
    Number(outMs) > start ? ["-t", ((Number(outMs) - start) / 1000).toFixed(3)] : [];
  const args = limitThreads([
    "-hide_banner", "-nostats", "-v", "error",
    ...from, "-i", file, ...length, "-an",
    "-vf", `${pre ? `${pre},` : ""}${rate}scale=${SIDE}:${SIDE}:flags=area,format=rgb24`,
    "-frames:v", "60", "-f", "rawvideo", "pipe:1",
  ]);
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const buf = Buffer.concat(chunks);
      const size = SIDE * SIDE * 3;
      const frames = [];
      for (let o = 0; o + size <= buf.length; o += size) frames.push(buf.subarray(o, o + size));
      resolve(frames.length ? frames : null);
    });
  });
}

/** The weighted median of values (weights > 0). */
function weightedMedian(items) {
  if (!items.length) return NaN;
  items.sort((a, b) => a[0] - b[0]);
  const total = items.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of items) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return items[items.length - 1][0];
}

/**
 * The footage's colour, measured on frames of `files` (a video, or stills):
 * the frame's levels, the speaker's skin, and the neutral areas' cast.
 * `center` is where the speaker's face is (0-1 of the frame), when known.
 * Null when it can't be read.
 */
export async function analyzeColour(ffmpegPath, files, { center = null } = {}) {
  const list = Array.isArray(files) ? files : [files];
  const frames = (await Promise.all(list.map((f) => readFrames(ffmpegPath, f)))).flat().filter(Boolean);
  if (!frames.length) return null;
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  const face = center && ok(center.x) && ok(center.y) ? center : null;
  // Where to look for skin: round the face when it's known, else the upper
  // middle of the frame (where a talking head's face is).
  const box = face
    ? { x0: face.x - 0.16, x1: face.x + 0.16, y0: face.y - 0.12, y1: face.y + 0.12, cx: face.x, cy: face.y }
    : { x0: 0.25, x1: 0.75, y0: 0.1, y1: 0.55, cx: 0.5, cy: 0.32 };
  const lumas = [];
  const skin = [];
  const skinCbCr = [0, 0, 0];
  const neutral = [0, 0, 0];
  let samples = [];
  for (const buf of frames) {
    for (let py = 0; py < SIDE; py++) {
      const fy = (py + 0.5) / SIDE;
      for (let px = 0; px < SIDE; px++) {
        const fx = (px + 0.5) / SIDE;
        const o = (py * SIDE + px) * 3;
        const r = buf[o] / 255;
        const g = buf[o + 1] / 255;
        const b = buf[o + 2] / 255;
        const [y, cb, cr] = toYcc(r, g, b);
        lumas.push(y);
        const chroma = Math.hypot(cb, cr);
        const hue = hueOf(cb, cr);
        const inBox = fx >= box.x0 && fx <= box.x1 && fy >= box.y0 && fy <= box.y1;
        const skinLike =
          chroma >= 0.02 && chroma <= 0.25 && y >= 0.04 && y <= 0.95 &&
          chroma / Math.max(y, 0.05) >= SKIN_MIN_SAT && isSkinHue(hue);
        if (inBox && skinLike) {
          // Nearer the face's middle counts more: a warm wall at the box's
          // edge doesn't pass for skin.
          const d2 = ((fx - box.cx) / 0.16) ** 2 + ((fy - box.cy) / 0.12) ** 2;
          const w = Math.exp(-2 * d2);
          skin.push([y, w]);
          skinCbCr[0] += cb * w;
          skinCbCr[1] += cr * w;
          skinCbCr[2] += w;
          if (samples.length < 4000 && (px + py) % 3 === 0) samples.push([r, g, b]);
        } else if (!skinLike && chroma < NEUTRAL_CHROMA && y >= 0.2 && y <= 0.92) {
          neutral[0] += cb;
          neutral[1] += cr;
          neutral[2] += 1;
        }
      }
    }
  }
  lumas.sort((a, b) => a - b);
  const pct = (q) => lumas[Math.floor(q * (lumas.length - 1))];
  const boxPixels = frames.length * SIDE * SIDE * (box.x1 - box.x0) * (box.y1 - box.y0);
  const hasSkin = skin.length >= boxPixels * 0.04;
  // Keep up to 64 skin colours (even spread) for checking LUTs on them.
  if (samples.length > 64) {
    const step = samples.length / 64;
    samples = Array.from({ length: 64 }, (_, i) => samples[Math.floor(i * step)]);
  }
  return {
    // The frame's average and spread (0-1).
    y: lumas.reduce((s, v) => s + v, 0) / lumas.length,
    low: pct(0.1),
    high: pct(0.9),
    black: pct(0.005),
    white: pct(0.995),
    skin: hasSkin
      ? {
          y: weightedMedian(skin),
          cb: skinCbCr[0] / skinCbCr[2],
          cr: skinCbCr[1] / skinCbCr[2],
          samples,
        }
      : null,
    // The neutral areas' mean chroma (a cast), when there are enough of them.
    neutral:
      neutral[2] >= frames.length * SIDE * SIDE * 0.05
        ? { cb: neutral[0] / neutral[2], cr: neutral[1] / neutral[2] }
        : null,
  };
}

/**
 * The correction's numbers for footage measured as `s` (analyzeColour):
 * { gamma, du, dv } (gamma on luma; du, dv added to Cb, Cr, 0-1 units), or
 * null when it's already right.
 */
export function correctionParams(s) {
  if (!s) return null;
  // Too dark or almost black (a title card, a screen recording): leave it.
  if (s.y < 0.06 || s.high - s.low < 0.15) return null;
  let gamma = 1;
  if (s.skin) {
    // Expose for skin: into the band, not to one level (dark skin stays dark).
    const target = s.skin.y < SKIN_MIN ? SKIN_MIN : s.skin.y > SKIN_MAX ? SKIN_MAX : s.skin.y;
    if (target !== s.skin.y) {
      gamma = Math.log(target) / Math.log(clamp(s.skin.y, 0.02, 0.98));
    }
  } else {
    gamma = Math.log(TARGET_Y) / Math.log(clamp(s.y, 0.02, 0.98));
    gamma = clamp(gamma, 0.88, 1.15);
  }
  gamma = clamp(gamma, GAMMA_LO, GAMMA_HI);
  // The cast, from neutrals only; skin must keep its hue after the shift.
  let du = 0;
  let dv = 0;
  if (s.neutral) {
    du = clamp(-s.neutral.cb * CAST_SHARE, -MAX_CAST, MAX_CAST);
    dv = clamp(-s.neutral.cr * CAST_SHARE, -MAX_CAST, MAX_CAST);
    if (s.skin) {
      const turn = () => {
        const d = Math.abs(hueOf(s.skin.cb + du, s.skin.cr + dv) - hueOf(s.skin.cb, s.skin.cr));
        return Math.min(d, 360 - d);
      };
      for (let i = 0; i < 4 && turn() > SKIN_HUE_KEEP; i++) {
        du /= 2;
        dv /= 2;
      }
      if (turn() > SKIN_HUE_KEEP) du = dv = 0;
    }
  }
  if (Math.abs(gamma - 1) < 0.02 && Math.abs(du) < 0.002 && Math.abs(dv) < 0.002) return null;
  // A lift raises the blacks too; the black point is held where it was.
  const black = clamp(s.black ?? 0, 0, 0.2);
  const pull = gamma < 1 ? Math.max(0, Math.pow(black, gamma) - black) : 0;
  // A lift spreads the same colour over more brightness (paler); some of
  // the colour comes back with it.
  const sat = gamma < 1 ? 1 + (1 - gamma) * SAT_BACK : 1;
  return { gamma, du, dv, pull, sat };
}

/** One colour (0-1 RGB) through the correction (as correctionFilter does it). */
export function correctColour(params, r, g, b) {
  if (!params) return [r, g, b];
  let [y, cb, cr] = toYcc(r, g, b);
  const x = clamp(y, 0, 1);
  y = Math.max(0, Math.pow(x, params.gamma) - (params.pull ?? 0) * Math.pow(1 - x, 3));
  cb = (cb + params.du) * (params.sat ?? 1);
  cr = (cr + params.dv) * (params.sat ?? 1);
  return toRgb(y, cb, cr).map((v) => clamp(v, 0, 1));
}

/** The speaker's skin colours after the correction (for checking LUTs on them), or null. */
export function correctedSkin(s) {
  if (!s?.skin?.samples?.length) return null;
  const p = correctionParams(s);
  return s.skin.samples.map(([r, g, b]) => correctColour(p, r, g, b));
}

/**
 * The correction for footage measured as `s` (analyzeColour) as an ffmpeg
 * filter, or null when it's already right: a gamma curve on luma (black
 * stays black, white stays white: nothing clips) and a chroma shift, kept
 * within video levels.
 */
export function correctionFilter(s) {
  const p = correctionParams(s);
  if (!p) return null;
  const parts = [];
  if (Math.abs(p.gamma - 1) >= 0.02) {
    // y^gamma, less the black point's lift fading out toward white.
    const x = "clip((val-16)/219,0,1)";
    parts.push(
      `lutyuv=y='16+219*max(0,pow(${x},${num(p.gamma)})-${num(p.pull ?? 0)}*pow(1-${x},3))'`,
    );
  }
  // Cb/Cr are 224 levels wide in 8-bit video.
  const du = num(p.du * 224);
  const dv = num(p.dv * 224);
  const k = num(p.sat ?? 1);
  if (Math.abs(du) >= 0.4 || Math.abs(dv) >= 0.4 || Math.abs(k - 1) >= 0.01) {
    // (shifted, then scaled round the middle: as correctColour does)
    const ch = (d) => `clip(128+(val+${d}-128)*${k},16,240)`;
    parts.push(`lutyuv=u='${ch(du)}':v='${ch(dv)}'`);
  }
  return parts.length ? parts.join(",") : null;
}
