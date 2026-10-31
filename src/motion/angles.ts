// Camera angles: the "second camera" of a one-camera talking head. The
// picture switches between the full shot (wide) and a tighter crop on the
// speaker (close) every 5-10 seconds, faster in the first minute, always on
// a pause or a sentence end so a cut never lands mid-word (docs/style-
// research/00-style-guide.md §6). Worked out from the words alone, the same
// way here and in render-worker/motion.js (closeShots), so the preview and
// the export cut in the same places. No app imports: the worker bundles
// src/motion on its own.

/** How much tighter the close framing is (the standard looks; see looks.ts). */
export const ANGLE_CLOSE = 1.3;
/** Where the zoom centres when the speaker hasn't been found: the upper middle. */
export const DEFAULT_ANGLE_CENTER = { x: 0.5, y: 0.4 };

const FPS = 30;
/** Shot lengths (s): in the first minute, and after it; "calm" and "slow" looks cut less often. */
const HOOK_S = 60;
const PACES = {
  normal: { hookMin: 3.5, hookMax: 7, min: 5, max: 10 },
  calm: { hookMin: 5, hookMax: 9, min: 7, max: 12 },
  slow: { hookMin: 6, hookMax: 10, min: 8, max: 14 },
} as const;
export type AnglePace = keyof typeof PACES;
/** A pause this long (ms) is a good place to cut. */
const PAUSE_MS = 350;
/** Close shots shorter than this (frames) after the gaps are taken out are dropped. */
const MIN_SHOT = 30;

export type AngleWord = { text: string; startMs: number; endMs: number };
/** A close shot: from its first frame up to (not including) `to`. */
export type CloseShot = { from: number; to: number };

const frameOf = (ms: number) => Math.round((ms / 1000) * FPS);

/**
 * The close shots for a video: cuts on pauses and sentence ends, alternating
 * wide (first) and close. `blocked` are stretches that stay wide (frames:
 * zooms, which already push in, and Notes pages, where the speaker moves
 * aside).
 */
export function closeShots(
  words: AngleWord[],
  blocked: [number, number][],
  pace: AnglePace = "normal",
): CloseShot[] {
  const { hookMin, hookMax, min: laterMin, max: laterMax } = PACES[pace] ?? PACES.normal;
  const list = [...words]
    .filter((w) => Number.isFinite(w.startMs))
    .sort((a, b) => a.startMs - b.startMs);
  if (list.length < 2) return [];
  // Each place a cut could go, with whether it's a natural one.
  const cuts: { ms: number; natural: boolean }[] = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const w = list[i];
    const gap = w.startMs - prev.endMs;
    const natural = /[.!?…]["'”’)]*$/.test(prev.text.trim()) || gap >= PAUSE_MS;
    // In the gap before the word, so the cut never clips its start.
    cuts.push({ ms: gap > 0 ? prev.endMs + gap / 2 : w.startMs, natural });
  }
  const startMs = list[0].startMs;
  const endMs = list[list.length - 1].endMs;
  const shots: CloseShot[] = [];
  let last = startMs;
  let close = false;
  for (const c of cuts) {
    const len = (c.ms - last) / 1000;
    const hook = c.ms - startMs < HOOK_S * 1000;
    const min = hook ? hookMin : laterMin;
    const max = hook ? hookMax : laterMax;
    // A natural place once the shot is long enough; any word once it's too long.
    if ((c.natural && len >= min) || len >= max) {
      if (close) shots.push({ from: frameOf(last), to: frameOf(c.ms) });
      close = !close;
      last = c.ms;
    }
  }
  if (close) shots.push({ from: frameOf(last), to: frameOf(endMs) + 10 });
  return withoutBlocked(shots, blocked);
}

/** The shots with the blocked stretches taken out (short leftovers dropped). */
function withoutBlocked(shots: CloseShot[], blocked: [number, number][]): CloseShot[] {
  let out = shots;
  for (const [a, b] of blocked) {
    const next: CloseShot[] = [];
    for (const s of out) {
      if (b <= s.from || a >= s.to) {
        next.push(s);
        continue;
      }
      if (a > s.from) next.push({ from: s.from, to: a });
      if (b < s.to) next.push({ from: b, to: s.to });
    }
    out = next;
  }
  return out.filter((s) => s.to - s.from >= MIN_SHOT);
}

/**
 * How much the angle tightens the picture at a frame: 1 wide, `close` in a
 * close shot - straight away ("cut"), or easing in over the shot ("push").
 */
export function angleAt(
  shots: CloseShot[],
  frame: number,
  close = ANGLE_CLOSE,
  move: "cut" | "push" = "cut",
): number {
  const s = shots.find((x) => frame >= x.from && frame < x.to);
  if (!s) return 1;
  return move === "push" ? 1 + ((close - 1) * (frame - s.from)) / (s.to - s.from) : close;
}
