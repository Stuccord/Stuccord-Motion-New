// Motion Explainer sound design: which sound plays where, from the placed
// graphics (docs/style-research/t2-premiere-reels.md: a whoosh on every
// movement, a texture sound on every animation, a riser and a hit into big
// moments), and the built-in music beds that change at each chapter.
// Shared by the editor preview; render-worker/motion.js mirrors it for the
// export. The sounds are made in code (render-worker/make-sounds.mjs) and
// live in public/sounds and render-worker/sounds.

import { MOTION_FPS, type PlacedGraphic, type PlacedZoom } from "@/motion/timing";
import { coinBeats, loopBeats, profileBeats, stepStarts, streamBeats } from "@/motion/beats";

export const SOUND_KINDS = [
  "whoosh-light",
  "whoosh-deep",
  "click",
  "pop",
  "ui-blip",
  "glitch",
  "riser",
  "hit",
] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

export const SOUND_LABEL: Record<SoundKind, string> = {
  "whoosh-light": "Whoosh",
  "whoosh-deep": "Deep whoosh",
  click: "Click",
  pop: "Pop",
  "ui-blip": "UI blip",
  glitch: "Glitch",
  riser: "Riser",
  hit: "Hit",
};

/** How long each sound lasts (ms), for drawing it on the timeline. */
export const SOUND_LENGTH_MS: Record<SoundKind, number> = {
  "whoosh-light": 550,
  "whoosh-deep": 850,
  click: 60,
  pop: 160,
  "ui-blip": 220,
  glitch: 300,
  riser: 1500,
  hit: 1400,
};

/** Each sound's level before the volume slider. */
const KIND_GAIN: Record<SoundKind, number> = {
  "whoosh-light": 0.9,
  "whoosh-deep": 0.9,
  click: 0.8,
  pop: 0.9,
  "ui-blip": 0.8,
  glitch: 0.8,
  riser: 0.75,
  hit: 0.9,
};

/** The music beds, used in turn at each chapter. */
export const MUSIC_BEDS = ["bed-calm", "bed-focus", "bed-drive"] as const;
export type MusicBed = (typeof MUSIC_BEDS)[number];

/** A whoosh peaks about this far into its file: start it this early so the peak meets the movement. */
const WHOOSH_LEAD_MS = 250;
/** The riser ends where the chapter lands. */
const RISER_MS = 1500;

export type SoundEvent = {
  /** Stable: the graphic's id and the sound's part in it, e.g. "g1:enter". */
  id: string;
  kind: SoundKind;
  atMs: number;
  graphicId: string;
};

/** The plan's sound settings (all optional; missing means the defaults). */
export type SoundSettings = {
  /** Off: no automatic sounds. Default on. */
  enabled?: boolean;
  /** 0-100. Default 70. */
  volume?: number;
  /** Sounds deleted by hand (by id). */
  removed?: string[];
  /** Sounds moved by hand: how far from where they'd be (ms), by id. */
  moved?: Record<string, number>;
};

export const DEFAULT_SOUND_VOLUME = 70;

const frameMs = (f: number) => (f / MOTION_FPS) * 1000;

