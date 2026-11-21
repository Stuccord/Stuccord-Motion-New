// The Notebook look (Micro-lesson): a lesson written in a notebook. Off-white
// grid paper, ink blue, a yellow marker and a red pen, handwriting (Caveat)
// with a clean sans (Inter). A chapter is a tip page that slides in: a giant
// handwritten tip number writes itself, then the title, a marker swiping
// behind the key word; a key line is a torn paper strip over the footage,
// the marker swiping across the key word; a list is a checklist page, each
// point arriving with a hand-drawn tick; a number counts up on a paper card
// and a red pen circles it; a label is a tilted yellow sticky note. Everything
// else uses the Notebook skin (MinimalGraphics NOTEBOOK_SKIN). Moves go one
// way. No app imports: the worker bundles src/motion on its own.

import React from "react";
import { AbsoluteFill } from "remotion";
import { HAND, SANS } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import { stepStarts } from "@/motion/beats";
import {
  clamp01,
  easeIn,
  easeInOut,
  easeOut,
  exitOpacity,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

export const NOTE_PAPER = "#FAFAF6";
export const NOTE_INK = "#1F3A93";
export const NOTE_MARKER = "#FFE45C";
export const NOTE_RED = "#E5484D";
const GRID = "#DDE6F0";

/** The types the Notebook look draws itself. */
const NOTEBOOK_TYPES = new Set<PlacedGraphic["type"]>(["chapter", "keyline", "list", "counter", "label"]);

export const isNotebookScene = (g: PlacedGraphic) => NOTEBOOK_TYPES.has(g.type) && !g.behind;

/** Grid paper (lines every `cell` px). */
const paper = (cell: number): React.CSSProperties => ({
  backgroundColor: NOTE_PAPER,
  backgroundImage: `linear-gradient(${GRID} 1px, transparent 1px), linear-gradient(90deg, ${GRID} 1px, transparent 1px)`,
  backgroundSize: `${cell}px ${cell}px`,
});

/** The marker swiping left to right behind a word (`t` 0 → 1). */
const marker = (t: number): React.CSSProperties => ({
  backgroundImage: `linear-gradient(${NOTE_MARKER}, ${NOTE_MARKER})`,
  backgroundRepeat: "no-repeat",
  backgroundSize: `${clamp01(t) * 100}% 78%`,
  backgroundPosition: "0 70%",
  padding: "0 0.12em",
  margin: "0 -0.12em",
});

/** A line with the key word marked, the marker swiping from `at`. */
function Marked({ text, emphasis, frame, at }: { text: string; emphasis: string | null; frame: number; at: number }) {
  const t = easeInOut((frame - at) / 10);
  return (
    <>
      {splitWords(text, emphasis).map((w, i) => (
        <React.Fragment key={i}>
          {i > 0 && " "}
          <span style={w.special ? marker(t) : undefined}>{w.w}</span>
        </React.Fragment>
      ))}
    </>
  );
}

/** Handwriting appearing left to right, as if written (`t` 0 → 1). */
const written = (t: number): React.CSSProperties => ({
  clipPath: `inset(-20% ${(1 - clamp01(t)) * 100}% -20% -5%)`,
});

/** A hand-drawn stroke drawing on (an SVG path with pathLength 1). */
function Stroke({ d, t, colour, width, viewBox, style }: { d: string; t: number; colour: string; width: number; viewBox: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox={viewBox} style={{ overflow: "visible", ...style }}>
      <path
        d={d}
        fill="none"
        stroke={colour}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - clamp01(t)}
      />
    </svg>
  );
}

/** The page sliding in from the right (and on, a little, as it leaves). */
const slide = (frame: number, length: number): React.CSSProperties => {
  const t = easeOut(frame / 10);
  const out = easeIn((frame - (length - 8)) / 8);
  return { transform: `translateX(${(1 - t) * 100 - out * 100}%)` };
};

