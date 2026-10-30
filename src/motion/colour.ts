// The colours of the set behind the speaker, read from a video's first
// frames (docs/style-research: the graphics take the colour of the
// background light). Pure: the editor hands it the frames' pixels
// (src/lib/footage-colours.ts) and keeps what it finds with the plan.

/** One frame's pixels, RGBA (like canvas ImageData). */
export type Pixels = { data: ArrayLike<number>; width: number; height: number };

// Hue buckets of 15 degrees.
const BINS = 24;
// Picked colours are at least this many buckets apart (30 degrees).
const MIN_BIN_GAP = 2;
// A colour must have at least this share of the strongest colour's weight.
const MIN_SHARE = 0.12;
// With less colour than this (weight per pixel), the set is grey: no colours.
const MIN_COLOUR_PER_PIXEL = 0.02;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
}

/**
 * Up to `max` colours of the set, strongest first (#RRGGBB), or none when
 * the set is grey. The middle of the picture (where the speaker usually is)
 * and skin tones count for less, so the background light wins.
 */
export function footageColours(frames: Pixels[], max = 4): string[] {
  const w = new Float64Array(BINS);
  const sr = new Float64Array(BINS);
  const sg = new Float64Array(BINS);
  const sb = new Float64Array(BINS);
  let pixels = 0;
  for (const { data, width, height } of frames) {
    for (let y = 0; y < height; y++) {
      const fy = y / height;
      for (let x = 0; x < width; x++) {
        pixels++;
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);
        if (s < 0.25 || l < 0.12 || l > 0.85) continue;
        const fx = x / width;
        const middle = fx > 0.3 && fx < 0.7 && fy > 0.2 ? 0.3 : 1;
        const skin = h >= 5 && h <= 45 && s < 0.65 ? 0.4 : 1;
        const weight = s * (1 - Math.abs(l - 0.5)) * middle * skin;
        const bin = Math.floor(h / (360 / BINS)) % BINS;
        w[bin] += weight;
        sr[bin] += r * weight;
        sg[bin] += g * weight;
        sb[bin] += b * weight;
      }
    }
  }
  const total = w.reduce((a, v) => a + v, 0);
  if (pixels === 0 || total / pixels < MIN_COLOUR_PER_PIXEL) return [];

  const order = [...w.keys()].sort((a, b) => w[b] - w[a]);
  const top = w[order[0]];
  const picked: number[] = [];
  for (const bin of order) {
    if (picked.length >= max || w[bin] < top * MIN_SHARE) break;
    const near = picked.some((p) => {
      const d = Math.abs(p - bin);
      return Math.min(d, BINS - d) < MIN_BIN_GAP;
    });
    if (!near) picked.push(bin);
  }
  // Each as a clear, mid-light version of its average colour.
  const out = picked.map((bin) => {
    const [h, s, l] = rgbToHsl(sr[bin] / w[bin], sg[bin] / w[bin], sb[bin] / w[bin]);
    return hslToHex(h, clamp(s, 0.55, 0.95), clamp(l, 0.45, 0.65));
  });
  return [...new Set(out)];
}
