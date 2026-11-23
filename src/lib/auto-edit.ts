// Auto edit (docs/auto-edit-plan.md): what the automatic edit keeps of the
// AI's graphics plan, and which story pictures it makes. Pure functions, so
// the make page and tests share them.
//
// The automatic edit leaves out graphics that need the user's own things:
// the speaker's cartoon (needs consent and a photo of them), card streams and
// profiles (need their pictures). Story scenes with the speaker are made as a
// person who fits the scene. Only the first AUTO_PICTURES story scenes get a
// picture (the owner's cost cap); the rest are dropped, and a story without
// any picture is dropped. In the 3D Cinematic look a metaphor's object
// picture counts toward the same cap; one left without a picture shows its
// glowing words alone.

import {
  mainSegments,
  type MotionElement,
  type MotionPlan,
  type PlanClip,
} from "@/lib/motion-plan";
import type { TranscriptWord } from "@/lib/captions";
import { OBJECT_PICTURE_LOOKS } from "@/motion/looks";

/** Most AI pictures one automatic edit makes. */
export const AUTO_PICTURES = 3;

/** Graphic types the automatic edit leaves out. */
const LEFT_OUT = new Set<MotionElement["type"]>(["cartoon", "stream", "profile"]);

/** A story scene's picture to make: which graphic and scene, and the scene to match. */
export type PictureJob = {
  elementId: string;
  index: number;
  prompt: string;
  /** The story's first scene, when this is a later one (its picture is the reference). */
  matchIndex: number | null;
  /** A story scene (cinematic) or a metaphor's object (3D Cinematic). */
  style: "cinematic" | "object";
  /** The speaker is in the picture (their look is added to its prompt). */
  speaker: boolean;
};

/** The graphics whose pictures the automatic edit makes: stories, and metaphors in the 3D Cinematic look. */
function pictured(plan: MotionPlan): MotionElement[] {
  return plan.elements.filter(
    (e) =>
      (e.type === "story" ||
        (e.type === "metaphor" && OBJECT_PICTURE_LOOKS.has(plan.look ?? ""))) &&
      e.scenes?.length,
  );
}

/** The plan without the graphics the automatic edit leaves out, and with no speaker scenes. */
export function prepareAutoPlan(plan: MotionPlan): MotionPlan {
  return {
    ...plan,
    elements: plan.elements
      .filter((e) => !LEFT_OUT.has(e.type))
      .map((e) =>
        e.type === "story" && e.scenes
          ? { ...e, scenes: e.scenes.map((sc) => ({ ...sc, speaker: false })) }
          : e,
      ),
  };
}

/**
 * The pictures still to make, in video order, up to the cap (counting the
 * ones already made); a story's first scene comes before its later ones.
 */
export function pictureJobs(plan: MotionPlan, cap = AUTO_PICTURES): PictureJob[] {
  const stories = pictured(plan);
  const made = stories.reduce((n, e) => n + (e.scenes ?? []).filter((sc) => sc.image).length, 0);
  const jobs: PictureJob[] = [];
  for (const e of stories) {
    const scenes = e.scenes ?? [];
    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].image) continue;
      if (made + jobs.length >= cap) return jobs;
      if (scenes[i].prompt.trim().length < 3) continue;
      jobs.push({
        elementId: e.id,
        index: i,
        prompt: scenes[i].prompt,
        // Matched to the first scene only when it shows the same person
        // (the speaker in both, or someone else in both).
        matchIndex:
          i > 0 && (scenes[0].speaker === true) === (scenes[i].speaker === true) ? 0 : null,
        speaker: scenes[i].speaker === true,
        style: e.type === "metaphor" ? "object" : "cinematic",
      });
    }
  }
  return jobs;
}

/** Sets one scene's picture. */
export function withPicture(plan: MotionPlan, elementId: string, index: number, path: string) {
  return {
    ...plan,
    elements: plan.elements.map((e) =>
      e.id === elementId && e.scenes?.[index]
        ? {
            ...e,
            scenes: e.scenes.map((sc, i) =>
              i === index ? { ...sc, image: { path, source: "ai" as const } } : sc,
            ),
          }
        : e,
    ),
  };
}

/** A story picture to bring to life (an AI clip made from it). */
export type ClipJob = { elementId: string; index: number; imagePath: string; prompt: string };

