// The looks (styles): each restyles every graphic and sets the video's
// finish to match - the colour grade, film grain, vignette and black bars,
// how tight, how often and how the camera angles change, and the captions'
// style. Shared by the editor preview and, mirrored in
// render-worker/motion.js (LOOK_FINISH), the export. No app imports: the
// worker bundles src/motion on its own.

export const MOTION_LOOK_IDS = [
  "glass",
  "paper",
  "minimal",
  "film",
  "saas",
  "docu",
  "cine3d",
] as const;
export type MotionLookId = (typeof MOTION_LOOK_IDS)[number];

/** A colour channel's curve: its output at inputs 0, 0.25, 0.5, 0.75 and 1. */
export type Curve = [number, number, number, number, number];

export type LookFinish = {
  /**
   * The footage's colour (graphics and captions stay as drawn): per-channel
   * curves, then saturation and contrast; null: as filmed.
   */
  grade: {
    saturation: number;
    contrast: number;
    curves?: { r: Curve; g: Curve; b: Curve };
  } | null;
  /** Film grain over the whole picture, 0 (none) to 1. */
  grain: number;
  /** Edges gently darkened. */
  vignette: boolean;
  /** Thin black bars top and bottom (barHeight). */
  bars: boolean;
  /** How much tighter the close camera angle is. */
  angleClose: number;
  /** Shot lengths: normal 5-10 s, calm 7-12 s, slow 8-14 s (shorter in the first minute). */
  pace: "normal" | "calm" | "slow";
  /** "cut": switch straight to the close framing; "push": ease slowly in over the shot. */
  angleMove: "cut" | "push";
  /** "bold": heavy words with an outline; "clean": lighter words on a soft shadow. */
  captions: "bold" | "clean";
};

/**
 * The Motion Explainer look's grade: punchy: rich colour and crisp, bright
 * highlights, with the shadows left alone so a face (darker skin most of
 * all) keeps its filmed level (render-worker/motion.js has the same
 * numbers). The owner's pick of five options tried on a real phone take.
 */
const EXPLAINER_GRADE: NonNullable<LookFinish["grade"]> = {
  saturation: 1.24,
  contrast: 1.04,
  curves: {
    r: [0, 0.255, 0.51, 0.81, 1],
    g: [0, 0.255, 0.51, 0.81, 1],
    b: [0, 0.26, 0.51, 0.805, 1],
  },
};

const STANDARD: LookFinish = {
  grade: null,
  grain: 0,
  vignette: false,
  bars: false,
  angleClose: 1.3,
  pace: "normal",
  angleMove: "cut",
  captions: "bold",
};

export const LOOK_FINISH: Record<MotionLookId, LookFinish> = {
  glass: { ...STANDARD, grade: EXPLAINER_GRADE },
  paper: STANDARD,
  // Quiet: softer colour, gentle and slower camera moves, clean captions.
  minimal: {
    ...STANDARD,
    grade: { saturation: 0.82, contrast: 1.06 },
    angleClose: 1.15,
    pace: "calm",
    captions: "clean",
  },
  // Film: teal shadows and warm skin, grain, a vignette, thin black bars,
  // and slow push-ins instead of switches.
  film: {
    grade: {
      saturation: 1.05,
      contrast: 1.08,
      curves: {
        r: [0, 0.22, 0.5, 0.79, 1],
        g: [0, 0.25, 0.5, 0.76, 0.98],
        b: [0.04, 0.29, 0.5, 0.7, 0.92],
      },
    },
    grain: 0.5,
    vignette: true,
    bars: true,
    angleClose: 1.12,
    pace: "slow",
    angleMove: "push",
    captions: "clean",
  },
  // SaaS: bright and clean - a touch more colour and contrast, gentle close
  // shots at the normal pace, clean captions.
  saas: {
    ...STANDARD,
    grade: { saturation: 1.06, contrast: 1.04 },
    angleClose: 1.2,
    captions: "clean",
  },
  // Documentary: calm and true to life - gentle colour, slow push-ins, clean
  // captions, so the drawn scenes carry the story.
  docu: {
    ...STANDARD,
    grade: { saturation: 0.92, contrast: 1.04 },
    angleClose: 1.15,
    pace: "calm",
    angleMove: "push",
    captions: "clean",
  },
  // 3D Cinematic: deeper contrast, rich reds and cool shadows, a vignette,
  // slow push-ins.
  cine3d: {
    grade: {
      saturation: 1.1,
      contrast: 1.12,
      curves: {
        r: [0, 0.24, 0.52, 0.8, 1],
        g: [0, 0.23, 0.49, 0.76, 0.98],
        b: [0.03, 0.27, 0.5, 0.74, 0.95],
      },
    },
    grain: 0.2,
    vignette: true,
    bars: false,
    angleClose: 1.15,
    pace: "calm",
    angleMove: "push",
    captions: "clean",
  },
};

/** Looks that draw metaphor scenes; in the others a metaphor shows as a key line. */
export const METAPHOR_LOOKS: ReadonlySet<MotionLookId> = new Set(["docu", "cine3d"]);

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

/** The id of the preview's SVG filter holding a look's curves (FinishOverlay draws it). */
export const GRADE_FILTER_ID = "sm-look-curves";

/**
 * The grade as a CSS filter for the preview: the curves (an SVG filter), then
 * saturation and contrast. The export uses ffmpeg's curves and eq the same way.
 */
export function gradeCss(finish: LookFinish): string | undefined {
  const g = finish.grade;
  if (!g) return undefined;
  return `${g.curves ? `url(#${GRADE_FILTER_ID}) ` : ""}saturate(${g.saturation}) contrast(${g.contrast})`;
}

/**
 * The black bars' height in pixels for a frame (even, as the video's colour
 * needs): thinner on tall videos, where every pixel counts.
 */
export function barHeight(width: number, height: number): number {
  const share = height > width ? 0.05 : height === width ? 0.07 : 0.1;
  return Math.round((height * share) / 2) * 2;
}
