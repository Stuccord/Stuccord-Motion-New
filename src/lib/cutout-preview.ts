// The editor preview's cut-out of the speaker for graphics behind them, made
// by the render worker (render-worker/pixelcut.js pixelcutCutout, the same
// matte as the export) instead of the browser's rough one. Each is one
// stretch of an uploaded clip, in the clip's own time, saved next to it in
// raw-clips as `<path>.cutout.<fromMs>-<toMs>.mp4`: the picture on the left
// half, its matte (white: the speaker) on the right. Asked for when a
// stretch first appears (the plan is made, a graphic is put behind), so
// only the stretches really used are paid for; until it's there the preview
// keeps its own cut-out.

import { layoutTrack } from "@/lib/timeline-layout";
import { isImageFilename } from "@/lib/media-kind";

/** A stretch of one clip's own time that needs the speaker cut out (ms). */
export type CutoutStretch = { path: string; fromMs: number; toMs: number };
/** A saved cut-out, with a link to play it. */
export type PreviewCutout = CutoutStretch & { url: string };

/** Stretches are asked for in steps of this (ms), a little wider, so a small nudge reuses one. */
export const CUTOUT_STEP_MS = 500;
/** Longest piece asked for at once (ms); a longer stretch is asked for in pieces. */
export const CUTOUT_PIECE_MS = 30_000;

const NAME = /\.cutout\.(\d+)-(\d+)\.mp4$/;

/** A saved cut-out's path. */
export const cutoutPath = (s: CutoutStretch) => `${s.path}.cutout.${s.fromMs}-${s.toMs}.mp4`;

/** A path that is a cut-out (never given a preview copy or a cut-out of its own). */
export const isCutoutPath = (path: string) => NAME.test(path);

/** The stretch a saved cut-out's file name holds, or null. */
export function parseCutoutName(name: string): { fromMs: number; toMs: number } | null {
  const m = NAME.exec(name);
  return m ? { fromMs: Number(m[1]), toMs: Number(m[2]) } : null;
}

/** The stretch widened onto CUTOUT_STEP_MS steps (a quarter step either side), in pieces. */
export function cutoutPieces(s: CutoutStretch): CutoutStretch[] {
  const step = CUTOUT_STEP_MS;
  const from = Math.max(0, Math.floor((s.fromMs - step / 4) / step) * step);
  const to = Math.ceil((s.toMs + step / 4) / step) * step;
  const out: CutoutStretch[] = [];
  for (let a = from; a < to; a += CUTOUT_PIECE_MS) {
    out.push({ path: s.path, fromMs: a, toMs: Math.min(to, a + CUTOUT_PIECE_MS) });
  }
  return out;
}

/** Whether `c` holds all of `s`. */
export const covers = (c: CutoutStretch, s: CutoutStretch) =>
  c.path === s.path && c.fromMs <= s.fromMs && c.toMs >= s.toMs;

type Clip = {
  id: string;
  filename: string;
  storage_path: string;
  start_ms?: number | null;
  trim_in_ms?: number | null;
};

/**
 * What each video showing during the behind stretches (timeline ms) shows
 * of its own file then: the stretches to cut out, joined per file.
 */
export function cutoutStretches<C extends Clip>(
  aRoll: C[],
  bRoll: C[],
  lengthMs: (c: C) => number,
  behindMs: [number, number][],
): CutoutStretch[] {
  if (!behindMs.length) return [];
  const tracks = aRoll.length ? [aRoll, bRoll] : [bRoll];
  const found: CutoutStretch[] = [];
  for (const clips of tracks) {
    const { starts } = layoutTrack(clips, lengthMs);
    for (const c of clips) {
      if (isImageFilename(c.filename) || !c.storage_path) continue;
      const start = starts.get(c.id) ?? 0;
      const end = start + lengthMs(c);
      const trimIn = Math.max(0, c.trim_in_ms ?? 0);
      for (const [a, b] of behindMs) {
        const from = Math.max(a, start);
        const to = Math.min(b, end);
        if (to - from < 40) continue;
        found.push({
          path: c.storage_path,
          fromMs: trimIn + from - start,
          toMs: trimIn + to - start,
        });
      }
    }
  }
  // Overlapping or touching stretches of one file become one.
  found.sort((x, y) => (x.path === y.path ? x.fromMs - y.fromMs : x.path < y.path ? -1 : 1));
  const out: CutoutStretch[] = [];
  for (const s of found) {
    const last = out[out.length - 1];
    if (last && last.path === s.path && s.fromMs <= last.toMs + 100)
      last.toMs = Math.max(last.toMs, s.toMs);
    else out.push({ ...s });
  }
  return out.map((s) => ({ ...s, fromMs: Math.round(s.fromMs), toMs: Math.round(s.toMs) }));
}
