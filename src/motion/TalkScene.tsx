// The Studio Talk look (Podcast clip): warm and calm, like a good studio
// show. Warm charcoal, cream and one amber, a soft serif (Fraunces). A key
// line is a cream pull-quote card rising from the bottom, an amber quote
// mark, the words rising in, the key word amber, and a small waveform that
// keeps moving along its foot; a label is a charcoal topic pill with an
// amber dot; a number is a small cream stat card at the side counting up; a
// chapter is a charcoal topic card with a sound line drawing across under
// the title; behind the speakers, a key line is big cream serif. Everything
// else uses the Studio Talk skin (MinimalGraphics TALK_SKIN). The waveform
// is decoration (it doesn't follow the audio). Moves go one way and are
// gentle. No app imports: the worker bundles src/motion on its own.

import React from "react";
import { AbsoluteFill } from "remotion";
import { SANS, WARM_SERIF } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import {
  behindBand,
  clamp01,
  easeIn,
  easeInOut,
  easeOut,
  exitOpacity,
  rand,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

export const TALK_CHARCOAL = "#1C1A17";
export const TALK_CREAM = "#F2E8D5";
export const TALK_AMBER = "#E0A84E";
/** Amber dark enough to read on cream. */
const AMBER_INK = "#B7791F";
const BROWN = "#7A6A55";

/** The types the Studio Talk look draws itself. */
const TALK_TYPES = new Set<PlacedGraphic["type"]>(["keyline", "label", "counter", "chapter"]);

export const isTalkScene = (g: PlacedGraphic) =>
  TALK_TYPES.has(g.type) && (!g.behind || g.type === "keyline");

/** A word rising softly into place. */
const rise = (frame: number, at: number, size: number): React.CSSProperties => {
  const t = easeOut((frame - at) / 12);
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * size * 0.25}px)`,
    filter: t < 1 ? `blur(${(1 - t) * size * 0.05}px)` : undefined,
  };
};

function Words({
  text,
  emphasis,
  frame,
  size,
  colour,
  accent,
  delay = 0,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  size: number;
  colour: string;
  accent: string;
  delay?: number;
}) {
  return (
    <>
      {splitWords(text, emphasis).map((w, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            marginRight: size * 0.24,
            color: w.special ? accent : colour,
            ...rise(frame, delay + i * 2, size),
          }}
        >
          {w.w}
        </span>
      ))}
    </>
  );
}

/** A small waveform that keeps moving (decoration). */
function Wave({ frame, unit, bars = 28, colour = TALK_AMBER }: { frame: number; unit: number; bars?: number; colour?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: unit * 0.55, height: unit * 3.6 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const h = 0.25 + 0.75 * Math.abs(Math.sin(frame / (5 + rand(i, 1) * 4) + rand(i, 2) * 6));
        return (
          <div
            key={i}
            style={{ width: unit * 0.7, height: `${h * 100}%`, borderRadius: unit, background: colour }}
          />
        );
      })}
    </div>
  );
}

/** Leaves quickly the way it came: the last frames ease back down. */
const leave = (frame: number, length: number, frames = 8) => easeIn((frame - (length - frames)) / frames);

/** 1 · Key line: the pull-quote card rising from the bottom. */
function PullQuote({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const up = easeOut(frame / 12);
  const out = leave(frame, length);
  const size = unit * (portrait ? 6.6 : 6);
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: "linear-gradient(to top, rgba(28, 26, 23, 0.55) 0%, transparent 45%)",
          opacity: up * (1 - out),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "5%",
          right: "5%",
          bottom: portrait ? "8%" : "6%",
          background: TALK_CREAM,
          borderRadius: unit * 2.2,
          padding: `${unit * 3}px ${unit * 3.6}px ${unit * 2.6}px`,
          boxShadow: "0 1.2em 3em -1em rgba(0, 0, 0, 0.45)",
          transform: `translateY(${(1 - up + out) * 130}%)`,
          // A slow drift up while it holds (one way, never back).
          translate: `0 ${-unit * 0.8 * easeInOut(frame / length)}px`,
        }}
      >
        <div
          style={{
            fontFamily: WARM_SERIF,
            fontSize: size * 3.2,
            fontWeight: 600,
            lineHeight: 0.62,
            height: size * 1.1,
            color: TALK_AMBER,
            opacity: clamp01((frame - 6) / 6),
          }}
        >
          &ldquo;
        </div>
        <div
          style={{
            fontFamily: WARM_SERIF,
            fontWeight: 600,
            fontSize: size,
            lineHeight: 1.18,
            letterSpacing: "-0.015em",
            color: TALK_CHARCOAL,
          }}
        >
          <Words text={g.text} emphasis={g.emphasis} frame={frame} size={size} colour={TALK_CHARCOAL} accent={AMBER_INK} delay={8} />
        </div>
        <div style={{ marginTop: unit * 2, opacity: clamp01((frame - 12) / 8) }}>
          <Wave frame={frame} unit={unit} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** 2 · Label: a charcoal topic pill with an amber dot, low left. */
function Pill({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const t = easeOut(frame / 10);
  const out = leave(frame, length);
  const size = unit * (portrait ? 4.4 : 4.2);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "6%",
          bottom: portrait ? "16%" : "11%",
          display: "flex",
          alignItems: "center",
          gap: size * 0.55,
          background: TALK_CHARCOAL,
          color: TALK_CREAM,
          borderRadius: 999,
          padding: `${size * 0.5}px ${size * 0.9}px`,
          fontFamily: SANS,
          fontWeight: 500,
          fontSize: size,
          boxShadow: "0 0.6em 1.6em -0.6em rgba(0, 0, 0, 0.5)",
          opacity: t * (1 - out),
          transform: `translateY(${(1 - t) * size * 1.2}px)`,
        }}
      >
        <div
          style={{
            width: size * 0.5,
            height: size * 0.5,
            borderRadius: "50%",
            background: TALK_AMBER,
            transform: `scale(${easeOut((frame - 6) / 8)})`,
          }}
        />
        {g.text}
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

/** 3 · Number: a small cream stat card at the side, counting up. */
function Stat({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const t = easeOut(frame / 12);
  const out = leave(frame, length);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          right: "6%",
          top: portrait ? "14%" : "12%",
          background: TALK_CREAM,
          borderRadius: unit * 2,
          padding: `${unit * 2.4}px ${unit * 3.2}px`,
          boxShadow: "0 1em 2.6em -1em rgba(0, 0, 0, 0.5)",
          opacity: t * (1 - out),
          transform: `translateX(${(1 - t) * unit * 6}px)`,
        }}
      >
        <div
          style={{
            fontFamily: WARM_SERIF,
            fontWeight: 600,
            fontSize: unit * (portrait ? 13 : 10),
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: TALK_CHARCOAL,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {shownNumber(n, easeOut((frame - 4) / 26))}
        </div>
        {g.text && (
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 600,
              fontSize: unit * (portrait ? 2.6 : 2.1),
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: BROWN,
              marginTop: unit * 1.2,
            }}
          >
            {g.text}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** 4 · Chapter: a charcoal topic card, a sound line drawing across under the title. */
function Topic({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const size = unit * (portrait ? 8 : 6.4);
  const draw = easeInOut((frame - 10) / 30);
  const w = 200;
  const path = Array.from({ length: 41 })
    .map((_, i) => {
      const x = (i / 40) * w;
      const y = 10 + Math.sin(i * 0.9) * (3 + 5 * Math.abs(Math.sin(i * 0.37)));
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <AbsoluteFill
      style={{ background: TALK_CHARCOAL, opacity: Math.min(easeOut(frame / 8), exitOpacity(frame, length, 8)) }}
    >
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse 70% 55% at 50% 40%, rgba(224, 168, 78, 0.12), transparent 70%)",
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 9%",
          transform: `scale(${1 + 0.03 * easeInOut(frame / length)})`,
        }}
      >
        {g.chapter && (
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 600,
              fontSize: unit * (portrait ? 2.8 : 2.3),
              letterSpacing: "0.3em",
              color: TALK_AMBER,
              marginBottom: unit * 2.6,
              ...rise(frame, 2, unit * 3),
            }}
          >
            {`TOPIC ${String(g.chapter.index).padStart(2, "0")}`}
          </div>
        )}
        <div style={{ fontFamily: WARM_SERIF, fontWeight: 600, fontSize: size, lineHeight: 1.12, letterSpacing: "-0.02em" }}>
          <Words text={g.text} emphasis={g.emphasis} frame={frame} size={size} colour={TALK_CREAM} accent={TALK_AMBER} delay={6} />
        </div>
        <svg
          viewBox={`0 0 ${w} 20`}
          style={{ width: unit * (portrait ? 56 : 44), marginTop: unit * 3.4, overflow: "visible" }}
        >
          <path
            d={path}
            fill="none"
            stroke={TALK_AMBER}
            strokeWidth={1.4}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - draw}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** 5 · Behind the speakers: big cream serif around head height. */
function Behind({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const size = unit * (portrait ? 13 : 10.5);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 8) }}>
      <div
        style={{
          ...behindBand(portrait),
          fontFamily: WARM_SERIF,
          fontWeight: 600,
          fontSize: size,
          lineHeight: 1.02,
          letterSpacing: "-0.025em",
          padding: "0 5%",
          textShadow: "0 0.04em 0.2em rgba(0, 0, 0, 0.4)",
          transform: `scale(${1 + 0.03 * easeInOut(frame / length)})`,
        }}
      >
        <div>
          <Words text={g.text} emphasis={g.emphasis} frame={frame} size={size} colour={TALK_CREAM} accent={TALK_AMBER} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function TalkScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  switch (g.type) {
    case "label":
      return <Pill {...props} />;
    case "counter":
      return <Stat {...props} />;
    case "chapter":
      return <Topic {...props} />;
    default:
      return g.behind ? <Behind {...props} /> : <PullQuote {...props} />;
  }
}
