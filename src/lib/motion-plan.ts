// Motion Explainer plans: the graphics the AI picks for a video, shared by
// the server (planning), the editor (showing and, later, editing them) and
// the export (stage 3).
//
// Each graphic is anchored to the transcript words that trigger it (a clip
// and a word index in that clip's source transcript), not to a time, so it
// moves with its words when clips are trimmed, split or reordered, the same
// way captions do. A graphic whose words are trimmed away isn't shown.
//
// The AI answers in a simpler "draft" shape that points at word numbers in
// the list it was given; draftsToElements turns that into anchored graphics
// and drops anything that doesn't make sense. Schemas use zod v4 because the
// Anthropic SDK builds its structured-output format from zod v4.

import { z } from "zod/v4";
import { SKETCH_PATHS, type SketchId } from "@/motion/sketches";
import { MOTION_LOOK_IDS } from "@/motion/looks";
import { layoutTrack } from "@/lib/timeline-layout";
import {
  placeTranscripts,
  type CaptionSegment,
  type TimelineWord,
  type TranscriptWord,
} from "@/lib/captions";

export const MOTION_STYLE = "motion-explainer";

/** The Notes page's built-in sketches (src/motion/sketches.ts). */
export const SKETCH_IDS = Object.keys(SKETCH_PATHS) as [SketchId, ...SketchId[]];
/** A Notes page's lines: at least two, at most this many; and their length. */
export const MAX_NOTE_LINES = 8;
const MAX_NOTE_TEXT = 60;

/** The graphics' looks (stage 10): every graphic restyled at once. */
export const MOTION_LOOKS = MOTION_LOOK_IDS;
export type MotionLook = (typeof MOTION_LOOKS)[number];

