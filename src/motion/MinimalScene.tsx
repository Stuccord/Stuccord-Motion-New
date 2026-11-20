// The Minimal look's key moments as full-frame black scenes (key lines,
// numbers, lists, chapters, calls to action), after the owner's reference: a
// pure black frame, thin white lines hanging from the top edge with small
// white weights (one of them swinging), small lowercase serif words with the
// key word in italic, white only, and a lot of empty space. The cut to black
// is quick; everything inside it arrives slowly.

import React from "react";
import { AbsoluteFill } from "remotion";
import { SANS, SERIF } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import { clamp01, easeInOut, easeOut, exitOpacity, splitWords, useStepFrame, useUnit } from "@/motion/kit";

const BLACK = "#000000";
const WHITE = "#F4F4F2";
const DIM = "rgba(244, 244, 242, 0.55)";
const HAIR = "rgba(244, 244, 242, 0.85)";

/** The types the Minimal look draws as a black scene. */
export const MINIMAL_SCENE_TYPES = new Set<PlacedGraphic["type"]>([
  "keyline",
  "counter",
  "list",
  "chapter",
  "cta",
]);

/** True when this graphic is drawn as a black scene (not one behind the speaker). */
export const isMinimalScene = (g: PlacedGraphic) => MINIMAL_SCENE_TYPES.has(g.type) && !g.behind;

/**
 * Thin lines hanging from the top edge, each ending in a small weight: they
 * drop in one after another, then the last one swings out and back.
 */
function HangingLines({
  frame,
  count,
  unit,
  width,
  height,
  drop,
}: {
  frame: number;
  count: number;
  unit: number;
  width: number;
  height: number;
  /** How far down the weights hang, as a share of the height. */
  drop: number;
}) {
  const r = unit * 1.9;
  const gap = r * 2.05;
  const startX = width / 2 - ((count - 1) * gap) / 2;
  const hang = height * drop;
  const stroke = Math.max(1, unit * 0.16);
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: count }).map((_, i) => {
        const x = startX + i * gap;
        const len = hang * easeOut((frame - 4 - i * 3) / 22);
        // The last one keeps swinging out to the right and back, like a
        // Newton's cradle: out for a second, then a moment at rest.
        const last = i === count - 1 && count > 1;
        const swing = last
          ? 0.45 * Math.max(0, Math.sin(((frame - 18) / 56) * 2 * Math.PI)) * easeOut((frame - 18) / 8)
          : 0;
        const bx = x + Math.sin(swing) * len;
        const by = Math.cos(swing) * len;
        if (len < 1) return null;
        return (
          <g key={i}>
            <line x1={x} y1={0} x2={bx} y2={by} stroke={HAIR} strokeWidth={stroke} />
            <circle cx={bx} cy={by} r={r} fill={WHITE} opacity={clamp01((frame - 10 - i * 3) / 8)} />
          </g>
        );
      })}
    </svg>
  );
}

/** A small corner mark: a ring and a thin line, like a signature. */
function CornerMark({ frame, unit }: { frame: number; unit: number }) {
  const p = easeOut((frame - 6) / 20);
  return (
    <svg
      width={unit * 30}
      height={unit * 8}
      style={{ position: "absolute", left: unit * 4, top: unit * 4, opacity: p }}
    >
      <circle cx={unit * 1.2} cy={unit * 1.2} r={unit * 0.8} fill="none" stroke={HAIR} strokeWidth={Math.max(1, unit * 0.14)} />
      <line
        x1={unit * 2}
        y1={unit * 1.8}
        x2={unit * 2 + unit * 22 * p}
        y2={unit * 1.8 + unit * 3 * p}
        stroke={HAIR}
        strokeWidth={Math.max(1, unit * 0.14)}
      />
    </svg>
  );
}

/** Words arriving one by one: lowercase serif, the key word in italic. */
function Line({
  text,
  emphasis,
  frame,
  delay,
  size,
  colour = WHITE,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  delay: number;
  size: number;
  colour?: string;
}) {
  return (
    <>
      {splitWords(text.toLowerCase(), emphasis?.toLowerCase() ?? null).map(({ w, special }, i) => {
        const p = easeOut((frame - delay - i * 3) / 16);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: size * 0.24,
              fontFamily: SERIF,
              fontStyle: special ? "italic" : undefined,
              color: colour,
              opacity: p,
              transform: `translateY(${(1 - p) * size * 0.18}px)`,
            }}
          >
            {w}
          </span>
        );
      })}
    </>
  );
}

