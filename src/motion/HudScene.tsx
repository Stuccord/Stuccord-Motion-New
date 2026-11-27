// The Spec HUD look (Unboxing): a product teardown readout. Black, white
// monospace (JetBrains Mono), one lime, thin lines. A label is a callout - a
// target ring draws on at the middle of the frame (the app can't see where
// the product is), a thin line runs out and the name types into a tag; a
// key line is framed by corner brackets while a lime scan line sweeps down
// and leaves the verdict behind in bracketed capitals; a number is a spec
// readout whose digits scramble and lock in; a list is an "in the box"
// inventory, each item typing in with a lime OK; a chapter is a black system
// card with a faint grid that boots up behind a scan line. Everything else
// uses the HUD skin (MinimalGraphics HUD_SKIN). No app imports: the worker
// bundles src/motion on its own.

import React from "react";
import { AbsoluteFill } from "remotion";
import { MONO } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import { itemStarts, stepStarts } from "@/motion/beats";
import {
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

export const HUD_BLACK = "#050505";
export const HUD_LIME = "#B6FF3B";
const WHITE = "#F4F4F4";
const DIM = "#8A8A8A";
const PANEL = "rgba(5, 5, 5, 0.82)";

/** The types the Spec HUD look draws itself. */
const HUD_TYPES = new Set<PlacedGraphic["type"]>([
  "label",
  "keyline",
  "counter",
  "list",
  "chapter",
]);

export const isHudScene = (g: PlacedGraphic) => HUD_TYPES.has(g.type) && !g.behind;

/** Text typed in, a character per frame from `at` (the last one lime, like a cursor). */
function typedText(text: string, frame: number, at: number, perChar = 1): string {
  return text.slice(0, Math.max(0, Math.floor((frame - at) / perChar)));
}

/** A thin line drawing on (pathLength 1). */
function Line({
  d,
  t,
  viewBox,
  style,
  width = 1.6,
}: {
  d: string;
  t: number;
  viewBox: string;
  style?: React.CSSProperties;
  width?: number;
}) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio="none" style={{ overflow: "visible", ...style }}>
      <path
        d={d}
        fill="none"
        stroke={HUD_LIME}
        strokeWidth={width}
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - clamp01(t)}
      />
    </svg>
  );
}

/** 1 · Label: a callout from a target ring at the middle of the frame. */
function Callout({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait, width, height } = useUnit();
  const out = easeIn((frame - (length - 6)) / 6);
  const r = unit * (portrait ? 9 : 8);
  const cx = width * (portrait ? 0.42 : 0.4);
  const cy = height * (portrait ? 0.58 : 0.55);
  const ring = easeOut(frame / 10);
  const spin = frame * 0.8;
  const lineLen = unit * (portrait ? 10 : 12);
  const size = unit * (portrait ? 4.6 : 3.8);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, fontFamily: MONO }}>
      <div
        style={{
          position: "absolute",
          left: cx - r,
          top: cy - r,
          width: r * 2,
          height: r * 2,
          borderRadius: "50%",
          border: `${Math.max(3, unit * 0.5)}px dashed ${HUD_LIME}`,
          transform: `scale(${1.6 - 0.6 * ring}) rotate(${spin}deg)`,
          opacity: ring,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: cx - unit * 0.6,
          top: cy - unit * 0.6,
          width: unit * 1.2,
          height: unit * 1.2,
          borderRadius: "50%",
          background: HUD_LIME,
          opacity: ring,
        }}
      />
      <Line
        d="M 0 0 L 1 0"
        viewBox="0 0 1 1"
        t={(frame - 8) / 6}
        width={3}
        style={{ position: "absolute", left: cx + r, top: cy, width: lineLen, height: 1 }}
      />
      <div
        style={{
          position: "absolute",
          left: cx + r + lineLen,
          top: cy - size * 1.05,
          maxWidth: width - (cx + r + lineLen) - unit * 3,
          background: PANEL,
          border: `${Math.max(1, unit * 0.2)}px solid ${HUD_LIME}`,
          color: HUD_LIME,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.2,
          padding: `${size * 0.45}px ${size * 0.6}px`,
          textTransform: "uppercase",
          opacity: frame >= 13 ? 1 : 0,
        }}
      >
        {typedText(g.text.toUpperCase(), frame, 14)}
        <span style={{ opacity: Math.floor(frame / 6) % 2 ? 1 : 0.2 }}>_</span>
      </div>
    </AbsoluteFill>
  );
}