export const ELEMENT_TYPES = [
  "keyline",
  "counter",
  "list",
  "card",
  "compare",
  "story",
  "cartoon",
  "steps",
  "loop",
  "coins",
  "stream",
  "profile",
  "notes",
  "chapter",
  "label",
  "cta",
  "zoom",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const ELEMENT_LABEL: Record<ElementType, string> = {
  keyline: "Key line",
  counter: "Number",
  list: "List",
  card: "Card",
  compare: "A vs B",
  story: "Story",
  cartoon: "Cartoon",
  steps: "Steps",
  loop: "Loop",
  coins: "Coins",
  stream: "Card stream",
  profile: "Social profile",
  notes: "Notes",
  chapter: "Chapter",
  label: "Label",
  cta: "Call to action",
  zoom: "Zoom",
};

/** Longest main text, and most graphics in one plan. */
const MAX_TEXT = 200;
const MAX_ELEMENTS = 300;
/** A story's scenes: at least two, at most this many. */
export const MAX_SCENES = 6;
/**
 * Types with pictured scenes: a story (2-6) and a cartoon of the speaker
 * acting a moment out (exactly one, always with the speaker).
 */
export const SCENE_TYPES: ReadonlySet<ElementType> = new Set(["story", "cartoon"]);

/**
 * Types that show pictures (stored as scenes): the two above, plus a card
 * stream's pile of pictures (uploads or frames of the footage; the brand
 * logo lands last) and a social profile's photo and grid.
 */
export const PICTURE_TYPES: ReadonlySet<ElementType> = new Set([
  "story",
  "cartoon",
  "stream",
  "profile",
]);

/** Most pictures each type holds. */
export function maxScenes(type: ElementType): number {
  switch (type) {
    case "cartoon":
      return 1;
    case "stream":
      return MAX_STREAM;
    case "profile":
      return PROFILE_GRID + 1;
    default:
      return MAX_SCENES;
  }
}
/** A card stream's pictures, and a profile's grid photos (after its own photo). */
export const MAX_STREAM = 12;
export const PROFILE_GRID = 6;

/** A social profile's details, typed by the user (or what the speaker said). */
const ProfileDetails = z.object({
  handle: z.string().max(40),
  name: z.string().max(60),
  bio: z.string().max(150),
  posts: z.string().max(12),
  followers: z.string().max(12),
  following: z.string().max(12),
});
export type ProfileDetails = z.infer<typeof ProfileDetails>;
export const EMPTY_PROFILE: ProfileDetails = {
  handle: "",
  name: "",
  bio: "",
  posts: "",
  followers: "",
  following: "",
};

/** Most items each type shows (list items, steps, loop stops, coin labels...). */
export function maxItems(type: ElementType): number {
  switch (type) {
    case "compare":
      return 2;
    case "card":
      return 4;
    case "steps":
      return 5;
    case "loop":
      return 6;
    default:
      return 8;
  }
}

/** Longest word a loop's stop swaps to. */
const MAX_SWAP = 40;
/** Longest scene text on screen, and longest image description. */
const MAX_SCENE_TEXT = 80;
export const MAX_SCENE_PROMPT = 600;

/**
 * Types that can go behind the speaker (the person cut out in front of
 * them, the room darkened and blurred). Not the call to action (it sits
 * low, over the speaker's body), labels (small) or zooms.
 */
export const BEHIND_TYPES: ReadonlySet<ElementType> = new Set([
  "keyline",
  "counter",
  "list",
  "card",
  "compare",
  "chapter",
]);

export const CTA_KINDS = ["like", "subscribe", "comment", "link"] as const;
export const ZOOM_KINDS = ["in", "out"] as const;

const NumberValue = z.object({
  value: z.number(),
  /** Shown before the number, e.g. "$". */
  prefix: z.string(),
  /** Shown after it, e.g. "%", "K", " hours". */
  suffix: z.string(),
});

// ---------- what the AI returns ----------

/** One scene of a story: from a word on, an AI image with a few words on it. */
export const DraftScene = z.object({
  /** Number of the word the scene starts on. */
  from_word: z.number().int(),
  /** The words on screen (a few). */
  text: z.string(),
  /** One word or short phrase from `text` in the special font, or null. */
  emphasis: z.string().nullable(),
  /** What the image shows (no text in it). */
  prompt: z.string(),
  /** The speaker is in the picture (drawn as their cartoon). */
  speaker: z.boolean(),
});
export type DraftScene = z.infer<typeof DraftScene>;

export const DraftElement = z.object({
  type: z.enum(ELEMENT_TYPES),
  /** Number of the first word that triggers it, from the word list. */
  from_word: z.number().int(),
  /** Number of the last word it stays up for. */
  to_word: z.number().int(),
  /** The main text: the key line, card or chapter title, label, counter caption. */
  text: z.string(),
  /** One word or short phrase from `text` shown in the special font, or null. */
  emphasis: z.string().nullable(),
  /** List items, the two sides of a comparison, or a card's lines. */
  items: z.array(z.string()),
  number: NumberValue.nullable(),
  cta: z.enum(CTA_KINDS).nullable(),
  zoom: z.enum(ZOOM_KINDS).nullable(),
  /** Drawn behind the speaker (cut out in front of it). */
  behind: z.boolean(),
  /** A loop's stop (0-based) whose words change near the end, and to what; or null. */
  swap: z.object({ item: z.number().int(), text: z.string() }).nullable(),
  /** A Notes page's lines in order, each with an optional sketch; [] for other types. */
  lines: z.array(
    z.object({
      /** Number of the word the line is written on. */
      from_word: z.number().int(),
      /** The note (a few words). */
      text: z.string(),
      /** A sketch drawn beside it, or null. */
      sketch: z.enum(SKETCH_IDS).nullable(),
    }),
  ),
  /** A social profile's details, as far as they were said; null for other types. */
  profile: z
    .object({
      handle: z.string(),
      name: z.string(),
      bio: z.string(),
      posts: z.string(),
      followers: z.string(),
      following: z.string(),
    })
    .nullable(),
  /** A story's scenes in order, or a cartoon's one; [] for every other type. */
  scenes: z.array(DraftScene),
  /** Why this graphic, in a few words (shown to the user). */
  reason: z.string(),
});
export type DraftElement = z.infer<typeof DraftElement>;

export const DraftPlan = z.object({
  /** The transcript's language, as a short code like "en". */
  language: z.string(),
  elements: z.array(DraftElement),
});
export type DraftPlan = z.infer<typeof DraftPlan>;

// ---------- what's stored on the project ----------

const Anchor = z.object({
  clip_id: z.string().min(1).max(64),
  word_index: z.number().int().nonnegative(),
});
export type Anchor = z.infer<typeof Anchor>;

/** Story pictures' storage bucket, and a project's folder in it (by its owner). */
export const SCENE_BUCKET = "motion-images";
export const sceneImageFolder = (ownerId: string, projectId: string) => `${ownerId}/${projectId}/`;

/** A scene's picture in storage (bucket motion-images): made by the AI, uploaded, or a frame of the footage. */
const SceneImage = z.object({
  path: z.string().min(1).max(300),
  source: z.enum(["ai", "upload", "footage"]),
});
export type SceneImage = z.infer<typeof SceneImage>;

/**
 * The project's cartoon of its speaker (projects.motion_character, written
 * only by the server): made by the AI from a photo of them, with consent.
 */
export const SpeakerCartoon = z.object({
  /** The cartoon, in the project's folder of motion-images. */
  image: z.string().min(1).max(300),
  /** The photo it was made from, in the same folder. */
  photo: z.string().min(1).max(300),
  /** Whether the photo is a frame of the footage or an upload. */
  from: z.enum(["footage", "upload"]),
  /** Who confirmed they are the speaker or have their permission, and when. */
  consent_by: z.string().uuid(),
  consent_at: z.string(),
  made_at: z.string(),
});
export type SpeakerCartoon = z.infer<typeof SpeakerCartoon>;

/** The stored cartoon, or null when there's none (or it doesn't parse). */
export function parseSpeakerCartoon(raw: unknown): SpeakerCartoon | null {
  const r = SpeakerCartoon.safeParse(raw);
  return r.success ? r.data : null;
}

/** One line of a Notes page: written on a word, with an optional sketch. */
export const NoteLine = z.object({
  at: Anchor,
  text: z.string().max(MAX_NOTE_TEXT),
  sketch: z.enum(SKETCH_IDS).nullable(),
});
export type NoteLine = z.infer<typeof NoteLine>;

export const MotionScene = z.object({
  /** The word the scene starts on. */
  at: Anchor,
  text: z.string().max(MAX_SCENE_TEXT),
  emphasis: z.string().max(60).nullable(),
  /** What the AI image shows. */
  prompt: z.string().max(MAX_SCENE_PROMPT),
  /** The picture; null until it's made. */
  image: SceneImage.nullable(),
  /** The speaker is in the picture, drawn as the project's cartoon of them. */
  speaker: z.boolean().optional(),
});
export type MotionScene = z.infer<typeof MotionScene>;

export const MotionElement = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(ELEMENT_TYPES),
    start: Anchor,
    end: Anchor,
    text: z.string().max(MAX_TEXT),
    emphasis: z.string().max(60).nullable(),
    items: z.array(z.string().max(80)).max(8),
    number: NumberValue.nullable(),
    cta: z.enum(CTA_KINDS).nullable(),
    zoom: z.enum(ZOOM_KINDS).nullable(),
    reason: z.string().max(300),
    /** Drawn behind the speaker, who is cut out in front of it (BEHIND_TYPES only). */
    behind: z.boolean().optional(),
    /** A loop's stop whose words change near the end (loops only). */
    swap: z
      .object({ item: z.number().int().min(0).max(7), text: z.string().min(1).max(MAX_SWAP) })
      .optional(),
    /** A story's scenes, a cartoon's one, or a card stream's or profile's pictures (PICTURE_TYPES only). */
    scenes: z.array(MotionScene).max(MAX_STREAM).optional(),
    /** A social profile's details (profiles only). */
    profile: ProfileDetails.optional(),
    /** A Notes page's lines, each written on its word (notes only). */
    lines: z.array(NoteLine).max(MAX_NOTE_LINES).optional(),
    /** "ai" as planned; "user" once added or changed by hand. */
    source: z.enum(["ai", "user"]),
  })
  // Each type's own picture limit (a story 6, a card stream 12...).
  .refine((el) => (el.scenes?.length ?? 0) <= maxScenes(el.type), {
    message: "Too many pictures for this graphic",
    path: ["scenes"],
  });
