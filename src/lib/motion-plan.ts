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
import { layoutTrack } from "@/lib/timeline-layout";
import {
  placeTranscripts,
  type CaptionSegment,
  type TimelineWord,
  type TranscriptWord,
} from "@/lib/captions";

export const MOTION_STYLE = "motion-explainer";

export const ELEMENT_TYPES = [
  "keyline",
  "counter",
  "list",
  "card",
  "compare",
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
  chapter: "Chapter",
  label: "Label",
  cta: "Call to action",
  zoom: "Zoom",
};

/** Longest main text, and most graphics in one plan. */
const MAX_TEXT = 200;
const MAX_ELEMENTS = 300;

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

export const MotionElement = z.object({
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
  /** "ai" as planned; "user" once added or changed by hand. */
  source: z.enum(["ai", "user"]),
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
  "chapter",
  "cta",
]);

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

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
      return { ...d, text, emphasis, items };
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
      items: d.items.slice(0, d.type === "card" ? 4 : 8),
      number: d.type === "counter" ? d.number : null,
      cta: d.type === "cta" ? d.cta : null,
      zoom: d.type === "zoom" ? d.zoom : null,
      reason: clean(d.reason, 300),
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
      type === "list" && el.items.length < 2
        ? [...el.items, "First", "Second"].slice(0, Math.max(2, el.items.length))
        : type === "compare"
          ? [el.items[0] ?? "This", el.items[1] ?? "That"]
          : el.items,
    number: type === "counter" ? (el.number ?? { value: 100, prefix: "", suffix: "%" }) : null,
    cta: type === "cta" ? (el.cta ?? "like") : null,
    zoom: type === "zoom" ? (el.zoom ?? "in") : null,
  });
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
