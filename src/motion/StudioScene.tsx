// The Studio 3D look (Product demo): the product shot in a light studio, as
// in saas-animation's level 1 - real UI in 3D space, one light, shallow depth
// of field, one continuous camera, shapes that turn into the next shot. An
// app screen floats on a seamless light stage with a soft floor shadow and an
// out-of-focus back wall; a key line is a white card tilting up out of depth
// over the footage, its words fading up from blurred to sharp; a chapter is a
// blue disc that squashes, then stretches into a rounded card holding the
// title; a number is a white card turning in from the side in perspective;
// a list is a stack of feature cards arriving from the back of the stage,
// the newest in focus. Everything else uses the Studio skin (MinimalGraphics
// STUDIO_SKIN). Every move goes one way. No app imports: the worker bundles
// src/motion on its own.

import React from "react";
import { AbsoluteFill } from "remotion";
import { GROTESK, SANS, type MotionTheme } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import { itemStarts, stepStarts } from "@/motion/beats";
import { ScreenGraphic } from "@/motion/ScreenGraphic";
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

export const STUDIO_STAGE = "#EEEEEB";
export const STUDIO_INK = "#14161A";
export const STUDIO_BLUE = "#2B5CFF";
const SOFT = "#6B6B66";

/** The types the Studio 3D look draws itself. */
const STUDIO_TYPES = new Set<PlacedGraphic["type"]>([
  "screen",
  "keyline",
  "chapter",
  "counter",
  "list",
]);

export const isStudioScene = (g: PlacedGraphic) => STUDIO_TYPES.has(g.type) && !g.behind;

/**
 * The seamless studio stage: a light wall curving into the floor, lit from
 * the upper left, the back softly out of focus (a blurred glow, not detail).
 */
const STAGE_BG = [
  "radial-gradient(ellipse 60% 45% at 30% 22%, rgba(255, 255, 255, 0.9), transparent 70%)",
  "radial-gradient(ellipse 90% 30% at 50% 92%, rgba(0, 0, 0, 0.10), transparent 70%)",
  `linear-gradient(180deg, #F6F6F4 0%, ${STUDIO_STAGE} 62%, #E2E2DE 100%)`,
].join(", ");

/** A word fading up from blurred to sharp with a small rise (the skill's text rule). */
const rise = (frame: number, at: number, size: number): React.CSSProperties => {
  const t = easeOut((frame - at) / 12);
  return {
    display: "inline-block",
    opacity: t,
    transform: `translateY(${(1 - t) * size * 0.2}px)`,
    filter: t < 1 ? `blur(${(1 - t) * size * 0.07}px)` : undefined,
  };
};