export type MotionElement = z.infer<typeof MotionElement>;

/** The automatic sounds' settings and hand edits (src/motion/sounds.ts). */
const SoundSettings = z.object({
  enabled: z.boolean().optional(),
  volume: z.number().int().min(0).max(100).optional(),
  removed: z.array(z.string().max(100)).max(2000).optional(),
  moved: z
    .record(z.string().max(100), z.number().int().min(-20_000).max(20_000))
    .refine((m) => Object.keys(m).length <= 2000, "Too many moved sounds")
    .optional(),
});

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/** The graphics' colour: picked by hand, and the video's (src/motion/theme.ts). */
const MotionColour = z.object({
  choice: Hex.nullable().optional(),
  footage: z.array(Hex).max(6).nullable().optional(),
});

export const MotionPlan = z.object({
  version: z.literal(1),
  style: z.literal(MOTION_STYLE),
  model: z.string().max(64),
  language: z.string().max(16),
  created_at: z.string().max(40),
  /** Off: no graphics in the preview or export (the track's eye button). Missing means on. */
  enabled: z.boolean().optional(),
  /** Automatic sounds: on/off, volume, and sounds moved or deleted by hand. */
  sound: SoundSettings.optional(),
  /** The colour: picked by hand, or from the brand kit or the video. */
  colour: MotionColour.optional(),
  /** The graphics' look, one per video: dark glass (the default), paper on a desk, or minimal. */
  look: z.enum(MOTION_LOOKS).optional(),
  /**
   * Camera angles: switching between the full shot and a close crop on the
   * speaker (src/motion/angles.ts). On unless turned off; `center` is where
   * the speaker is in the frame (0-1), found by the editor; null when no
   * one was found (the zooms then centre on the upper middle).
   */
  angles: z
    .object({
      enabled: z.boolean().optional(),
      center: z
        .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
        .nullable()
        .optional(),
    })
    .optional(),
  elements: z.array(MotionElement).max(MAX_ELEMENTS),
});
export type MotionPlan = z.infer<typeof MotionPlan>;

