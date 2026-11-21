// The Impact look (3-second hook): loud and fast. Huge condensed capitals
// (Anton), black, white and one acid yellow. A key line stamps on one word
// per beat over the darkened footage, the key word slamming in on a yellow
// block with a one-frame white flash; a number cuts to black and counts fast,
// filling the frame in yellow; a chapter is a slanted yellow panel whipping
// across to a black card with a giant number; a label is a yellow tag that
// snaps in from the side. Behind the speaker, key lines are giant capitals.
// Everything else uses the Impact skin (MinimalGraphics IMPACT_SKIN).
// Stamps are this look's grammar (the one place a scale-in is used); every
// move still goes one way only and the camera never stops. No app imports:
// the worker bundles src/motion on its own.

import React from "react";
import { AbsoluteFill } from "remotion";
import { DISPLAY } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import {
  behindBand,
  clamp01,
  easeIn,
  easeInOut,
  easeOut,
  exitOpacity,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

export const IMPACT_YELLOW = "#E6FF00";
export const IMPACT_BLACK = "#0A0A0A";
const WHITE = "#FFFFFF";

/** The types the Impact look draws itself. */
const IMPACT_TYPES = new Set<PlacedGraphic["type"]>(["keyline", "chapter", "counter", "label"]);

export const isImpactScene = (g: PlacedGraphic) =>
  IMPACT_TYPES.has(g.type) && (!g.behind || g.type === "keyline");

/**
 * A stamp: lands from 118% to 100% in 4 frames, fully on from its first
 * frame. Before it lands it takes no space, so the words already there stay
 * dead centre as the line builds.
 */
const stamp = (frame: number, at: number): React.CSSProperties => {
  if (frame < at) return { display: "none" };
  const t = easeOut((frame - at) / 4);
  return { transform: `scale(${1.18 - 0.18 * t})` };
};

/** The camera that never stops: a slow push over the whole graphic, one way. */
const push = (frame: number, length: number, amount = 0.05): React.CSSProperties => ({
  transform: `scale(${1 + amount * easeInOut(frame / length)})`,
});

/** The beat each word lands on (frames apart; the key word waits one beat more). */
const BEAT = 4;

function Stamped({
  text,
  emphasis,
  frame,
  size,
  delay = 0,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  size: number;
  delay?: number;
}) {
  const words = splitWords(text.toUpperCase(), emphasis?.toUpperCase() ?? null);
  let at = delay;
  return (
    <div style={{ fontFamily: DISPLAY, lineHeight: 1.02, textAlign: "center" }}>
      {words.map((w, i) => {
        if (w.special && i > 0 && !words[i - 1].special) at += BEAT;
        const land = at;
        at += BEAT;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              margin: `0 ${size * 0.12}px ${size * 0.1}px`,
              fontSize: w.special ? size * 1.25 : size,
              color: w.special ? IMPACT_BLACK : WHITE,
              ...(w.special ? { background: IMPACT_YELLOW, padding: `0 ${size * 0.14}px` } : {}),
              ...stamp(frame, land),
            }}
          >
            {w.w}
          </span>
        );
      })}
    </div>
  );
}

/** The frame the key word lands on (for its flash). */
function keyLanding(text: string, emphasis: string | null, delay = 0): number | null {
  const words = splitWords(text, emphasis);
  let at = delay;
  for (let i = 0; i < words.length; i++) {
    if (words[i].special && i > 0 && !words[i - 1].special) at += BEAT;
    if (words[i].special) return at;
    at += BEAT;
  }
  return null;
}

/** One white frame (two at 30 fps) as the key word lands. */
function Flash({ frame, at }: { frame: number; at: number | null }) {
  if (at == null || frame < at || frame >= at + 2) return null;
  return <AbsoluteFill style={{ background: WHITE, opacity: 0.55 }} />;
}

/** 1 · Key line: stamped over the darkened footage. */
function Stamp({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const size = unit * (portrait ? 13 : 10);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 4) }}>
      <AbsoluteFill style={{ background: "rgba(5, 5, 5, 0.62)", opacity: clamp01(frame / 3) }} />
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", padding: "0 6%", ...push(frame, length) }}
      >
        <Stamped text={g.text} emphasis={g.emphasis} frame={frame} size={size} />
      </AbsoluteFill>
      <Flash frame={frame} at={keyLanding(g.text, g.emphasis)} />
    </AbsoluteFill>
  );
}