/** 1 · Chapter: a tip page, a giant handwritten number, the title, the marker. */
function TipPage({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const index = g.chapter?.index ?? null;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ ...paper(unit * 4.5), ...slide(frame, length) }}>
        <AbsoluteFill
          style={{
            flexDirection: portrait ? "column" : "row",
            alignItems: "center",
            justifyContent: "center",
            gap: unit * (portrait ? 1 : 4),
            padding: "0 8%",
            transform: `scale(${1 + 0.03 * easeInOut(frame / length)})`,
          }}
        >
          {index != null && (
            <div
              style={{
                fontFamily: HAND,
                fontWeight: 700,
                fontSize: unit * (portrait ? 42 : 34),
                lineHeight: 0.9,
                color: NOTE_INK,
                ...written((frame - 8) / 10),
              }}
            >
              {index}
            </div>
          )}
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 800,
              fontSize: unit * (portrait ? 8 : 6.4),
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              color: NOTE_INK,
              textAlign: portrait ? "center" : "left",
              maxWidth: portrait ? "100%" : "55%",
              opacity: easeOut((frame - 16) / 8),
              transform: `translateY(${(1 - easeOut((frame - 16) / 8)) * unit * 2}px)`,
            }}
          >
            <Marked text={g.text} emphasis={g.emphasis} frame={frame} at={26} />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** A torn edge: the strip's outline, jagged top and bottom. */
function tornClip(teeth = 36): string {
  const pts: string[] = [];
  for (let i = 0; i <= teeth; i++) pts.push(`${(i / teeth) * 100}% ${i % 2 ? 4 : 0}%`);
  for (let i = teeth; i >= 0; i--) pts.push(`${(i / teeth) * 100}% ${i % 2 ? 96 : 100}%`);
  return `polygon(${pts.join(", ")})`;
}

/** 2 · Key line: a torn paper strip over the footage, the marker on the key word. */
function Strip({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const t = easeOut(frame / 9);
  const out = easeIn((frame - (length - 7)) / 7);
  const size = unit * (portrait ? 6.4 : 5);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "4%",
          right: "4%",
          bottom: portrait ? "14%" : "9%",
          ...paper(unit * 3.2),
          clipPath: tornClip(),
          filter: "drop-shadow(0 0.4em 0.8em rgba(0, 0, 0, 0.35))",
          padding: `${size * 0.7}px ${size * 0.8}px`,
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.18,
          letterSpacing: "-0.015em",
          color: NOTE_INK,
          textAlign: "center",
          transform: `translateY(${(1 - t + out) * 140}%) rotate(${-0.8 + 0.8 * t}deg)`,
        }}
      >
        <Marked text={g.text} emphasis={g.emphasis} frame={frame} at={12} />
      </div>
    </AbsoluteFill>
  );
}