/** A saved plan, or null when there's none or it isn't valid. */
export function parseMotionPlan(value: unknown): MotionPlan | null {
  const r = MotionPlan.safeParse(value);
  return r.success ? r.data : null;
}

// ---------- the spoken words, in video order ----------

/** The clip fields needed to place a project's words. */
export type PlanClip = {
  id: string;
  role: string;
  ordinal: number;
  storage_path: string;
  filename?: string | null;
  trim_in_ms: number | null;
  trim_out_ms: number | null;
  duration_ms: number | null;
  start_ms?: number | null;
};

// The same rule as the editor's clipVisibleMs.
function visibleMs(c: PlanClip): number {
  const inMs = c.trim_in_ms ?? 0;
  const outMs = c.trim_out_ms ?? c.duration_ms ?? null;
  if (outMs != null) return Math.max(200, outMs - inMs);
  return 5000;
}

/**
 * The main track's clips as caption segments: the A-roll, or the B-roll when
 * there's no A-roll (the same rule as captions and the export).
 */
export function mainSegments(clips: PlanClip[]): CaptionSegment[] {
  const byOrder = [...clips].sort((a, b) => a.ordinal - b.ordinal);
  const aRoll = byOrder.filter((c) => c.role === "aroll" || c.role === "auto");
  const main = aRoll.length > 0 ? aRoll : byOrder.filter((c) => c.role === "broll");
  const { starts } = layoutTrack(main, visibleMs);
  return main.map((c) => ({
    clipId: c.id,
    storagePath: c.storage_path,
    trimInMs: c.trim_in_ms ?? 0,
    durationMs: visibleMs(c),
    offsetMs: starts.get(c.id) ?? 0,
  }));
}

/** Every word heard in the video, in order. */
export function spokenWords(
  segments: CaptionSegment[],
  transcripts: Map<string, TranscriptWord[]>,
): TimelineWord[] {
  return placeTranscripts(segments, transcripts).sort((a, b) => a.startMs - b.startMs);
}

// ---------- from the AI's draft to anchored graphics ----------

/** Graphics that fill the screen's graphic layer one at a time. */
const EXCLUSIVE: ReadonlySet<ElementType> = new Set([
  "keyline",
  "counter",
  "list",
  "card",
  "compare",
  "story",
  "cartoon",
  "steps",
  "loop",
  "coins",
  "stream",
  "profile",
  "notes",
  "chapter",
  "cta",
]);

