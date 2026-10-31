// Graphics behind the speaker (stage 6): while one is on screen the room
// darkens and softly blurs, the graphic is drawn over it, and the speaker,
// cut out of the picture by an AI person mask, stays in front. Shared by the
// editor's preview; render-worker/motion.js mirrors it for the export.

import type { PlacedGraphic } from "./timing";

/** How long the room takes to darken and to come back (frames at 30 fps). */
export const BEHIND_FADE_FRAMES = 9;
/** How much darker the room gets (0-1). */
export const BEHIND_DARKEN = 0.45;
/** How much the room blurs, as a share of the frame's height. */
export const BEHIND_BLUR = 0.006;

/** How long a stretch's fades are (frames): BEHIND_FADE_FRAMES, less for a short one. */
export function behindFade(range: [number, number]): number {
  return Math.min(BEHIND_FADE_FRAMES, (range[1] - range[0]) / 3);
}

/**
 * How far into "behind" the picture is at a frame: 0 (normal) to 1 (room
 * dark and blurred), fading in at the start of a stretch of behind graphics
 * and out before its end (straight fades, like the export's).
 */
export function behindStrength(graphics: PlacedGraphic[], frame: number): number {
  for (const r of behindRanges(graphics)) {
    if (frame < r[0] || frame >= r[1]) continue;
    const fade = behindFade(r);
    return Math.min(1, (frame - r[0]) / fade, (r[1] - frame) / fade);
  }
  return 0;
}

/** Frame stretches with a behind graphic on screen (inclusive start, exclusive end). */
export function behindRanges(graphics: PlacedGraphic[]): [number, number][] {
  const spans = graphics
    .filter((g) => g.behind && g.to > g.from)
    .map((g): [number, number] => [g.from, g.to])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// The mask's soft edge: below LOW is room, above HIGH is the person.
// Only fairly sure pixels: a lower start let a ring of the bright,
// unblurred room show around the speaker.
const MASK_LOW = 0.5;
const MASK_HIGH = 0.8;

/** The person mask's opacity (0-255) from the model's confidence (0-1). */
export function maskAlpha(confidence: number): number {
  const t = Math.min(1, Math.max(0, (confidence - MASK_LOW) / (MASK_HIGH - MASK_LOW)));
  return Math.round(t * t * (3 - 2 * t) * 255);
}