/** Corner brackets framing the shot, drawing in from the corners. */
function Brackets({ t, unit }: { t: number; unit: number }) {
  const arm = unit * 7 * clamp01(t);
  const w = Math.max(2, unit * 0.35);
  const inset = unit * 4;
  const corner = (pos: React.CSSProperties, h: "left" | "right", v: "top" | "bottom") => (
    <div style={{ position: "absolute", ...pos }}>
      <div
        style={{
          position: "absolute",
          [h]: 0,
          [v]: 0,
          width: arm,
          height: w,
          background: HUD_LIME,
        }}
      />
      <div
        style={{
          position: "absolute",
          [h]: 0,
          [v]: 0,
          width: w,
          height: arm,
          background: HUD_LIME,
        }}
      />
    </div>
  );
  return (
    <>
      {corner({ left: inset, top: inset }, "left", "top")}
      {corner({ right: inset, top: inset }, "right", "top")}
      {corner({ left: inset, bottom: inset }, "left", "bottom")}
      {corner({ right: inset, bottom: inset }, "right", "bottom")}
    </>
  );
}

/** 2 · Key line: brackets frame the shot, a scan line sweeps down and leaves the verdict. */
function Verdict({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const out = exitOpacity(frame, length, 6);
  const scan = easeInOut(frame / 18);
  const textTop = portrait ? 68 : 66;
  const size = unit * (portrait ? 5.6 : 5);
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: MONO }}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(5, 5, 5, 0.65) 0%, rgba(5, 5, 5, 0.2) 35%, transparent 55%)",
          opacity: easeOut(frame / 8),
        }}
      />
      <Brackets t={easeOut(frame / 10)} unit={unit} />
      {/* The scan line, top to bottom once, a soft glow trailing above it. */}
      {scan < 1 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: `${scan * 100}%` }}>
          <div
            style={{
              height: unit * 6,
              marginTop: -unit * 6,
              background: `linear-gradient(to bottom, transparent, rgba(182, 255, 59, 0.18))`,
            }}
          />
          <div style={{ height: Math.max(2, unit * 0.3), background: HUD_LIME }} />
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: "50%",
          maxWidth: "88%",
          width: "max-content",
          translate: "-50% 0",
          top: `${textTop}%`,
          textAlign: "center",
          background: PANEL,
          padding: `${size * 0.35}px ${size * 0.6}px`,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.3,
          letterSpacing: "0.02em",
          color: WHITE,
          textTransform: "uppercase",
          // Revealed where the scan line has passed.
          clipPath: `inset(0 0 ${scan * 100 >= textTop ? 0 : 100}% 0)`,
        }}
      >
        <span style={{ color: HUD_LIME }}>[ </span>
        {splitWords(g.text, g.emphasis).map((w, i) => (
          <span key={i} style={{ color: w.special ? HUD_LIME : WHITE }}>
            {i > 0 ? " " : ""}
            {w.w}
          </span>
        ))}
        <span style={{ color: HUD_LIME }}> ]</span>
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

/** Digits scrambling, then locking in left to right. */
function scrambled(text: string, frame: number, at: number): string {
  return text
    .split("")
    .map((ch, i) => {
      if (!/[0-9]/.test(ch)) return ch;
      const lock = at + 6 + i * 2;
      return frame >= lock ? ch : String(Math.floor(rand(i, Math.floor(frame / 2)) * 10));
    })
    .join("");
}

