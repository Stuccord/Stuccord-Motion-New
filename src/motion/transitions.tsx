// Transitions between the speaker and full-screen B-roll (stories, steps,
// chapters, a look's own scenes...), the motion rules of an edit:
//   - motivated: each lands on the word that starts the graphic (or ends it),
//     never on its own;
//   - short: 8-10 frames, quick enough to feel like a cut, never a slow fade;
//   - one style per look, so a video has one visual language (Cinematic a
//     light flash, Documentary a dip to black, Glass a zoom through, SaaS a
//     push, Bulletin a wipe...), and a chapter always a dip (a new part);
//   - direction-matched: pushes and wipes always travel the same way (the
//     story moves forward, right to left), on the way in and out;
//   - no flash frames: B-roll followed closely by more B-roll holds until
//     the next starts, so the speaker doesn't blink on for a few frames;
//   - and a whoosh under each (sounds.ts, render-worker/motion.js).
//
// While a transition moves the graphic, the graphic is held fully on (its
// own fade in and out skipped), so the page moves as one solid picture, not
// a see-through one. render-worker/motion.js mirrors which graphics cover
// the frame (coversFrame) for the export's sounds and drawn stretches.

import React from "react";
import { AbsoluteFill, Freeze, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { MotionLookId } from "@/motion/looks";
import type { PlacedGraphic } from "@/motion/timing";
import { BASE_FPS, clamp01, easeIn, easeInOut, easeOut } from "@/motion/kit";

export type TransitionKind = "flash" | "dip" | "zoom" | "push" | "wipe";

/** Each look's transition (a chapter is always a dip). */
export const LOOK_TRANSITION: Record<MotionLookId, TransitionKind> = {
  glass: "zoom",
  paper: "push",
  minimal: "push",
  film: "flash",
  saas: "push",
  docu: "dip",
  cine3d: "zoom",
  bulletin: "wipe",
  impact: "wipe",
  noir: "dip",
  monument: "flash",
  talk: "push",
  notebook: "push",
  hud: "wipe",
  studio: "zoom",
};

/** The flash's light and the wipe's bar, by look (else white / the accent). */
const FLASH_COLOUR: Partial<Record<MotionLookId, string>> = {
  film: "#FFF1DE",
  monument: "#FFEBC8",
};
const WIPE_COLOUR: Partial<Record<MotionLookId, string>> = {
  bulletin: "#D7262E",
  impact: "#E6FF00",
  hud: "#B6FF3B",
};

/** Graphics that fill the whole frame in every look (measured on each look's drawings). */
const COVER_TYPES = new Set<PlacedGraphic["type"]>([
  "chapter",
  "story",
  "cartoon",
  "steps",
  "loop",
  "coins",
  "stream",
  "profile",
  "screen",
]);
/** And the ones a look draws as a full scene of its own. */
const LOOK_COVER_TYPES: Partial<Record<MotionLookId, PlacedGraphic["type"][]>> = {
  paper: ["keyline", "counter", "list", "card", "compare", "metaphor"],
  minimal: ["keyline", "counter", "list", "cta", "metaphor"],
  docu: ["keyline", "metaphor"],
  cine3d: ["keyline", "metaphor"],
  monument: ["keyline", "metaphor"],
  bulletin: ["compare"],
  impact: ["counter"],
  noir: ["counter"],
  notebook: ["list"],
};

/** Whether a graphic covers the whole frame (the speaker) in this look. */
export function coversFrame(look: MotionLookId, g: PlacedGraphic): boolean {
  if (g.behind) return false;
  return COVER_TYPES.has(g.type) || (LOOK_COVER_TYPES[look] ?? []).includes(g.type);
}

/** Frames (at 30 fps) a transition starts before its word: the flash and dip build into the cut. */
export const EDGE_BEFORE = 6;
/** Frames a transition runs on after the graphic has gone (the flash or dip clearing off the speaker). */
export const EDGE_AFTER = 10;
/** B-roll this close (frames) to the next B-roll holds on until it, no speaker in between. */
const JOIN_FRAMES = 12;
/** How long an arrival takes (frames), the longest of the kinds. */
const ARRIVE_FRAMES = 10;
/** The graphic's own fade in and out, skipped while a transition moves it (frames). */
const OWN_FADE_IN = 10;
const OWN_FADE_OUT = 10;

export type Edges = {
  /** How it arrives and leaves; null: as it draws itself (not full-screen, or held into the next). */
  enter: TransitionKind | null;
  exit: TransitionKind | null;
  /** The last frame + 1 it shows (past `to` when it holds until the next B-roll). */
  until: number;
};

/** Each graphic's transitions, by id (from the whole timeline, so B-roll can hold into the next). */
export function transitionEdges(
  graphics: PlacedGraphic[],
  look: MotionLookId,
): Record<string, Edges> {
  const out: Record<string, Edges> = {};
  const covering = graphics
    .filter((g) => coversFrame(look, g))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  for (const g of graphics) out[g.id] = { enter: null, exit: null, until: g.to };
  covering.forEach((g, i) => {
    const kind = g.type === "chapter" ? "dip" : LOOK_TRANSITION[look];
    const next = covering[i + 1];
    const joined = !!next && next.from - g.to <= JOIN_FRAMES && next.from > g.from;
    out[g.id] = {
      enter: kind,
      exit: joined ? null : kind,
      // Under the next one until it has fully arrived over it.
      until: joined ? Math.max(g.to, next.from + ARRIVE_FRAMES) : g.to,
    };
  });
  return out;
}

/** Whether a graphic is on screen at a frame, transitions included (the editor's preview picks with it). */
export function onScreenAt(g: PlacedGraphic, edges: Edges | undefined, frame: number): boolean {
  const from = g.from - (edges?.enter ? EDGE_BEFORE : 0);
  const until = (edges?.until ?? g.to) + (edges?.exit ? EDGE_AFTER : 0);
  return frame >= from && frame < until;
}

// ---------- drawing ----------

/** A sideways-only blur (motion blur for something moving across), used as filter: url(#id). */
export function SideBlur({ id, amount }: { id: string; amount: number }) {
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <filter id={id} x="-20%" y="0" width="140%" height="100%">
        <feGaussianBlur stdDeviation={`${amount.toFixed(2)} 0`} />
      </filter>
    </svg>
  );
}