/**
 * Graphics that fill the screen, so the captions make way (the editor and
 * render-worker/motion.js captionGaps).
 */
export const FULL_SCREEN_TYPES: ReadonlySet<ElementType> = new Set([
  "keyline",
  "chapter",
  "story",
  "cartoon",
  "steps",
  "loop",
  "coins",
  "stream",
  "profile",
  "notes",
]);

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** A Notes draft's lines: inside its words, in order, one per word, tidied. */
function noteLines(d: DraftElement) {
  const out: { from_word: number; text: string; sketch: SketchId | null }[] = [];
  for (const l of [...(d.lines ?? [])].sort((a, b) => a.from_word - b.from_word)) {
    const text = clean(l.text, MAX_NOTE_TEXT);
    if (!Number.isInteger(l.from_word) || l.from_word < d.from_word || l.from_word > d.to_word)
      continue;
    if (!text || (out.length && out[out.length - 1].from_word === l.from_word)) continue;
    out.push({
      from_word: l.from_word,
      text,
      sketch: l.sketch && SKETCH_IDS.includes(l.sketch) ? l.sketch : null,
    });
  }
  return out.slice(0, MAX_NOTE_LINES);
}

/** A profile's details, trimmed to their limits (empty where not given). */
function cleanProfile(p: Partial<ProfileDetails> | null | undefined): ProfileDetails {
  const f = (k: keyof ProfileDetails, max: number) => clean(String(p?.[k] ?? ""), max);
  return {
    handle: f("handle", 40).replace(/^@+/, ""),
    name: f("name", 60),
    bio: f("bio", 150),
    posts: f("posts", 12),
    followers: f("followers", 12),
    following: f("following", 12),
  };
}

/**
 * Turns the AI's draft into anchored graphics. Anything pointing outside the
 * word list, missing what its type needs, or overlapping an earlier graphic
 * on the same layer is dropped; text is trimmed to its limits.
 */
