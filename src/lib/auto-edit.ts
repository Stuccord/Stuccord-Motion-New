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

import type { MotionElement, MotionPlan } from "@/lib/motion-plan";

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
};

/** The graphics whose pictures the automatic edit makes: stories, and metaphors in the 3D Cinematic look. */
function pictured(plan: MotionPlan): MotionElement[] {
  return plan.elements.filter(
    (e) =>
      (e.type === "story" || (e.type === "metaphor" && plan.look === "cine3d")) &&
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
        matchIndex: i > 0 ? 0 : null,
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

/**
 * The plan as rendered: story scenes without a picture dropped, stories
 * without any dropped; a metaphor without its picture keeps its words (and
 * its drawn scene) but not the unmade picture.
 */
export function finishAutoPlan(plan: MotionPlan): MotionPlan {
  return {
    ...plan,
    elements: plan.elements.flatMap((e) => {
      if (e.type === "metaphor" && plan.look === "cine3d") {
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
        plan.look === "cine3d" &&
        (e.scenes ?? []).some((sc) => !sc.image)),
  );
}