/** A light, black or coloured layer over everything at this strength. */
function Cover({ colour, amount }: { colour: string; amount: number }) {
  if (amount <= 0.002) return null;
  return <AbsoluteFill style={{ background: colour, opacity: Math.min(1, amount) }} />;
}

/**
 * How strongly a flash or dip covers the frame at `t` frames from its cut:
 * building over the frames before it, clearing over the frames after.
 */
function coverAt(kind: "flash" | "dip", t: number): number {
  const build = kind === "flash" ? 4 : 6;
  const clear = kind === "flash" ? 10 : 8;
  const peak = kind === "flash" ? 0.92 : 1;
  if (t < -build || t > clear) return 0;
  if (t <= 0)
    return peak * (kind === "flash" ? easeIn((t + build) / build) : easeInOut((t + build) / build));
  return peak * (1 - easeOut(t / clear));
}

/** How the graphic itself moves at `t` frames from its arrival (in) or departure (out). */
function layerStyle(
  kind: TransitionKind,
  side: "in" | "out",
  t: number,
  unit: number,
  blurId: string,
): { style: React.CSSProperties; blur: number; bar: number | null } {
  const none = { style: {}, blur: 0, bar: null };
  if (kind === "flash") {
    // A small settle under the light: arriving slightly big, leaving slightly pushed in.
    const s = side === "in" ? 1.06 - 0.06 * easeOut(t / 14) : 1 + 0.04 * easeIn((t + 8) / 8);
    return { ...none, style: { transform: `scale(${s})` } };
  }
  if (kind === "dip") return none;
  if (kind === "zoom") {
    // Through the lens: arrives from big and blurred, leaves into big and blurred.
    const p = side === "in" ? easeOut(t / 9) : 1 - easeIn((t + 9) / 9);
    const shown = side === "in" ? clamp01(t / 4) : clamp01(-t / 4);
    return {
      style: {
        transform: `scale(${1 + 0.3 * (1 - p)})`,
        filter: p < 1 ? `blur(${(1 - p) * unit * 1.6}px)` : undefined,
        opacity: shown,
      },
      blur: 0,
      bar: null,
    };
  }
  if (kind === "push") {
    // Slides on from the right, off to the left, blurred along its way.
    const x = side === "in" ? 1 - easeOut(t / 9) : -easeIn((t + 9) / 9);
    // Blurred as much as it's moving (the eases' speed: fast at the cut, still at rest).
    const speed = side === "in" ? (1 - clamp01(t / 9)) ** 2 : clamp01((t + 9) / 9) ** 2;
    const blur = Math.abs(x) > 0.001 ? unit * 2.4 * speed : 0;
    return {
      style: {
        transform: `translateX(${x * 100}%)`,
        filter: blur > 0.3 ? `url(#${blurId})` : undefined,
      },
      blur,
      bar: null,
    };
  }
  // A wipe: a bar crosses left to right, the graphic showing behind it on
  // the way in and gone behind it on the way out.
  const p = side === "in" ? easeInOut(t / 8) : easeInOut((t + 8) / 8);
  if ((side === "in" && p >= 1) || (side === "out" && p <= 0)) return none;
  // Not started (in) or done (out): nothing, not even the bar at the edge.
  if ((side === "in" && p <= 0) || (side === "out" && p >= 1))
    return { style: { opacity: 0 }, blur: 0, bar: null };
  return {
    style: {
      clipPath: side === "in" ? `inset(0 ${(1 - p) * 100}% 0 0)` : `inset(0 0 0 ${p * 100}%)`,
    },
    blur: 0,
    bar: p,
  };
}