export function draftsToElements(
  drafts: DraftElement[],
  words: TimelineWord[],
  newId: () => string = () => crypto.randomUUID(),
): MotionElement[] {
  const last = words.length - 1;
  const candidates = drafts
    .filter(
      (d) =>
        Number.isInteger(d.from_word) &&
        Number.isInteger(d.to_word) &&
        d.from_word >= 0 &&
        d.to_word <= last &&
        d.from_word <= d.to_word,
    )
    .map((d) => {
      const text = clean(d.text, MAX_TEXT);
      const emphasisRaw = d.emphasis ? clean(d.emphasis, 60) : "";
      const emphasis =
        emphasisRaw && text.toLowerCase().includes(emphasisRaw.toLowerCase()) ? emphasisRaw : null;
      const items = d.items.map((i) => clean(i, 80)).filter(Boolean);
      // A story's scenes: inside its words, in order, one per starting word.
      // A cartoon's one scene: from its first word, always with the speaker.
      const scenes: DraftScene[] = [];
      if (d.type === "cartoon") {
        const sc = d.scenes.find((s) => clean(s.prompt, MAX_SCENE_PROMPT));
        if (sc) {
          const sceneText = clean(sc.text, MAX_SCENE_TEXT);
          const em = sc.emphasis ? clean(sc.emphasis, 60) : "";
          scenes.push({
            from_word: d.from_word,
            text: sceneText,
            emphasis: em && sceneText.toLowerCase().includes(em.toLowerCase()) ? em : null,
            prompt: clean(sc.prompt, MAX_SCENE_PROMPT),
            speaker: true,
          });
        }
      } else if (d.type === "story") {
        for (const sc of [...d.scenes].sort((a, b) => a.from_word - b.from_word)) {
          const sceneText = clean(sc.text, MAX_SCENE_TEXT);
          const prompt = clean(sc.prompt, MAX_SCENE_PROMPT);
          if (!Number.isInteger(sc.from_word) || sc.from_word < d.from_word) continue;
          if (sc.from_word > d.to_word || !sceneText || !prompt) continue;
          if (scenes.length && scenes[scenes.length - 1].from_word === sc.from_word) continue;
          const em = sc.emphasis ? clean(sc.emphasis, 60) : "";
          scenes.push({
            from_word: sc.from_word,
            text: sceneText,
            emphasis: em && sceneText.toLowerCase().includes(em.toLowerCase()) ? em : null,
            prompt,
            speaker: sc.speaker === true,
          });
        }
      }
      return { ...d, text, emphasis, items, scenes: scenes.slice(0, MAX_SCENES) };
    })
    .filter((d) => {
      switch (d.type) {
        case "counter":
          return d.number != null && Number.isFinite(d.number.value);
        case "list":
          return d.items.length >= 2;
        case "compare":
          return d.items.length === 2;
        case "cta":
          return d.cta != null;
        case "zoom":
          return d.zoom != null;
        case "story":
          return d.scenes.length >= 2;
        case "cartoon":
          return d.scenes.length === 1;
        case "steps":
          return d.items.length >= 2;
        case "loop":
          return d.items.length >= 3;
        case "stream":
        case "profile":
          return true;
        case "notes":
          return noteLines(d).length >= 2;
        default:
          return d.text !== "";
      }
    })
    .sort((a, b) => a.from_word - b.from_word || a.to_word - b.to_word);

  const elements: MotionElement[] = [];
  let exclusiveEnd = -1;
  let zoomEnd = -1;
  let labelEnd = -1;
  for (const d of candidates) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (EXCLUSIVE.has(d.type)) {
      if (d.from_word <= exclusiveEnd) continue;
      exclusiveEnd = d.to_word;
    } else if (d.type === "zoom") {
      if (d.from_word <= zoomEnd) continue;
      zoomEnd = d.to_word;
    } else {
      if (d.from_word <= labelEnd) continue;
      labelEnd = d.to_word;
    }
    const from = words[d.from_word];
    const to = words[d.to_word];
    elements.push({
      id: newId(),
      type: d.type,
      start: { clip_id: from.clipId, word_index: from.wordIndex },
      end: { clip_id: to.clipId, word_index: to.wordIndex },
      text: d.text,
      emphasis: d.emphasis,
      items: d.items.slice(0, maxItems(d.type)),
      number: d.type === "counter" ? d.number : null,
      cta: d.type === "cta" ? d.cta : null,
      zoom: d.type === "zoom" ? d.zoom : null,
      reason: clean(d.reason, 300),
      ...(d.behind === true && BEHIND_TYPES.has(d.type) ? { behind: true } : {}),
      ...(d.type === "loop" &&
      d.swap &&
      clean(d.swap.text, MAX_SWAP) &&
      d.swap.item >= 0 &&
      d.swap.item < Math.min(d.items.length, maxItems("loop"))
        ? { swap: { item: d.swap.item, text: clean(d.swap.text, MAX_SWAP) } }
        : {}),
      ...(d.type === "stream" || d.type === "profile" ? { scenes: [] } : {}),
      ...(d.type === "profile" ? { profile: cleanProfile(d.profile) } : {}),
      ...(d.type === "notes"
        ? {
            lines: noteLines(d).map((l) => ({
              at: anchorOf(words[l.from_word]),
              text: l.text,
              sketch: l.sketch,
            })),
          }
        : {}),
      ...(SCENE_TYPES.has(d.type)
        ? {
            scenes: d.scenes.map((sc) => ({
              at: anchorOf(words[sc.from_word]),
              text: sc.text,
              emphasis: sc.emphasis,
              prompt: sc.prompt,
              image: null,
              ...(sc.speaker ? { speaker: true } : {}),
            })),
          }
        : {}),
      source: "ai",
    });
  }
  return elements;
}

/**
 * When a graphic shows on the timeline (ms), from where its words are now;
 * null when its first or last word has been trimmed away.
 */
export function elementSpan(
  element: MotionElement,
  wordsByKey: Map<string, TimelineWord>,
): { startMs: number; endMs: number } | null {
  const from = wordsByKey.get(`${element.start.clip_id}:${element.start.word_index}`);
  const to = wordsByKey.get(`${element.end.clip_id}:${element.end.word_index}`);
  if (!from || !to || to.endMs < from.startMs) return null;
  return { startMs: from.startMs, endMs: to.endMs };
}

/** Words keyed as elementSpan looks them up. */
export function wordsByKey(words: TimelineWord[]): Map<string, TimelineWord> {
  return new Map(words.map((w) => [w.key, w]));
}

