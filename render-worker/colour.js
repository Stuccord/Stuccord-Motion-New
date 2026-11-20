// Automatic colour correction (every export): the footage is measured, then
// set right before the look's grade goes on top, the way a colourist starts
// every grade with a technical correction.
//
//   exposure  the mids lifted or lowered toward a talking head's usual level
//   contrast  a flat or harsh picture brought toward a normal spread
//   cast      an orange, green or blue cast pulled halfway back to neutral
//             (halfway: in a talking head skin fills the frame, and a full
//             grey-world correction would turn skin grey)
//
// Measured on a real phone take: average luma 104, spread 27-187, a warm
// cast (V +5.6, U -2.1), flat colour.

import { spawn } from "child_process";
import { limitThreads } from "./threads.js";

/** Where the average luma is brought (8-bit video levels, 16-235). */
const TARGET_Y = 112;
/** The 10th-90th percentile luma spread a normal picture has. */
const TARGET_SPREAD = 165;
/** How much of a colour cast is taken out. */
const CAST_SHARE = 0.5;
/** Most the cast correction moves a chroma channel (8-bit levels). */
const MAX_CAST = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => Number(v.toFixed(3));

/**
 * The footage's average levels over the video (a frame a second, small):
 * { y, low, high, u, v } in 8-bit video levels, or null when it can't be read.
 */
export function analyzeColour(ffmpegPath, file) {
  const args = limitThreads([
    "-hide_banner", "-nostats", "-v", "error",
    "-i", file, "-an",
    "-vf", "fps=1,scale=192:-2,signalstats,metadata=print:file=-",
    "-f", "null", "-",
  ]);
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "ignore"] });
    const sums = {};
    const counts = {};
    let carry = "";
    child.stdout.on("data", (d) => {
      const lines = (carry + d.toString()).split("\n");
      carry = lines.pop();
      for (const line of lines) {
        const m = /lavfi\.signalstats\.(YAVG|YLOW|YHIGH|UAVG|VAVG)=([\d.]+)/.exec(line);
        if (!m) continue;
        sums[m[1]] = (sums[m[1]] ?? 0) + Number(m[2]);
        counts[m[1]] = (counts[m[1]] ?? 0) + 1;
      }
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const avg = (k) => (counts[k] ? sums[k] / counts[k] : NaN);
      const s = { y: avg("YAVG"), low: avg("YLOW"), high: avg("YHIGH"), u: avg("UAVG"), v: avg("VAVG") };
      resolve(Object.values(s).every(Number.isFinite) ? s : null);
    });
  });
}

/**
 * The correction for footage measured as `s` (analyzeColour) as an ffmpeg
 * filter, or null when it's already right. Gentle by design: it can't see
 * what's in the picture, so it never moves anything far.
 */
export function correctionFilter(s) {
  if (!s) return null;
  // Too dark or almost black (a title card, a screen recording): leave it.
  if (s.y < 30 || s.high - s.low < 40) return null;
  const norm = (y) => clamp((y - 16) / 219, 0.02, 0.98);
  // eq's gamma brightens above 1 (out = in^(1/gamma); checked: a 0x60 grey
  // reads 98 at gamma 1 and 115 at 1.2), so this one brings the average to
  // the target.
  const gamma = clamp(Math.log(norm(s.y)) / Math.log(norm(TARGET_Y)), 0.85, 1.25);
  const contrast = clamp(TARGET_SPREAD / (s.high - s.low), 0.92, 1.15);
  const du = clamp((128 - s.u) * CAST_SHARE, -MAX_CAST, MAX_CAST);
  const dv = clamp((128 - s.v) * CAST_SHARE, -MAX_CAST, MAX_CAST);
  const parts = [];
  if (Math.abs(gamma - 1) > 0.02 || Math.abs(contrast - 1) > 0.02) {
    parts.push(`eq=gamma=${num(gamma)}:contrast=${num(contrast)}`);
  }
  if (Math.abs(du) >= 0.5 || Math.abs(dv) >= 0.5) {
    parts.push(`lutyuv=u='clip(val+${num(du)},16,240)':v='clip(val+${num(dv)},16,240)'`);
  }
  return parts.length ? parts.join(",") : null;
}