/** Small spaced capitals in a thin sans (indexes, labels). */
const label = (unit: number): React.CSSProperties => ({
  fontFamily: SANS,
  fontWeight: 300,
  fontSize: unit * 1.7,
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  color: DIM,
});

export function MinimalScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const length = Math.max(1, g.to - g.from);
  // A quick cut to black in and out; the contents take their time.
  const opacity = clamp01(frame / 4) * exitOpacity(frame, length, 6);
  const textTop = portrait ? "70%" : "66%";
  const size = unit * (portrait ? 4.4 : 3.6);

  let lines = 4;
  let drop = portrait ? 0.38 : 0.34;
  let body: React.ReactNode = null;

  if (g.type === "keyline" || g.type === "cta") {
    const text = g.type === "cta" ? g.text || ctaText(g) : g.text;
    body = (
      <div style={{ position: "absolute", left: "8%", right: "8%", top: textTop, textAlign: "center", fontSize: size, lineHeight: 1.25 }}>
        <Line text={text} emphasis={g.emphasis} frame={frame} delay={14} size={size} />
        {g.type === "cta" && (
          <div
            style={{
              margin: `${unit * 3}px auto 0`,
              width: unit * 22 * easeOut((frame - 30) / 18),
              height: Math.max(1, unit * 0.16),
              background: HAIR,
            }}
          />
        )}
      </div>
    );
  } else if (g.type === "counter" && g.number) {
    lines = 1;
    drop = portrait ? 0.3 : 0.26;
    const n = g.number;
    const p = easeInOut((frame - 12) / 40);
    const value = n.value * p;
    const shown = Number.isInteger(n.value)
      ? Math.round(value).toLocaleString("en-US")
      : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
    const big = unit * (portrait ? 15 : 12);
    body = (
      <div style={{ position: "absolute", left: 0, right: 0, top: portrait ? "50%" : "44%", textAlign: "center" }}>
        <div style={{ fontFamily: SERIF, fontSize: big, lineHeight: 1, color: WHITE, opacity: easeOut((frame - 8) / 12) }}>
          {n.prefix}
          {shown}
          {n.suffix}
        </div>
        {g.text && (
          <div style={{ marginTop: unit * 3, fontSize: size * 0.8 }}>
            <Line text={g.text} emphasis={g.emphasis} frame={frame} delay={24} size={size * 0.8} colour={DIM} />
          </div>
        )}
      </div>
    );
  } else if (g.type === "list") {
    lines = Math.max(1, Math.min(5, g.items.length));
    const step = Math.max(10, Math.min(24, (length * 0.6) / Math.max(1, g.items.length)));
    body = (
      <div style={{ position: "absolute", left: "12%", right: "12%", top: portrait ? "58%" : "55%", textAlign: "center" }}>
        {g.text && <div style={{ ...label(unit), marginBottom: unit * 3, opacity: easeOut((frame - 8) / 14) }}>{g.text}</div>}
        {g.items.map((item, i) => (
          <div key={i} style={{ fontSize: size * 0.9, lineHeight: 1.5 }}>
            <span style={{ ...label(unit), marginRight: unit * 2, opacity: easeOut((frame - 14 - i * step) / 12) }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <Line text={item} emphasis={null} frame={frame} delay={14 + i * step} size={size * 0.9} />
          </div>
        ))}
      </div>
    );
  } else if (g.type === "chapter") {
    lines = 1;
    const c = g.chapter;
    body = (
      <div style={{ position: "absolute", left: "10%", right: "10%", top: textTop, textAlign: "center" }}>
        {c && (
          <div style={{ ...label(unit), marginBottom: unit * 2.5, opacity: easeOut((frame - 8) / 14) }}>
            {String(c.index).padStart(2, "0")} / {String(c.count).padStart(2, "0")}
          </div>
        )}
        <div style={{ fontSize: size * 1.15, lineHeight: 1.2 }}>
          <Line text={g.text} emphasis={g.emphasis} frame={frame} delay={14} size={size * 1.15} />
        </div>
      </div>
    );
  }

  return (
    <AbsoluteFill style={{ background: BLACK, opacity, overflow: "hidden", fontSynthesis: "none" }}>
      <CornerMark frame={frame} unit={unit} />
      <HangingLines frame={frame} count={lines} unit={unit} width={width} height={height} drop={drop} />
      {body}
    </AbsoluteFill>
  );
}

function ctaText(g: PlacedGraphic): string {
  switch (g.cta) {
    case "subscribe":
      return "subscribe for more";
    case "comment":
      return "tell me in the comments";
    case "link":
      return "the link is below";
    default:
      return "like if this helped";
  }
}
