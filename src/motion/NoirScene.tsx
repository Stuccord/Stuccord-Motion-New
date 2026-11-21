// The Noir look (Cinematic story): a black-and-white film. Typewriter type
// (Special Elite), off-white on black, one red word. A chapter opens out of
// black through an iris and its title types itself with a caret; a key line
// types low in frame while one hard slice of light sweeps across the
// footage; a story shows its AI pictures as black-and-white stills with a
// slow push, each scene closing and opening through an iris; a label is a
// typed place-and-time caption; a number types out digit by digit on a black
// card with a red rule drawing under it. Everything else uses the Noir skin
// (MinimalGraphics NOIR_SKIN). The video's finish (looks.ts) makes the
// footage black and white, with heavy grain, a vignette and thin bars.
// Moves go one way only and are slow. No app imports: the worker bundles
// src/motion on its own.

import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { TYPEWRITER } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import {
  ImagesContext,
  clamp01,
  easeInOut,
  easeOut,
  exitOpacity,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

export const NOIR_BLACK = "#0C0C0C";
export const NOIR_RED = "#D7262E";
export const NOIR_INK = "#EDEDED";
const DIM = "rgba(237, 237, 237, 0.6)";
const SHADOW = "0 2px 10px rgba(0, 0, 0, 0.8)";

/** The types the Noir look draws itself. */
const NOIR_TYPES = new Set<PlacedGraphic["type"]>(["keyline", "chapter", "story", "label", "counter"]);

export const isNoirScene = (g: PlacedGraphic) => NOIR_TYPES.has(g.type) && !g.behind;

/** Frames (at 30 fps) per letter the typewriter types: about 25 letters a second. */
const PER_LETTER = 1.2;

/**
 * Words typed out letter by letter from `delay`, the key word in red, a
 * caret after the last letter typed that blinks once it's done.
 */
function Typed({
  text,
  emphasis,
  frame,
  delay = 0,
  colour = NOIR_INK,
  caret = true,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  delay?: number;
  colour?: string;
  caret?: boolean;
}) {
  const words = splitWords(text, emphasis);
  const total = words.reduce((n, w) => n + w.w.length + 1, 0) - 1;
  const typed = Math.max(0, Math.floor((frame - delay) / PER_LETTER));
  const done = typed >= total;
  let left = typed;
  return (
    <span>
      {words.map((w, i) => {
        const shown = Math.max(0, Math.min(w.w.length, left));
        left -= w.w.length + 1;
        if (shown === 0 && i > 0) return null;
        return (
          <span key={i} style={{ color: w.special ? NOIR_RED : colour }}>
            {i > 0 ? " " : ""}
            {w.w.slice(0, shown)}
          </span>
        );
      })}
      {caret && (!done || Math.floor(frame / 10) % 2 === 0) && frame >= delay && (
        <span style={{ color: colour, opacity: 0.85 }}>_</span>
      )}
    </span>
  );
}

/** An iris: a circle of picture in black, `t` 0 (closed) to 1 (open past the corners). */
function irisMask(t: number): React.CSSProperties {
  // Fully open, the circle reaches past the corners (100% is the farthest corner).
  if (t >= 1) return {};
  const r = 102 * clamp01(t);
  const mask = `radial-gradient(circle farthest-corner at 50% 50%, #000 ${r}%, transparent ${r + 0.6}%)`;
  return { WebkitMaskImage: mask, maskImage: mask };
}

/** A slow push, one way, over a graphic's life. */
const push = (frame: number, life: number, amount = 0.06): React.CSSProperties => ({
  transform: `scale(${1 + amount * easeInOut(frame / Math.max(1, life))})`,
});

/** 1 · Chapter: an iris opens out of black, the title types itself. */
function Chapter({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const open = easeInOut(frame / 14);
  const words = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
  const index = g.chapter?.index ?? 0;
  const head = index ? `CHAPTER ${words[index - 1] ?? index}` : "";
  return (
    <AbsoluteFill style={{ background: "#000", opacity: exitOpacity(frame, length, 8) }}>
      <AbsoluteFill style={{ background: NOIR_BLACK, ...irisMask(open) }}>
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "0 9%",
            fontFamily: TYPEWRITER,
            ...push(frame, length, 0.04),
          }}
        >
          {head && (
            <div
              style={{
                fontSize: unit * (portrait ? 3.2 : 2.6),
                letterSpacing: "0.3em",
                color: DIM,
                marginBottom: unit * 3,
                opacity: easeOut((frame - 10) / 10),
              }}
            >
              {head}
            </div>
          )}
          <div style={{ fontSize: unit * (portrait ? 7.4 : 6), lineHeight: 1.25, color: NOIR_INK }}>
            <Typed text={g.text.toLowerCase()} emphasis={g.emphasis?.toLowerCase() ?? null} frame={frame} delay={16} />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** 2 · Key line: typed low in frame while one hard slice of light sweeps across. */
function KeyLine({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  // The light crosses once, left to right, over the first ~1.5 s.
  const x = -40 + 180 * easeInOut(frame / 44);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 8) }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(100deg, transparent ${x - 18}%, rgba(255, 255, 255, 0.26) ${x}%, transparent ${x + 14}%)`,
          mixBlendMode: "screen",
          opacity: frame < 50 ? 1 : 0,
        }}
      />
      <AbsoluteFill
        style={{
          background: "linear-gradient(to top, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.25) 30%, transparent 50%)",
          opacity: easeOut(frame / 10),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          bottom: portrait ? "20%" : "13%",
          textAlign: "center",
          fontFamily: TYPEWRITER,
          fontSize: unit * (portrait ? 6.6 : 5.2),
          lineHeight: 1.25,
          color: NOIR_INK,
          textShadow: SHADOW,
        }}
      >
        <Typed text={g.text} emphasis={g.emphasis} frame={frame} delay={4} />
      </div>
    </AbsoluteFill>
  );
}

/** 3 · Story: black-and-white stills, a slow push each, an iris between scenes. */
function Story({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const images = React.useContext(ImagesContext);
  const scenes = g.scenes ?? [];
  const starts = scenes.map((sc) => Math.max(0, sc.from - g.from));
  const current = starts.reduce((c, s, i) => (frame >= s ? i : c), 0);
  const sc = scenes[current];
  if (!sc) return null;
  const start = starts[current];
  const end = starts[current + 1] ?? length;
  const life = end - start;
  const local = frame - start;
  // Opens over 10 frames, closes over the last 8 before the next scene (the last one fades instead).
  const last = current === scenes.length - 1;
  const open = easeOut(local / 10);
  const close = last ? 1 : 1 - easeInOut((local - (life - 8)) / 8);
  const url = sc.image ? images[sc.image] : undefined;
  return (
    <AbsoluteFill style={{ background: "#000", opacity: exitOpacity(frame, length, 8) }}>
      <AbsoluteFill style={irisMask(Math.min(open, close))}>
        {url ? (
          <AbsoluteFill style={push(local, life, 0.07)}>
            <Img
              src={url}
              style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(1) contrast(1.15)" }}
            />
          </AbsoluteFill>
        ) : (
          <AbsoluteFill style={{ background: NOIR_BLACK }} />
        )}
        <AbsoluteFill
          style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0, 0, 0, 0.75) 100%)" }}
        />
        {sc.text && (
          <div
            style={{
              position: "absolute",
              left: "8%",
              right: "8%",
              bottom: portrait ? "14%" : "10%",
              textAlign: "center",
              fontFamily: TYPEWRITER,
              fontSize: unit * (portrait ? 5 : 4),
              lineHeight: 1.3,
              color: NOIR_INK,
              textShadow: SHADOW,
            }}
          >
            <Typed text={sc.text} emphasis={sc.emphasis} frame={local} delay={10} caret={false} />
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** 4 · Label: a typed place-and-time caption, low left, no box. */
function Caption({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 8) }}>
      <div
        style={{
          position: "absolute",
          left: portrait ? "7%" : "5%",
          right: "30%",
          bottom: portrait ? "18%" : "12%",
          fontFamily: TYPEWRITER,
          fontSize: unit * (portrait ? 4.6 : 3.6),
          letterSpacing: "0.06em",
          color: NOIR_INK,
          textShadow: SHADOW,
        }}
      >
        <Typed text={g.text.toUpperCase()} emphasis={null} frame={frame} delay={2} />
      </div>
    </AbsoluteFill>
  );
}

/** The number as said (prefix, separators, suffix). */
function numberText(n: NonNullable<PlacedGraphic["number"]>) {
  const decimals = Number.isInteger(n.value)
    ? 0
    : Math.min(2, String(n.value).split(".")[1]?.length ?? 0);
  return `${n.prefix}${n.value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${n.suffix}`;
}

/** 5 · Number: typed out on a black card, a red rule drawing under it. */
function Figure({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const shown = numberText(g.number ?? { value: 0, prefix: "", suffix: "" });
  // Digits type slower than words: each one lands.
  const typed = Math.max(0, Math.floor((frame - 6) / 3));
  const done = typed >= shown.length;
  const rule = easeOut((frame - (6 + shown.length * 3)) / 12);
  return (
    <AbsoluteFill
      style={{ background: NOIR_BLACK, opacity: Math.min(easeOut(frame / 6), exitOpacity(frame, length, 8)) }}
    >
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", fontFamily: TYPEWRITER, ...push(frame, length, 0.04) }}
      >
        <div style={{ fontSize: unit * (portrait ? 20 : 16), lineHeight: 1, color: NOIR_INK }}>
          {shown.slice(0, typed)}
          {(!done || Math.floor(frame / 10) % 2 === 0) && <span style={{ opacity: 0.8 }}>_</span>}
        </div>
        <div
          style={{
            width: unit * (portrait ? 40 : 30),
            height: Math.max(2, unit * 0.5),
            background: NOIR_RED,
            marginTop: unit * 2,
            transform: `scaleX(${rule})`,
          }}
        />
        {g.text && (
          <div
            style={{
              fontSize: unit * (portrait ? 3.4 : 2.7),
              letterSpacing: "0.3em",
              color: DIM,
              marginTop: unit * 3,
              textTransform: "uppercase",
              opacity: clamp01(rule * 1.4),
            }}
          >
            {g.text}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function NoirScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  switch (g.type) {
    case "chapter":
      return <Chapter {...props} />;
    case "story":
      return <Story {...props} />;
    case "label":
      return <Caption {...props} />;
    case "counter":
      return <Figure {...props} />;
    default:
      return <KeyLine {...props} />;
  }
}