/**
 * The story pictures still to animate: every story scene with an AI picture
 * and no clip yet (story scenes only: metaphor objects and screens stay
 * still). In video order.
 */
export function clipJobs(plan: MotionPlan): ClipJob[] {
  return plan.elements.flatMap((e) =>
    e.type !== "story"
      ? []
      : (e.scenes ?? []).flatMap((sc, index) =>
          sc.image && sc.image.source === "ai" && !sc.image.clip && sc.prompt.trim().length >= 3
            ? [{ elementId: e.id, index, imagePath: sc.image.path, prompt: sc.prompt }]
            : [],
        ),
  );
}

/** Puts a scene's animated clip on its picture (only if the picture is still the same one). */
export function withClip(
  plan: MotionPlan,
  elementId: string,
  index: number,
  imagePath: string,
  clipPath: string,
): MotionPlan {
  return {
    ...plan,
    elements: plan.elements.map((e) =>
      e.id === elementId && e.scenes?.[index]?.image?.path === imagePath
        ? {
            ...e,
            scenes: e.scenes.map((sc, i) =>
              i === index && sc.image ? { ...sc, image: { ...sc.image, clip: clipPath } } : sc,
            ),
          }
        : e,
    ),
  };
}

/**
 * The plan as rendered: story scenes without a picture dropped, stories
 * without any dropped; a metaphor without its picture keeps its words (and
 * its drawn scene) but not the unmade picture.
 */
export function finishAutoPlan(plan: MotionPlan): MotionPlan {
  return {
    ...plan,
    elements: plan.elements.flatMap((e) => {
      if (e.type === "metaphor" && OBJECT_PICTURE_LOOKS.has(plan.look ?? "")) {
        return [{ ...e, scenes: (e.scenes ?? []).filter((sc) => sc.image) }];
      }
      if (e.type !== "story") return [e];
      const scenes = (e.scenes ?? []).filter((sc) => sc.image);
      return scenes.length ? [{ ...e, scenes }] : [];
    }),
  };
}

/** True when the plan still has graphics the automatic edit would change. */
export function needsAutoPictures(plan: MotionPlan): boolean {
  return plan.elements.some(
    (e) =>
      LEFT_OUT.has(e.type) ||
      (e.type === "story" && (e.scenes ?? []).some((sc) => !sc.image || sc.speaker)) ||
      (e.type === "metaphor" &&
        OBJECT_PICTURE_LOOKS.has(plan.look ?? "") &&
        (e.scenes ?? []).some((sc) => !sc.image)),
  );
}

// ---------- cutting the pauses ----------

/**
 * How the automatic edit cuts pauses: the editor's "Normal" Auto-cut (pauses
 * over 0.6 s, 0.15 s kept either side of the words), found from the
 * transcript's word times rather than the waveform.
 */
export const AUTO_CUT = { minPauseMs: 600, padMs: 150 } as const;
/** Fewer cut than this in a clip isn't worth splitting it. */
const MIN_CUT_MS = 300;
/** Most pieces one clip is cut into (the server's limit). */
const MAX_PIECES = 500;

export type ClipCut = { id: string; keep: { in_ms: number; out_ms: number }[] };

/**
 * The parts of each main-track clip to keep, with the pauses between words
 * (and the silence before the first word and after the last) cut out. A clip
 * with no words, or too little to cut, is left alone. Run before the graphics
 * are planned: cut pieces after the first get new clip ids. Running it again
 * on cut clips finds nothing more to cut.
 */