/** Where the sounds go, before any hand edits. */
export function baseSoundEvents(graphics: PlacedGraphic[], zooms: PlacedZoom[]): SoundEvent[] {
  const out: SoundEvent[] = [];
  const add = (g: { id: string }, part: string, kind: SoundKind, atMs: number) =>
    out.push({ id: `${g.id}:${part}`, kind, atMs: Math.max(0, Math.round(atMs)), graphicId: g.id });
  for (const g of graphics) {
    const at = frameMs(g.from);
    const len = g.to - g.from;
    switch (g.type) {
      case "keyline":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        add(g, "pop", "pop", at);
        break;
      case "counter":
        add(g, "enter", "ui-blip", at);
        // When the number has finished counting up.
        add(g, "done", "click", at + frameMs(30));
        break;
      case "list": {
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        // One click per item, as each arrives (the same timing as the list).
        const step = g.items.length > 1 ? Math.max(6, (len * 0.66) / g.items.length) : 0;
        g.items.forEach((_, i) => add(g, `item${i}`, "click", at + frameMs(Math.round(i * step))));
        break;
      }
      case "card":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        add(g, "blip", "ui-blip", at + frameMs(4));
        break;
      case "compare": {
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        const second = Math.max(10, Math.round(len * 0.4));
        add(g, "second", "whoosh-deep", at + frameMs(second) - WHOOSH_LEAD_MS);
        break;
      }
      case "story":
        // A whoosh into each scene as the camera moves on, a deeper one first.
        (g.scenes ?? []).forEach((sc, i) =>
          add(
            g,
            `scene${i}`,
            i === 0 ? "whoosh-deep" : "whoosh-light",
            frameMs(sc.from) - WHOOSH_LEAD_MS,
          ),
        );
        break;
      case "cartoon":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        add(g, "pop", "pop", at);
        break;
      case "steps":
        // A whoosh as the camera flies to each platform (a deeper one first),
        // and a click as its label lands.
        stepStarts(g.items.length, len).forEach((f, i) => {
          add(
            g,
            `step${i}`,
            i === 0 ? "whoosh-deep" : "whoosh-light",
            at + frameMs(f) - WHOOSH_LEAD_MS,
          );
          add(g, `label${i}`, "click", at + frameMs(f + 6));
        });
        break;
      case "loop": {
        // The sphere rises, a click on each stop as the arc reaches it, a
        // glitch when a word swaps.
        const b = loopBeats(g.items.length, len);
        add(g, "enter", "whoosh-deep", at - WHOOSH_LEAD_MS);
        b.dots.forEach((f, i) => add(g, `stop${i}`, "click", at + frameMs(f)));
        if (g.swap) add(g, "swap", "glitch", at + frameMs(b.swapAt));
        break;
      }
      case "coins": {
        const b = coinBeats(len);
        add(g, "enter", "whoosh-deep", at - WHOOSH_LEAD_MS);
        add(g, "fan", "whoosh-light", at + frameMs(b.fanAt) - WHOOSH_LEAD_MS);
        add(g, "blip", "ui-blip", at + frameMs(b.fanAt));
        break;
      }
      case "stream": {
        // A quick riffle of clicks as the pictures fly in, then a whoosh and a
        // pop as the last card lands.
        const b = streamBeats(g.scenes?.length ?? 0);
        b.cards.forEach((f, i) => add(g, `card${i}`, "click", at + frameMs(f + b.flight - 4)));
        add(g, "finale", "whoosh-light", at + frameMs(b.finaleAt) - WHOOSH_LEAD_MS);
        add(g, "land", "pop", at + frameMs(b.finaleAt + b.flight - 4));
        break;
      }
      case "profile": {
        // The header slides up, a click per grid photo, then a whoosh into the
        // big photos and a blip on each.
        const photos = Math.max(0, (g.scenes?.length ?? 0) - 1);
        const b = profileBeats(photos, len);
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        b.grid.forEach((f, i) => add(g, `photo${i}`, "click", at + frameMs(f)));
        if (b.flicks.length)
          add(g, "flick", "whoosh-light", at + frameMs(b.flickFrom) - WHOOSH_LEAD_MS);
        b.flicks.forEach((f, i) => add(g, `flick${i}`, "ui-blip", at + frameMs(f)));
        break;
      }
      case "notes":
        // The page slides in; a click as each line is written, a blip when
        // its sketch draws on.
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        (g.lines ?? []).forEach((l, i) => {
          add(g, `line${i}`, "click", frameMs(l.from));
          if (l.sketch) add(g, `sketch${i}`, "ui-blip", frameMs(l.from + 6));
        });
        break;
      case "chapter":
        if (at >= RISER_MS) add(g, "riser", "riser", at - RISER_MS);
        add(g, "hit", "hit", at);
        add(g, "title", "glitch", at + frameMs(4));
        break;
      case "label":
        add(g, "pop", "pop", at);
        break;
      case "cta":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        // The pointer's click.
        add(g, "click", "click", at + frameMs(22));
        break;
    }
  }
  for (const z of zooms) {
    if (z.zoom === "in") add(z, "enter", "whoosh-light", frameMs(z.from) - WHOOSH_LEAD_MS);
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** The sounds after hand edits (deleted ones left out, moved ones moved); none when off. */
export function soundEvents(
  graphics: PlacedGraphic[],
  zooms: PlacedZoom[],
  settings: SoundSettings | undefined,
): SoundEvent[] {
  if (settings?.enabled === false) return [];
  const removed = new Set(settings?.removed ?? []);
  const moved = settings?.moved ?? {};
  return baseSoundEvents(graphics, zooms)
    .filter((e) => !removed.has(e.id))
    .map((e) => (moved[e.id] ? { ...e, atMs: Math.max(0, e.atMs + moved[e.id]) } : e))
    .sort((a, b) => a.atMs - b.atMs);
}

/** A sound's level: its own level times the volume slider. */
export function soundGain(kind: SoundKind, settings: SoundSettings | undefined): number {
  const v = Math.min(100, Math.max(0, settings?.volume ?? DEFAULT_SOUND_VOLUME));
  return Number(((KIND_GAIN[kind] * v) / 100).toFixed(3));
}

/** Shorter stretches between chapters keep the music they started with (ms). */
const MIN_MUSIC_MS = 4000;

/**
 * The music's stretches: a new one at each chapter, from 0:00 to the end.
 * `pick` chooses what plays in stretch i (a bed, or an uploaded song).
 */
export function chapterStretches<T>(
  graphics: PlacedGraphic[],
  endMs: number,
  pick: (i: number) => T,
): { what: T; startMs: number; endMs: number }[] {
  const starts = [0];
  for (const g of graphics) {
    if (g.type !== "chapter") continue;
    const at = frameMs(g.from);
    if (at - starts[starts.length - 1] >= MIN_MUSIC_MS && endMs - at >= MIN_MUSIC_MS)
      starts.push(at);
  }
  return starts.map((s, i) => ({ what: pick(i), startMs: s, endMs: starts[i + 1] ?? endMs }));
}

/** The built-in beds, changing at each chapter. */
export function bedStretches(graphics: PlacedGraphic[], endMs: number) {
  return chapterStretches(graphics, endMs, (i) => MUSIC_BEDS[i % MUSIC_BEDS.length]);
}