/**
 * A full-screen graphic with its transitions: placed from a little before
 * its word (a flash or dip builds into the cut) to a little after its end,
 * drawn (held fully on while it moves) and moved or covered at its edges.
 */
export function Transitioned({
  g,
  edges,
  look,
  accent,
  children,
}: {
  g: PlacedGraphic;
  edges: Edges;
  look: MotionLookId;
  accent: string;
  children: React.ReactNode;
}) {
  const { fps } = useVideoConfig();
  const scale = fps / BASE_FPS;
  const before = edges.enter ? EDGE_BEFORE : 0;
  const after = edges.exit ? EDGE_AFTER : 0;
  const start = Math.round((g.from - before) * scale);
  const end = Math.round((edges.until + after) * scale);
  return (
    <Sequence from={start} durationInFrames={Math.max(1, end - start)} layout="none">
      <Edged g={g} edges={edges} look={look} accent={accent} lead={before}>
        {children}
      </Edged>
    </Sequence>
  );
}

function Edged({
  g,
  edges,
  look,
  accent,
  lead,
  children,
}: {
  g: PlacedGraphic;
  edges: Edges;
  look: MotionLookId;
  accent: string;
  /** Frames (30 fps) this starts before the graphic. */
  lead: number;
  children: React.ReactNode;
}) {
  const { fps, width, height } = useVideoConfig();
  const scale = fps / BASE_FPS;
  const unit = Math.min(width, height) / 100;
  // In 30 fps frames from the graphic's start, stepped like the graphics (15 fps).
  const f = Math.floor((useCurrentFrame() / scale - lead) / 2) * 2;
  const length = g.to - g.from;
  const inner = Math.round(lead * scale);
  const shownFor = Math.max(1, Math.round((edges.until - g.from) * scale));
  // Held fully on while it moves: its own fade in skipped, and from just
  // before its own fade out it stays as it was (to its end, or the next B-roll).
  const heldIn = Math.round(OWN_FADE_IN * scale);
  const heldOut = Math.max(heldIn + 1, Math.round((length - OWN_FADE_OUT) * scale));
  const holdOut = !!edges.exit || edges.until > g.to;
  const local = useCurrentFrame() - inner;
  const freezeAt =
    edges.enter && local < heldIn ? heldIn : holdOut && local >= heldOut ? heldOut : null;

  // Arriving (t from the start) or leaving (t from the end); the closer edge wins.
  const tIn = f;
  const shownLength = edges.until - g.from;
  const tOut = f - shownLength;
  const leaving = !!edges.exit && tOut >= -10;
  const kind = leaving ? edges.exit : edges.enter;
  const blurId = `tr-blur-${g.id}`;
  let layer: ReturnType<typeof layerStyle> = { style: {}, blur: 0, bar: null };
  let cover = 0;
  if (kind) {
    const t = leaving ? tOut : tIn;
    if (kind === "flash" || kind === "dip") cover = coverAt(kind, t);
    if (!(leaving ? t > 0 : t < 0))
      layer = layerStyle(kind, leaving ? "out" : "in", t, unit, blurId);
    else if (kind !== "flash" && kind !== "dip")
      layer = { style: { opacity: 0 }, blur: 0, bar: null };
  }
  const gone = f >= shownLength || f < 0;
  const coverColour = kind === "flash" ? (FLASH_COLOUR[look] ?? "#FFFFFF") : "#000000";
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {layer.blur > 0.3 && <SideBlur id={blurId} amount={layer.blur} />}
      {!gone && (
        <AbsoluteFill style={layer.style}>
          <Sequence from={inner} durationInFrames={shownFor} layout="none">
            <Freeze frame={freezeAt ?? 0} active={freezeAt != null}>
              {children}
            </Freeze>
          </Sequence>
        </AbsoluteFill>
      )}
      {layer.bar != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `calc(${layer.bar * 100}% - ${unit * 1.6}px)`,
            width: unit * 3.2,
            background: WIPE_COLOUR[look] ?? accent,
            boxShadow: `0 0 ${unit * 3}px rgba(0,0,0,0.35)`,
          }}
        />
      )}
      {kind && (kind === "flash" || kind === "dip") && (
        <Cover colour={coverColour} amount={cover} />
      )}
    </AbsoluteFill>
  );
}