/** 3 · Number: a spec readout panel at the side. */
function Readout({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const t = easeOut(frame / 8);
  const out = easeIn((frame - (length - 6)) / 6);
  const shown = numberText(g.number ?? { value: 0, prefix: "", suffix: "" });
  return (
    <AbsoluteFill style={{ fontFamily: MONO }}>
      <div
        style={{
          position: "absolute",
          right: "5%",
          top: portrait ? "14%" : "12%",
          background: PANEL,
          borderLeft: `${Math.max(2, unit * 0.5)}px solid ${HUD_LIME}`,
          padding: `${unit * 2}px ${unit * 3}px`,
          clipPath: `inset(0 ${(1 - t) * 100}% 0 0)`,
          opacity: 1 - out,
        }}
      >
        <div
          style={{
            fontSize: unit * (portrait ? 2.4 : 1.9),
            color: DIM,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {`// SPEC${g.text ? ` · ${g.text}` : ""}`}
        </div>
        <div
          style={{
            fontSize: unit * (portrait ? 11 : 8.5),
            fontWeight: 700,
            lineHeight: 1.05,
            color: HUD_LIME,
            letterSpacing: "-0.02em",
            marginTop: unit * 0.8,
          }}
        >
          {frame >= 4 ? scrambled(shown, frame, 4) : ""}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** 4 · List: an "in the box" inventory panel, each item typing in with OK. */
function Inventory({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const items = g.items.length ? g.items : [g.text];
  const starts = itemStarts(g, stepStarts(items.length, length));
  const t = easeOut(frame / 8);
  const out = easeIn((frame - (length - 6)) / 6);
  const size = unit * (portrait ? 3.8 : 3.4);
  return (
    <AbsoluteFill style={{ fontFamily: MONO }}>
      <div
        style={{
          position: "absolute",
          left: "5%",
          top: portrait ? "14%" : "12%",
          maxWidth: portrait ? "80%" : "50%",
          background: PANEL,
          borderTop: `${Math.max(2, unit * 0.4)}px solid ${HUD_LIME}`,
          padding: `${size * 0.8}px ${size}px`,
          fontSize: size,
          lineHeight: 1.7,
          color: WHITE,
          clipPath: `inset(0 0 ${(1 - t) * 100}% 0)`,
          opacity: 1 - out,
        }}
      >
        <div
          style={{
            color: DIM,
            fontSize: size * 0.75,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {g.text && items[0] !== g.text ? g.text : "In the box"}
        </div>
        {items.map((item, i) => {
          const at = Math.max(6, starts[i] ?? 0);
          if (frame < at) return null;
          const typed = typedText(item, frame, at);
          const done = typed.length >= item.length;
          return (
            <div key={i} style={{ display: "flex", gap: size * 0.6, alignItems: "baseline" }}>
              <span style={{ color: HUD_LIME }}>&gt;</span>
              <span style={{ flex: 1 }}>{typed}</span>
              {done && <span style={{ color: HUD_LIME, fontWeight: 700 }}>OK</span>}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** 5 · Chapter: a black system card with a faint grid, booted up behind a scan line. */
function System({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const scan = easeInOut(frame / 12);
  const index = g.chapter ? String(g.chapter.index).padStart(2, "0") : null;
  return (
    <AbsoluteFill
      style={{ overflow: "hidden", opacity: exitOpacity(frame, length, 6), fontFamily: MONO }}
    >
      <AbsoluteFill
        style={{
          background: HUD_BLACK,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "6vmin 6vmin",
          clipPath: `inset(0 ${(1 - scan) * 100}% 0 0)`,
        }}
      >
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            transform: `scale(${1 + 0.03 * easeInOut(frame / length)})`,
          }}
        >
          {index && (
            <div
              style={{
                fontSize: unit * (portrait ? 22 : 17),
                fontWeight: 700,
                lineHeight: 1,
                color: HUD_LIME,
              }}
            >
              {frame >= 10 ? index : ""}
            </div>
          )}
          <div
            style={{
              fontSize: unit * (portrait ? 5.2 : 4.2),
              fontWeight: 500,
              color: WHITE,
              marginTop: unit * 2,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {`/ ${typedText(g.text.toUpperCase(), frame, 14)}`}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      {scan < 1 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${scan * 100}%`,
            width: Math.max(2, unit * 0.35),
            background: HUD_LIME,
            boxShadow: `0 0 ${unit * 3}px ${HUD_LIME}`,
          }}
        />
      )}
    </AbsoluteFill>
  );
}

export function HudScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  switch (g.type) {
    case "label":
      return <Callout {...props} />;
    case "counter":
      return <Readout {...props} />;
    case "list":
      return <Inventory {...props} />;
    case "chapter":
      return <System {...props} />;
    default:
      return <Verdict {...props} />;
  }
}