/** 3 · List: a checklist page, each point with a hand-drawn tick as it's reached. */
function Checklist({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const items = g.items.length ? g.items : [g.text];
  const starts = stepStarts(items.length, length);
  const size = unit * (portrait ? 5.6 : 4.4);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ ...paper(unit * 4.5), ...slide(frame, length) }}>
        <AbsoluteFill style={{ justifyContent: "center", padding: portrait ? "0 9%" : "0 14%" }}>
          {g.text && items[0] !== g.text && (
            <div
              style={{
                fontFamily: HAND,
                fontWeight: 700,
                fontSize: size * 1.5,
                color: NOTE_RED,
                marginBottom: size * 0.6,
                ...written((frame - 6) / 10),
              }}
            >
              {g.text}
            </div>
          )}
          {items.map((item, i) => {
            const at = Math.max(10, starts[i] ?? 0);
            const on = frame >= at;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: size * 0.6,
                  marginBottom: size * 0.55,
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: size,
                  color: NOTE_INK,
                  opacity: on ? 1 : 0.28,
                }}
              >
                <div style={{ position: "relative", width: size * 1.1, height: size * 1.1, flex: "none" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: size * 0.08,
                      border: `${Math.max(2, size * 0.07)}px solid ${NOTE_INK}`,
                      borderRadius: size * 0.12,
                    }}
                  />
                  <Stroke
                    d="M 4 13 L 10 20 L 22 3"
                    viewBox="0 0 24 24"
                    t={(frame - at) / 7}
                    colour={NOTE_RED}
                    width={3.4}
                    style={{ position: "absolute", inset: -size * 0.1, width: size * 1.3, height: size * 1.3 }}
                  />
                </div>
                {item}
              </div>
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
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

/** 4 · Number: a paper card counts up, then a red pen circles it. */
function Circled({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const t = easeOut(frame / 10);
  const out = easeIn((frame - (length - 7)) / 7);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          right: "6%",
          top: portrait ? "16%" : "14%",
          ...paper(unit * 3),
          borderRadius: unit * 0.6,
          boxShadow: "0 0.6em 1.4em -0.4em rgba(0, 0, 0, 0.4)",
          padding: `${unit * 2.6}px ${unit * 4}px ${unit * 1.8}px`,
          textAlign: "center",
          transform: `translateY(${(1 - t) * unit * 4}px) rotate(1.5deg)`,
          opacity: t * (1 - out),
        }}
      >
        <div style={{ position: "relative", display: "inline-block" }}>
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 800,
              fontSize: unit * (portrait ? 12 : 9.5),
              lineHeight: 1,
              letterSpacing: "-0.03em",
              color: NOTE_INK,
              fontVariantNumeric: "tabular-nums",
              padding: `0 ${unit * 1.5}px`,
            }}
          >
            {shownNumber(n, easeOut((frame - 4) / 20))}
          </div>
          <Stroke
            d="M 52 6 C 20 4, 3 18, 5 34 C 7 52, 40 60, 70 55 C 96 50, 100 26, 86 13 C 74 3, 50 2, 38 8"
            viewBox="0 0 100 60"
            t={(frame - 24) / 12}
            colour={NOTE_RED}
            width={2.6}
            style={{ position: "absolute", left: "-14%", top: "-30%", width: "128%", height: "160%" }}
          />
        </div>
        {g.text && (
          <div
            style={{
              fontFamily: HAND,
              fontWeight: 700,
              fontSize: unit * (portrait ? 5 : 4),
              color: NOTE_INK,
              marginTop: unit * 1.6,
              ...written((frame - 12) / 10),
            }}
          >
            {g.text}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** 5 · Label: a tilted yellow sticky note slapped on low left. */
function Sticky({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const t = easeOut(frame / 6);
  const out = easeIn((frame - (length - 6)) / 6);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "6%",
          bottom: portrait ? "18%" : "12%",
          maxWidth: portrait ? "70%" : "45%",
          background: NOTE_MARKER,
          boxShadow: "0 0.5em 1.2em -0.3em rgba(0, 0, 0, 0.45)",
          padding: `${unit * 2}px ${unit * 3}px`,
          fontFamily: HAND,
          fontWeight: 700,
          fontSize: unit * (portrait ? 7 : 5.6),
          lineHeight: 1.05,
          color: NOTE_INK,
          transform: `rotate(-3deg) scale(${1.12 - 0.12 * t})`,
          opacity: clamp01(t * 3) * (1 - out),
        }}
      >
        <span style={written((frame - 4) / 10)}>{g.text}</span>
      </div>
    </AbsoluteFill>
  );
}

export function NotebookScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  switch (g.type) {
    case "chapter":
      return <TipPage {...props} />;
    case "list":
      return <Checklist {...props} />;
    case "counter":
      return <Circled {...props} />;
    case "label":
      return <Sticky {...props} />;
    default:
      return (
        <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 2) }}>
          <Strip {...props} />
        </AbsoluteFill>
      );
  }
}