/** 2 · Key line behind the speaker: giant capitals around head height. */
function Behind({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const size = unit * (portrait ? 15 : 12);
  const words = splitWords(g.text.toUpperCase(), g.emphasis?.toUpperCase() ?? null);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 4) }}>
      <div style={{ ...behindBand(portrait), ...push(frame, length, 0.04) }}>
        <div style={{ fontFamily: DISPLAY, fontSize: size, lineHeight: 0.98, padding: "0 4%" }}>
          {words.map((w, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                margin: `0 ${size * 0.1}px`,
                color: w.special ? IMPACT_YELLOW : WHITE,
                textShadow: "0 0.04em 0.18em rgba(0, 0, 0, 0.45)",
                ...stamp(frame, i * 3),
              }}
            >
              {w.w}
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** The number as said, counted up to (prefix, separators, suffix). */
function shownNumber(n: NonNullable<PlacedGraphic["number"]>, t: number) {
  const decimals = Number.isInteger(n.value)
    ? 0
    : Math.min(2, String(n.value).split(".")[1]?.length ?? 0);
  return `${n.prefix}${(n.value * t).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${n.suffix}`;
}

/** 3 · Number: cut to black, a fast count that fills the frame in yellow. */
function Slam({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const count = easeOut(frame / 16);
  const shown = shownNumber(n, count);
  // Fits the final number's width: fewer characters, bigger type.
  const chars = Math.max(2, shownNumber(n, 1).length);
  const size = Math.min(unit * (portrait ? 44 : 34), (unit * (portrait ? 150 : 210)) / chars);
  return (
    <AbsoluteFill
      style={{ background: IMPACT_BLACK, opacity: exitOpacity(frame, length, 4), overflow: "hidden" }}
    >
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", ...push(frame, length, 0.06) }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: size,
            lineHeight: 1,
            color: IMPACT_YELLOW,
            fontVariantNumeric: "tabular-nums",
            ...stamp(frame, 0),
          }}
        >
          {shown}
        </div>
        {g.text && (
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: unit * (portrait ? 6 : 4.6),
              letterSpacing: "0.08em",
              color: WHITE,
              marginTop: unit * 2,
              textTransform: "uppercase",
              ...stamp(frame, 14),
            }}
          >
            {g.text}
          </div>
        )}
      </AbsoluteFill>
      <Flash frame={frame} at={16} />
    </AbsoluteFill>
  );
}

/** 4 · Chapter: a slanted yellow panel whips across, clearing to a black card. */
function Whip({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  // The panel crosses left to right in 8 frames: covers, then uncovers the card.
  const t = easeInOut(frame / 8);
  const card = frame >= 4;
  const index = g.chapter ? String(g.chapter.index).padStart(2, "0") : null;
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 4), overflow: "hidden" }}>
      {card && (
        <AbsoluteFill style={{ background: IMPACT_BLACK }}>
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: "0 7%",
              textAlign: "center",
              ...push(frame, length, 0.05),
            }}
          >
            {index && (
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: unit * (portrait ? 40 : 30),
                  lineHeight: 0.9,
                  color: IMPACT_YELLOW,
                  ...stamp(frame, 6),
                }}
              >
                {index}
              </div>
            )}
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: unit * (portrait ? 10 : 7.5),
                lineHeight: 1.02,
                color: WHITE,
                marginTop: unit * 2,
                textTransform: "uppercase",
                ...stamp(frame, 10),
              }}
            >
              {g.text}
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      )}
      {frame < 9 && (
        <div
          style={{
            position: "absolute",
            top: "-10%",
            bottom: "-10%",
            width: "70%",
            left: `${-80 + t * 190}%`,
            background: IMPACT_YELLOW,
            transform: "skewX(-14deg)",
          }}
        />
      )}
    </AbsoluteFill>
  );
}

/** 5 · Label: a yellow tag snapping in from the side, low and out of the face. */
function Tag({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const t = easeOut(frame / 5);
  const leave = easeIn((frame - (length - 5)) / 5);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: portrait ? "6%" : "5%",
          bottom: portrait ? "22%" : "15%",
          maxWidth: portrait ? "84%" : "60%",
          background: IMPACT_YELLOW,
          color: IMPACT_BLACK,
          fontFamily: DISPLAY,
          fontSize: unit * (portrait ? 6.4 : 5),
          lineHeight: 1.05,
          padding: `${unit * 1}px ${unit * 2.2}px`,
          textTransform: "uppercase",
          transform: `translateX(${(-(1 - t) - leave) * 130}%)`,
        }}
      >
        {g.text}
      </div>
    </AbsoluteFill>
  );
}

export function ImpactScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  switch (g.type) {
    case "chapter":
      return <Whip {...props} />;
    case "counter":
      return <Slam {...props} />;
    case "label":
      return <Tag {...props} />;
    default:
      return g.behind ? <Behind {...props} /> : <Stamp {...props} />;
  }
}