/** What a graphic shows, in one line. */
export function elementSummary(el: MotionElement): string {
  switch (el.type) {
    case "counter": {
      const n = el.number;
      const value = n ? `${n.prefix}${n.value.toLocaleString()}${n.suffix}` : "";
      return [value, el.text].filter(Boolean).join(" · ");
    }
    case "list":
    case "compare":
      return [el.text, el.items.join(el.type === "compare" ? " vs " : ", ")]
        .filter(Boolean)
        .join(": ");
    case "cta":
      return el.text || `Ask to ${el.cta}`;
    case "zoom":
      return el.zoom === "in" ? "Punch in" : "Ease out";
    case "story":
      return el.text || (el.scenes ?? []).map((sc) => sc.text).join(" → ");
    case "cartoon":
      return el.scenes?.[0]?.text || el.text || "Cartoon of the speaker";
    case "stream": {
      const n = el.scenes?.length ?? 0;
      return el.text || `${n} picture${n === 1 ? "" : "s"}`;
    }
    case "profile":
      return el.profile?.handle ? `@${el.profile.handle}` : el.text || "Social profile";
    case "notes":
      return el.text || (el.lines ?? []).map((l) => l.text).join(" · ");
    case "steps":
    case "loop":
      return [el.text, el.items.join(" → ") + (el.type === "loop" ? " ↻" : "")]
        .filter(Boolean)
        .join(": ");
    default:
      return el.text;
  }
}

// ---------- editing by hand ----------
//
// Graphics stay anchored to words, so moving or resizing one on the timeline
// snaps its edges to the nearest words.

const anchorOf = (w: TimelineWord): Anchor => ({ clip_id: w.clipId, word_index: w.wordIndex });

