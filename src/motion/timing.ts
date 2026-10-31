// From a saved plan to what the graphics renderer draws: each graphic's
// frames on the timeline (from where its words are now), chapter numbers,
// and the picture zoom. Shared by the editor preview and, in stage 3, the
// export, so both place everything the same way.

import type { TimelineWord } from "@/lib/captions";
import { BEHIND_TYPES, elementSpan, type ElementType, type MotionElement } from "@/lib/motion-plan";

export const MOTION_FPS = 30;

/** The export's frame size for each shape (the worker's aspectDims). */
export function frameSize(aspect: string): { width: number; height: number } {
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

/** A graphic as the renderer draws it. */
export type PlacedGraphic = {
  id: string;
  type: Exclude<ElementType, "zoom">;
  /** First and last frame it's on screen (inclusive start, exclusive end). */
  from: number;
  to: number;
  text: string;
  emphasis: string | null;
  items: string[];
  number: MotionElement["number"];
  cta: MotionElement["cta"];
  /** For a chapter: which one (1-based) and how many there are. */
  chapter: { index: number; count: number } | null;
  /** Drawn behind the speaker (cut out in front of it). */
  behind: boolean;
  /** A story's scenes, in order; null for other graphics. */
  scenes: PlacedScene[] | null;
};

/** A story scene as drawn: from which frame, its words, and its picture's storage path. */
export type PlacedScene = {
  from: number;
  text: string;
  emphasis: string | null;
  image: string | null;
};

/**
 * Where a story's scenes start (frames): at their words when those are in
 * the story and in order, else spread evenly over it.
 */
export function sceneStarts(froms: (number | null)[], from: number, to: number): number[] {
  const n = froms.length;
  const ok = froms.every(
    (f, i) => f != null && f >= from && f < to && (i === 0 || f > (froms[i - 1] as number)),
  );
  if (ok) return froms.map((f, i) => (i === 0 ? from : (f as number)));
  return froms.map((_, i) => Math.round(from + ((to - from) * i) / n));
}

function placeScenes(
  el: MotionElement,
  from: number,
  to: number,
  wordsByKey: Map<string, TimelineWord>,
): PlacedScene[] {
  const scenes = el.scenes ?? [];
  const froms = scenes.map((sc) => {
    const w = wordsByKey.get(`${sc.at.clip_id}:${sc.at.word_index}`);
    return w ? msToFrame(w.startMs) : null;
  });
  const starts = sceneStarts(froms, from, to);
  return scenes.map((sc, i) => ({
    from: starts[i],
    text: sc.text,
    emphasis: sc.emphasis,
    image: sc.image?.path ?? null,
  }));
}

export type PlacedZoom = { id: string; from: number; to: number; zoom: "in" | "out" };

/** How long a graphic stays up at least, so it can be read (frames). */
const MIN_FRAMES = Math.round(1.2 * MOTION_FPS);
/** A little hold after the last word. */
const TAIL_FRAMES = Math.round(0.35 * MOTION_FPS);

const msToFrame = (ms: number) => Math.round((ms / 1000) * MOTION_FPS);

/**
 * Places the plan's graphics and zooms on the timeline. Graphics whose words
 * have been trimmed away are left out.
 */
export function placeGraphics(
  elements: MotionElement[],
  wordsByKey: Map<string, TimelineWord>,
): { graphics: PlacedGraphic[]; zooms: PlacedZoom[] } {
  const graphics: PlacedGraphic[] = [];
  const zooms: PlacedZoom[] = [];
  const spans = elements
    .map((el) => ({ el, span: elementSpan(el, wordsByKey) }))
    .filter((x): x is { el: MotionElement; span: { startMs: number; endMs: number } } => !!x.span)
    .sort((a, b) => a.span.startMs - b.span.startMs);
  const chapterCount = spans.filter((x) => x.el.type === "chapter").length;
  let chapterIndex = 0;
  for (const { el, span } of spans) {
    const from = msToFrame(span.startMs);
    const to = Math.max(from + MIN_FRAMES, msToFrame(span.endMs) + TAIL_FRAMES);
    if (el.type === "zoom") {
      zooms.push({ id: el.id, from, to, zoom: el.zoom ?? "in" });
      continue;
    }
    graphics.push({
      id: el.id,
      type: el.type,
      from,
      to,
      text: el.text,
      emphasis: el.emphasis,
      items: el.items.map((i) => i.trim()).filter(Boolean),
      number: el.number,
      cta: el.cta,
      chapter: el.type === "chapter" ? { index: ++chapterIndex, count: chapterCount } : null,
      behind: el.behind === true && BEHIND_TYPES.has(el.type),
      scenes:
        el.type === "story" && el.scenes?.length
          ? placeScenes(el, from, to, wordsByKey)
          : el.type === "story"
            ? []
            : null,
    });
  }
  return { graphics, zooms };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Most a zoom pushes in. */
export const ZOOM_SCALE = 1.14;

/**
 * How much the picture is zoomed at a frame: a quick punch-in that holds and
 * eases back out, or a slow ease out from zoomed in.
 */
export function zoomAt(zooms: PlacedZoom[], frame: number): number {
  const z = zooms.find((x) => frame >= x.from && frame < x.to);
  if (!z) return 1;
  const len = z.to - z.from;
  const t = frame - z.from;
  if (z.zoom === "out") return 1 + (ZOOM_SCALE - 1) * (1 - easeInOut(clamp01(t / len)));
  const inF = Math.min(8, len / 3);
  const outF = Math.min(10, len / 3);
  if (t < inF) return 1 + (ZOOM_SCALE - 1) * easeOut(t / inF);
  if (t > len - outF) return 1 + (ZOOM_SCALE - 1) * easeInOut(clamp01((len - t) / outF));
  return ZOOM_SCALE;
}

// ---------- story camera (drawn in MotionGraphics) ----------

/** Frames the camera takes to fly from one scene to the next. */
const STORY_MOVE = 16;

/**
 * Where the camera is (in scenes: 1.5 = halfway from the second to the
 * third) at a frame into the story; the move into each scene is centred on
 * its start, so the camera is fastest exactly at the cut.
 */
export function storyCamera(starts: number[], frame: number): number {
  let c = 0;
  for (let i = 1; i < starts.length; i++) {
    const room = Math.min(starts[i] - starts[i - 1], (starts[i + 1] ?? Infinity) - starts[i]);
    const move = Math.max(4, Math.min(STORY_MOVE, room));
    c += easeInOut(clamp01((frame - (starts[i] - move / 2)) / move));
  }
  return c;
}
