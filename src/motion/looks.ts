// The looks (styles): each restyles every graphic and sets the video's
// finish to match - the colour grade, how tight and how often the camera
// angles cut, and the captions' style. Shared by the editor preview and,
// mirrored in render-worker/motion.js (LOOK_FINISH), the export. No app
// imports: the worker bundles src/motion on its own.

export const MOTION_LOOK_IDS = ["glass", "paper", "minimal"] as const;
export type MotionLookId = (typeof MOTION_LOOK_IDS)[number];

export type LookFinish = {
  /** The footage's colour (graphics and captions stay as drawn); null: as filmed. */
  grade: { saturation: number; contrast: number } | null;
  /** How much tighter the close camera angle is. */
  angleClose: number;
  /** Shot lengths: "normal" 5-10 s (3.5-7 in the first minute), "calm" 7-12 s (5-9). */
  pace: "normal" | "calm";
  /** "bold": heavy words with an outline; "clean": lighter words on a soft shadow. */
  captions: "bold" | "clean";
};

const STANDARD: LookFinish = { grade: null, angleClose: 1.3, pace: "normal", captions: "bold" };

export const LOOK_FINISH: Record<MotionLookId, LookFinish> = {
  glass: STANDARD,
  paper: STANDARD,
  // Quiet: softer colour, gentle and slower camera moves, clean captions.
  minimal: {
    grade: { saturation: 0.82, contrast: 1.06 },
    angleClose: 1.15,
    pace: "calm",
    captions: "clean",
  },
};

/** A look's finish (unknown looks: the standard one). */
export function lookFinish(look: string | null | undefined): LookFinish {
  return Object.hasOwn(LOOK_FINISH, look ?? "") ? LOOK_FINISH[look as MotionLookId] : STANDARD;
}

/** The look a new plan starts with: the project's style when it's a look, else glass. */
export function defaultLook(stylePreset: string | null | undefined): MotionLookId {
  return (MOTION_LOOK_IDS as readonly string[]).includes(stylePreset ?? "")
    ? (stylePreset as MotionLookId)
    : "glass";
}

/** The grade as a CSS filter for the preview (the export uses ffmpeg's eq the same way). */
export function gradeCss(finish: LookFinish): string | undefined {
  return finish.grade
    ? `saturate(${finish.grade.saturation}) contrast(${finish.grade.contrast})`
    : undefined;
}