/** The index (in `words`, which are in time order) of the word nearest a time. */
export function nearestWord(words: TimelineWord[], ms: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const d = ms < w.startMs ? w.startMs - ms : ms > w.endMs ? ms - w.endMs : 0;
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function indexOfAnchor(words: TimelineWord[], a: Anchor): number {
  return words.findIndex((w) => w.clipId === a.clip_id && w.wordIndex === a.word_index);
}

/** Marks a graphic as changed by hand. */
const byHand = (el: MotionElement): MotionElement => ({ ...el, source: "user" });

/**
 * Moves a graphic so it starts at the word nearest `startMs`, keeping the
 * same number of words. Null when it can't be placed (no words, or its
 * words are trimmed away).
 */
export function moveElement(
  el: MotionElement,
  words: TimelineWord[],
  startMs: number,
): MotionElement | null {
  const a = indexOfAnchor(words, el.start);
  const b = indexOfAnchor(words, el.end);
  if (a < 0 || b < 0) return null;
  const count = b - a;
  let from = nearestWord(words, startMs);
  if (from < 0) return null;
  from = Math.min(from, words.length - 1 - count);
  return byHand({ ...el, start: anchorOf(words[from]), end: anchorOf(words[from + count]) });
}

/** Moves one edge of a graphic to the word nearest `ms` (never past the other edge). */
export function resizeElement(
  el: MotionElement,
  words: TimelineWord[],
  edge: "start" | "end",
  ms: number,
): MotionElement | null {
  const a = indexOfAnchor(words, el.start);
  const b = indexOfAnchor(words, el.end);
  const at = nearestWord(words, ms);
  if (a < 0 || b < 0 || at < 0) return null;
  if (edge === "start") return byHand({ ...el, start: anchorOf(words[Math.min(at, b)]) });
  return byHand({ ...el, end: anchorOf(words[Math.max(at, a)]) });
}

/** About how long a graphic added by hand lasts. */
const NEW_SPAN_MS = 2500;

/**
 * A new graphic at the word nearest `ms`, lasting about 2.5 s of speech, with
 * the words said there as its text. Null when there are no words.
 */
export function newElementAt(
  words: TimelineWord[],
  ms: number,
  type: ElementType = "keyline",
  newId: () => string = () => crypto.randomUUID(),
): MotionElement | null {
  const from = nearestWord(words, ms);
  if (from < 0) return null;
  let to = from;
  while (to + 1 < words.length && words[to + 1].endMs - words[from].startMs <= NEW_SPAN_MS) to++;
  const said = words
    .slice(from, to + 1)
    .map((w) => w.text)
    .join(" ")
    .slice(0, MAX_TEXT);
  return {
    id: newId(),
    type,
    start: anchorOf(words[from]),
    end: anchorOf(words[to]),
    text: type === "zoom" ? "" : said,
    emphasis: null,
    items: type === "list" ? ["First", "Second"] : type === "compare" ? ["This", "That"] : [],
    number: type === "counter" ? { value: 100, prefix: "", suffix: "%" } : null,
    cta: type === "cta" ? "like" : null,
    zoom: type === "zoom" ? "in" : null,
    reason: "Added by hand",
    source: "user",
  };
}

/** What a graphic of a type needs; the editor fills it in when the type changes. */
export function withType(el: MotionElement, type: ElementType): MotionElement {
  return byHand({
    ...el,
    type,
    items:
      (type === "list" || type === "steps") && el.items.length < 2
        ? [...el.items, "First", "Second"].slice(0, 2)
        : type === "loop" && el.items.length < 3
          ? [...el.items, "Wake up", "Work", "Sleep"].slice(0, 3)
          : type === "compare"
            ? [el.items[0] ?? "This", el.items[1] ?? "That"]
            : el.items.slice(0, maxItems(type)),
    swap: type === "loop" && el.swap && el.swap.item < maxItems("loop") ? el.swap : undefined,
    number: type === "counter" ? (el.number ?? { value: 100, prefix: "", suffix: "%" }) : null,
    cta: type === "cta" ? (el.cta ?? "like") : null,
    zoom: type === "zoom" ? (el.zoom ?? "in") : null,
    behind: BEHIND_TYPES.has(type) ? el.behind : undefined,
    // A story starts with one scene from the graphic's own words; a cartoon
    // keeps just one scene, always with the speaker.
    // Pictures only carry over between the picture-set types.
    scenes:
      type === "stream" || type === "profile"
        ? el.type === "stream" || el.type === "profile"
          ? (el.scenes ?? []).slice(0, maxScenes(type))
          : []
        : !SCENE_TYPES.has(type)
          ? undefined
          : type === "cartoon"
            ? [{ ...firstScene(el), speaker: true }]
            : el.scenes?.length
              ? el.scenes.slice(0, MAX_SCENES)
              : [firstScene(el)],
    profile: type === "profile" ? (el.profile ?? { ...EMPTY_PROFILE }) : undefined,
    // A Notes page starts from the graphic's items (or two blank lines).
    lines:
      type === "notes"
        ? el.lines?.length
          ? el.lines
          : (el.items.length >= 2 ? el.items : ["First note", "Second note"])
              .slice(0, MAX_NOTE_LINES)
              .map((text) => ({ at: el.start, text: text.slice(0, MAX_NOTE_TEXT), sketch: null }))
        : undefined,
  });
}

function firstScene(el: MotionElement): MotionScene {
  return (
    el.scenes?.[0] ?? {
      at: el.start,
      text: el.text.slice(0, MAX_SCENE_TEXT),
      emphasis: null,
      prompt: "",
      image: null,
    }
  );
}

/** An empty plan, for adding graphics by hand before (or without) the AI. */
export function emptyPlan(): MotionPlan {
  return {
    version: 1,
    style: MOTION_STYLE,
    model: "by hand",
    language: "en",
    created_at: new Date().toISOString(),
    enabled: true,
    elements: [],
  };
}

export { byHand as markEdited };

// ---------- the word list the AI reads ----------

/**
 * The words numbered for the AI, about a line per sentence: "[0] So [1] look,".
 * Line breaks follow sentence ends and pauses, so the AI sees the rhythm.
 */
export function numberedTranscript(words: TimelineWord[]): string {
  const lines: string[] = [];
  let cur: string[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (
      prev &&
      cur.length &&
      (/[.!?]$/.test(prev.text) || w.startMs - prev.endMs > 700 || cur.length >= 30)
    ) {
      lines.push(cur.join(" "));
      cur = [];
    }
    cur.push(`[${i}] ${w.text}`);
  });
  if (cur.length) lines.push(cur.join(" "));
  return lines.join("\n");
}