export function pauseCuts(
  clips: PlanClip[],
  transcripts: Map<string, TranscriptWord[]>,
  { minPauseMs, padMs } = AUTO_CUT,
): ClipCut[] {
  const out: ClipCut[] = [];
  for (const seg of mainSegments(clips)) {
    const clip = clips.find((c) => c.id === seg.clipId);
    const words = transcripts.get(seg.storagePath);
    if (!clip || !words?.length) continue;
    const from = seg.trimInMs;
    const to = seg.trimInMs + seg.durationMs;
    const fileEnd = clip.duration_ms ?? to;
    const inside = words
      .filter((w) => w.end_ms > from && w.start_ms < to && w.end_ms > w.start_ms)
      .sort((a, b) => a.start_ms - b.start_ms);
    if (!inside.length) continue;

    // Runs of speech: words closer together than a pause.
    const runs: { a: number; b: number }[] = [];
    for (const w of inside) {
      const last = runs[runs.length - 1];
      if (last && w.start_ms - last.b < minPauseMs) last.b = Math.max(last.b, w.end_ms);
      else runs.push({ a: w.start_ms, b: w.end_ms });
    }
    // Padded, kept inside the clip's part of its file, overlapping pads joined.
    const keep: { in_ms: number; out_ms: number }[] = [];
    for (const r of runs) {
      const a = Math.round(Math.max(from, r.a - padMs));
      const b = Math.round(Math.min(to, fileEnd, r.b + padMs));
      if (b - a < 50) continue;
      const last = keep[keep.length - 1];
      if (last && a <= last.out_ms) last.out_ms = Math.max(last.out_ms, b);
      else keep.push({ in_ms: a, out_ms: b });
    }
    if (!keep.length || keep.length > MAX_PIECES) continue;
    const kept = keep.reduce((n, k) => n + (k.out_ms - k.in_ms), 0);
    if (to - from - kept < MIN_CUT_MS) continue;
    out.push({ id: clip.id, keep });
  }
  return out;
}

// ---------- placing the B-roll ----------

/** B-roll in the automatic edit: after the opening, at most this long each, at least this long. */
export const AUTO_BROLL = { afterMs: 3000, maxMs: 4000, minMs: 1500, endGapMs: 500 } as const;

export type BrollClip = { id: string; trimInMs: number; lengthMs: number };
export type BrollPlace = { id: string; startMs: number; trimInMs: number; trimOutMs: number };

/**
 * Where the automatic edit puts B-roll clips (in their order): spread evenly
 * over the main video after the opening seconds, each cut to at most 4 s,
 * moved off moments a full-screen graphic already covers (it would hide
 * them; under one if there's no other room), never overlapping each other
 * or running past the main video. A clip that can't fit at all is left out
 * of the result (the caller leaves it as it is).
 */
export function placeBroll(
  clips: BrollClip[],
  mainEndMs: number,
  busy: { fromMs: number; toMs: number }[],
  { afterMs, maxMs, minMs, endGapMs } = AUTO_BROLL,
): BrollPlace[] {
  const lo = Math.min(afterMs, mainEndMs * 0.2);
  const hi = mainEndMs - endGapMs;
  if (!clips.length || hi - lo < minMs) return [];
  // Free stretches: the window minus full-screen graphics.
  let free = [{ a: lo, b: hi }];
  for (const s of [...busy].sort((x, y) => x.fromMs - y.fromMs)) {
    free = free.flatMap((f) =>
      s.toMs <= f.a || s.fromMs >= f.b
        ? [f]
        : [
            ...(s.fromMs - f.a >= minMs ? [{ a: f.a, b: s.fromMs }] : []),
            ...(f.b - s.toMs >= minMs ? [{ a: s.toMs, b: f.b }] : []),
          ],
    );
  }
  const out: BrollPlace[] = [];
  let cursor = lo;
  const step = (hi - lo) / clips.length;
  clips.forEach((c, i) => {
    const want = Math.min(maxMs, c.lengthMs);
    if (want < minMs * 0.5) return;
    // Aim for its even share of the video; take the first free room from there.
    const target = Math.max(cursor, lo + step * i + Math.max(0, step - want) / 2);
    for (const f of free) {
      if (f.b <= cursor) continue;
      // From its target, slid earlier (never before the last clip) to fit its full length.
      const start = Math.max(f.a, cursor, Math.min(target, f.b - want));
      const len = Math.min(want, f.b - start);
      if (len < Math.min(minMs, want)) continue;
      const startMs = Math.round(start);
      out.push({
        id: c.id,
        startMs,
        trimInMs: Math.round(c.trimInMs),
        trimOutMs: Math.round(c.trimInMs + len),
      });
      cursor = startMs + len;
      return;
    }
    // No free room left: under a graphic is still better than at the very start.
    const len = Math.min(want, hi - target);
    if (len >= Math.min(minMs, want)) {
      const startMs = Math.round(target);
      out.push({
        id: c.id,
        startMs,
        trimInMs: Math.round(c.trimInMs),
        trimOutMs: Math.round(c.trimInMs + len),
      });
      cursor = startMs + len;
    }
  });
  return out;
}