function Words({
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
  return (
    <>
      {splitWords(text, emphasis).map((w, i) => (
        <span
          key={i}
          style={{
            ...rise(frame, delay + i * 2, size),
            marginRight: size * 0.24,
            color: w.special ? STUDIO_BLUE : STUDIO_INK,
          }}
        >
          {w.w}
        </span>
      ))}
    </>
  );
}

/** A soft contact shadow under a floating card. */
const cardShadow = (unit: number) =>
  `0 ${unit * 4}px ${unit * 8}px -${unit * 3}px rgba(20, 22, 26, 0.35), 0 ${unit * 0.6}px ${unit * 1.4}px rgba(20, 22, 26, 0.08)`;

/** 1 · App screen: the app's own screen graphic, on the studio stage. */
function Screen({
  g,
  theme,
  frame,
  length,
}: {
  g: PlacedGraphic;
  theme: MotionTheme;
  frame: number;
  length: number;
}) {
  return (
    // One slow camera move over the whole shot (never reverses).
    <AbsoluteFill style={{ transform: `scale(${1 + 0.03 * easeInOut(frame / length)})` }}>
      <ScreenGraphic
        g={g}
        theme={{ ...theme, accent: STUDIO_BLUE }}
        background={STAGE_BG}
        ink={STUDIO_INK}
        lively
      />
    </AbsoluteFill>
  );
}

/** 2 · Key line: a white card tilting up out of depth over the footage. */
function FloatCard({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const t = easeOut(frame / 14);
  const out = easeIn((frame - (length - 8)) / 8);
  const size = unit * (portrait ? 6 : 5);
  // Tilts up out of depth and lands flat.
  const tilt = 28 * (1 - t);
  return (
    <AbsoluteFill style={{ perspective: unit * 120 }}>
      <AbsoluteFill
        style={{
          background: "linear-gradient(to top, rgba(20, 22, 26, 0.35) 0%, transparent 45%)",
          opacity: t * (1 - out),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: portrait ? "12%" : "9%",
          width: "max-content",
          maxWidth: "86%",
          translate: "-50% 0",
          background: "#FFFFFF",
          borderRadius: unit * 2.2,
          padding: `${size * 0.55}px ${size * 0.8}px`,
          boxShadow: cardShadow(unit),
          fontFamily: GROTESK,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.15,
          letterSpacing: "-0.03em",
          textAlign: "center",
          transformOrigin: "50% 100%",
          transform: `translateY(${(1 - t) * unit * 10 + out * unit * 6}px) rotateX(${tilt + out * 20}deg)`,
          opacity: clamp01(t * 2) * (1 - out),
        }}
      >
        <Words text={g.text} emphasis={g.emphasis} frame={frame} size={size} delay={8} />
      </div>
    </AbsoluteFill>
  );
}

/** 3 · Chapter: a blue disc squashes, then stretches into a rounded card with the title. */
function Morph({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait, width } = useUnit();
  const index = g.chapter ? String(g.chapter.index).padStart(2, "0") : "";
  const disc = unit * (portrait ? 20 : 16);
  const appear = easeOut(frame / 8);
  // Anticipation: an ~8% squash one pose before it grows (frames 8-12).
  const squash = frame >= 8 && frame < 12 ? 0.92 : 1;
  const grow = easeInOut((frame - 12) / 14);
  const cardW = Math.min(width * (portrait ? 0.84 : 0.62), disc * 5);
  const w = disc + (cardW - disc) * grow;
  const h = disc + (disc * 0.9 - disc) * grow;
  const radius = disc / 2 + (unit * 3 - disc / 2) * grow;
  const titleSize = unit * (portrait ? 6.2 : 5.2);
  return (
    <AbsoluteFill
      style={{ background: STAGE_BG, opacity: Math.min(appear, exitOpacity(frame, length, 8)) }}
    >
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${1 + 0.03 * easeInOut(frame / length)})`,
        }}
      >
        <div
          style={{
            width: w,
            height: h,
            borderRadius: radius,
            background: STUDIO_BLUE,
            boxShadow: cardShadow(unit),
            transform: `scale(${squash * (0.85 + 0.15 * appear)}, ${(2 - squash) * (0.85 + 0.15 * appear)})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: unit * 3 * grow,
            padding: `0 ${unit * 4 * grow}px`,
            overflow: "hidden",
            color: "#FFFFFF",
            fontFamily: GROTESK,
            fontWeight: 700,
          }}
        >
          <span
            style={{
              fontSize: unit * (portrait ? 7 : 5.6),
              letterSpacing: "-0.02em",
              flex: "none",
            }}
          >
            {index}
          </span>
          <span
            style={{
              fontSize: titleSize,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              // Opens up with the card, so the number slides smoothly aside (no jump).
              maxWidth: clamp01((grow - 0.3) / 0.7) * cardW,
              textOverflow: "ellipsis",
              opacity: easeOut((frame - 22) / 10),
              transform: `translateY(${(1 - easeOut((frame - 22) / 10)) * titleSize * 0.3}px)`,
              filter: frame < 32 ? `blur(${(1 - easeOut((frame - 22) / 10)) * 3}px)` : undefined,
            }}
          >
            {g.text}
          </span>
        </div>
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

/** 4 · Number: a white card turning in from the side in perspective, counting up. */
function StatCard({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const t = easeOut(frame / 14);
  const out = easeIn((frame - (length - 8)) / 8);
  // Turns in from 50° to 14° and keeps turning slowly the same way while it holds.
  const turn = 50 * (1 - t) + 14 - 6 * easeInOut(frame / length) - out * 30;
  return (
    <AbsoluteFill style={{ perspective: unit * 110 }}>
      <div
        style={{
          position: "absolute",
          right: portrait ? "7%" : "8%",
          top: portrait ? "18%" : "24%",
          background: "#FFFFFF",
          borderRadius: unit * 2.4,
          padding: `${unit * 3}px ${unit * 4}px`,
          boxShadow: cardShadow(unit),
          transformOrigin: "100% 50%",
          transform: `rotateY(${-turn}deg) translateX(${out * unit * 8}px)`,
          opacity: clamp01(t * 2) * (1 - out),
        }}
      >
        <div
          style={{
            fontFamily: GROTESK,
            fontWeight: 700,
            fontSize: unit * (portrait ? 13 : 10),
            lineHeight: 1,
            letterSpacing: "-0.04em",
            color: STUDIO_BLUE,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {shownNumber(n, easeOut((frame - 6) / 24))}
        </div>
        {g.text && (
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: unit * (portrait ? 3 : 2.4),
              color: SOFT,
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

/** 5 · List: feature cards arriving from the back of the stage into a tilted stack. */
function Stack({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const items = (g.items.length ? g.items : [g.text]).slice(0, 5);
  const starts = itemStarts(g, stepStarts(items.length, length));
  const reached = starts.reduce((r, s, i) => (frame >= s ? i : r), 0);
  const size = unit * (portrait ? 4.6 : 3.8);
  const gap = size * 2.6;
  return (
    <AbsoluteFill
      style={{
        background: STAGE_BG,
        opacity: Math.min(easeOut(frame / 8), exitOpacity(frame, length, 8)),
      }}
    >
      {g.text && items[0] !== g.text && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: portrait ? "12%" : "9%",
            textAlign: "center",
            fontFamily: GROTESK,
            fontWeight: 700,
            fontSize: size * 1.3,
            letterSpacing: "-0.03em",
            color: STUDIO_INK,
          }}
        >
          <Words text={g.text} emphasis={g.emphasis} frame={frame} size={size * 1.3} />
        </div>
      )}
      <AbsoluteFill
        style={{ perspective: unit * 140, alignItems: "center", justifyContent: "center" }}
      >
        <div
          style={{
            position: "relative",
            width: portrait ? "78%" : "52%",
            height: gap * items.length,
            transformStyle: "preserve-3d",
            // One continuous camera: the stack turns slowly the same way the whole time.
            transform: `rotateX(${16 - 4 * easeInOut(frame / length)}deg) rotateY(${-14 + 6 * easeInOut(frame / length)}deg)`,
            marginTop: portrait ? unit * 8 : unit * 5,
          }}
        >
          {items.map((item, i) => {
            const at = Math.max(4, starts[i] ?? 0);
            const t = easeOut((frame - at) / 14);
            if (frame < at) return null;
            const behind = reached - i; // 0 = the newest
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${(items.length - 1 - i) * 3}%`,
                  right: `${i * 3}%`,
                  top: i * gap,
                  background: "#FFFFFF",
                  borderRadius: unit * 1.8,
                  borderLeft:
                    behind === 0
                      ? `${unit * 0.8}px solid ${STUDIO_BLUE}`
                      : `${unit * 0.8}px solid transparent`,
                  padding: `${size * 0.6}px ${size * 0.8}px`,
                  boxShadow: cardShadow(unit),
                  fontFamily: GROTESK,
                  fontWeight: 600,
                  fontSize: size,
                  color: STUDIO_INK,
                  // From the back of the stage forward into place.
                  transform: `translateZ(${(1 - t) * -unit * 60}px) translateY(${(1 - t) * -unit * 6}px)`,
                  opacity: t * (behind > 0 ? 0.75 : 1),
                  filter: behind > 0 ? `blur(${Math.min(2, behind) * unit * 0.12}px)` : undefined,
                }}
              >
                {item}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function StudioScene({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  switch (g.type) {
    case "screen":
      return <Screen {...props} theme={theme} />;
    case "chapter":
      return <Morph {...props} />;
    case "counter":
      return <StatCard {...props} />;
    case "list":
      return <Stack {...props} />;
    default:
      return <FloatCard {...props} />;
  }
}
