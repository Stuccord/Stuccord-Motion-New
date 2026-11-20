// The Documentary look's drawn scenes: key lines, chapters and metaphors cut
// to a light grey stage with a soft vignette, where a simple near-black
// drawing draws itself while the camera travels along it, with one red
// accent (the flag, the goal, the key word). Metaphors draw their motif (a
// road to a flag, stairs, a mountain, a crossroads, a balance, a rising
// chart, a clock, a target); key lines draw a horizon with a small flag and
// chapters a road with a flag per chapter. Drawn in code: free, sharp at any
// size. No app imports: the worker bundles src/motion on its own.

import React from "react";
import { AbsoluteFill } from "remotion";
import { SANS } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import type { Motif } from "@/lib/motion-plan";
import { clamp01, easeInOut, easeOut, exitOpacity, splitWords, useStepFrame, useUnit } from "@/motion/kit";

export const DOCU_STAGE = "#E4E3DF";
export const DOCU_INK = "#1D1D1F";
export const DOCU_RED = "#D7262E";
const SOFT = "rgba(29, 29, 31, 0.55)";

/** The types the Documentary look draws as a scene. */
const DOCU_SCENE_TYPES = new Set<PlacedGraphic["type"]>(["keyline", "chapter", "metaphor"]);

/** True when this graphic is drawn as a stage scene (not one behind the speaker). */
export const isDocuScene = (g: PlacedGraphic) => DOCU_SCENE_TYPES.has(g.type) && !g.behind;

/** Where a drawing's camera starts and ends (in its 100 x 100 box). */
type Travel = { from: [number, number]; to: [number, number] };

/** A drawing: drawn from 0 (nothing) to 1 (all), with the frame for small motions. */
type Drawing = {
  draw: (p: number, frame: number, stroke: number) => React.ReactNode;
  travel: Travel;
};

/** A stroke that draws itself from start to end as `p` goes 0 to 1. */
function Stroke({
  d,
  p,
  width,
  colour = DOCU_INK,
  fill = "none",
}: {
  d: string;
  p: number;
  width: number;
  colour?: string;
  fill?: string;
}) {
  if (p <= 0) return null;
  return (
    <path
      d={d}
      pathLength={1}
      fill={fill}
      stroke={colour}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="1 1"
      strokeDashoffset={1 - clamp01(p)}
    />
  );
}

/** A part of the drawing that runs from `a` to `b` of the whole. */
const part = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

/** A small flag: the pole draws up, then the red cloth pops out and waves. */
function Flag({ x, y, size, p, frame, stroke }: { x: number; y: number; size: number; p: number; frame: number; stroke: number }) {
  if (p <= 0) return null;
  const pole = easeOut(part(p, 0, 0.5));
  const cloth = easeOut(part(p, 0.4, 1));
  const wave = Math.sin(frame / 7) * size * 0.06 * cloth;
  const top = y - size * pole;
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={top} stroke={DOCU_INK} strokeWidth={stroke * 0.5} strokeLinecap="round" />
      {cloth > 0 && (
        <path
          d={`M${x} ${top} Q ${x + size * 0.35 * cloth} ${top + size * 0.08 + wave}, ${x + size * 0.62 * cloth} ${top + size * 0.17} Q ${x + size * 0.35 * cloth} ${top + size * 0.26 - wave}, ${x} ${top + size * 0.34}Z`}
          fill={DOCU_RED}
        />
      )}
    </g>
  );
}

/** A road narrowing into the distance: segments drawn one after another, thinner as they go. */
function Road({ points, p, stroke, widest = 3.2 }: { points: [number, number][]; p: number; stroke: number; widest?: number }) {
  const n = points.length - 1;
  return (
    <g>
      {points.slice(0, -1).map((a, i) => {
        const b = points[i + 1];
        const mid: [number, number] = [(a[0] + b[0]) / 2 + (i % 2 ? 6 : -6), (a[1] + b[1]) / 2];
        const width = stroke * (widest - ((widest - 0.6) * i) / n);
        return (
          <Stroke
            key={i}
            d={`M${a[0]} ${a[1]} Q ${mid[0]} ${mid[1]} ${b[0]} ${b[1]}`}
            p={part(p, i / n, (i + 1) / n)}
            width={width}
          />
        );
      })}
    </g>
  );
}

const ROAD: [number, number][] = [
  [22, 100],
  [52, 80],
  [40, 62],
  [58, 48],
  [50, 38],
  [56, 30],
];

export const MOTIF_DRAWINGS: Record<Motif, Drawing> = {
  road: {
    travel: { from: [24, 92], to: [54, 34] },
    draw: (p, frame, s) => (
      <>
        <Stroke d="M0 30 L100 30" p={part(p, 0, 0.25)} width={s * 0.25} colour={SOFT} />
        <Road points={ROAD} p={part(p, 0.05, 0.8)} stroke={s} />
        <Flag x={56} y={30} size={14} p={part(p, 0.78, 1)} frame={frame} stroke={s} />
      </>
    ),
  },
  stairs: {
    travel: { from: [18, 86], to: [78, 22] },
    draw: (p, frame, s) => (
      <>
        <Stroke
          d="M8 90 L26 90 L26 76 L42 76 L42 62 L58 62 L58 48 L74 48 L74 34 L92 34"
          p={part(p, 0, 0.8)}
          width={s * 1.2}
        />
        <Stroke d="M8 90 L92 90 L92 34" p={part(p, 0.1, 0.6)} width={s * 0.3} colour={SOFT} />
        <Flag x={84} y={34} size={16} p={part(p, 0.78, 1)} frame={frame} stroke={s} />
      </>
    ),
  },
  mountain: {
    travel: { from: [22, 88], to: [58, 18] },
    draw: (p, frame, s) => (
      <>
        <Stroke d="M2 90 L34 46 L46 60 L60 22 L98 90" p={part(p, 0, 0.5)} width={s * 1.1} />
        <Stroke d="M52 34 L60 22 L68 34" p={part(p, 0.3, 0.5)} width={s * 0.6} />
        {/* The path up, dashed: from the foot to the peak. */}
        {part(p, 0.45, 0.85) > 0 && (
          <path
            d="M24 90 Q 38 80 44 72 T 52 54 T 60 24"
            fill="none"
            stroke={DOCU_INK}
            strokeWidth={s * 0.45}
            strokeLinecap="round"
            strokeDasharray="2 2.4"
            pathLength={100}
            style={{ clipPath: `inset(${(1 - part(p, 0.45, 0.85)) * 100}% 0 0 0)` }}
          />
        )}
        <Flag x={60} y={22} size={14} p={part(p, 0.82, 1)} frame={frame} stroke={s} />
      </>
    ),
  },
  crossroads: {
    travel: { from: [50, 92], to: [50, 40] },
    draw: (p, frame, s) => {
      const sign = easeOut(part(p, 0.6, 0.9));
      return (
        <>
          <Stroke d="M50 100 L50 58" p={part(p, 0, 0.35)} width={s * 3} />
          <Stroke d="M50 60 Q 46 44 18 32" p={part(p, 0.3, 0.65)} width={s * 2} />
          <Stroke d="M50 60 Q 54 44 82 32" p={part(p, 0.3, 0.65)} width={s * 2} />
          {sign > 0 && (
            <g opacity={sign}>
              <line x1={72} y1={84} x2={72} y2={58} stroke={DOCU_INK} strokeWidth={s * 0.5} />
              <path d={`M72 60 L${72 - 10 * sign} 60 L${72 - 14 * sign} 63 L${72 - 10 * sign} 66 L72 66Z`} fill={DOCU_INK} />
              <path d={`M72 68 L${72 + 10 * sign} 68 L${72 + 14 * sign} 71 L${72 + 10 * sign} 74 L72 74Z`} fill={DOCU_RED} />
            </g>
          )}
        </>
      );
    },
  },
  scale: {
    travel: { from: [50, 84], to: [50, 40] },
    draw: (p, frame, s) => {
      // The beam tips one way, then settles almost level.
      const t = part(p, 0.5, 1);
      const tilt = t > 0 ? 9 * Math.sin(t * Math.PI * 2.2) * (1 - t) + 2 * t : 0;
      const arm = 32;
      const r = (tilt * Math.PI) / 180;
      const lx = 50 - arm * Math.cos(r), ly = 36 - arm * Math.sin(r);
      const rx = 50 + arm * Math.cos(r), ry = 36 + arm * Math.sin(r);
      const pan = (x: number, y: number, colour: string, a: number) =>
        a > 0 && (
          <g opacity={a}>
            <line x1={x} y1={y} x2={x - 9} y2={y + 18} stroke={DOCU_INK} strokeWidth={s * 0.3} />
            <line x1={x} y1={y} x2={x + 9} y2={y + 18} stroke={DOCU_INK} strokeWidth={s * 0.3} />
            <path d={`M${x - 11} ${y + 18} Q ${x} ${y + 26} ${x + 11} ${y + 18}Z`} fill={DOCU_INK} />
            <circle cx={x} cy={y + 15} r={3.4} fill={colour} />
          </g>
        );
      return (
        <>
          <Stroke d="M36 88 L64 88" p={part(p, 0, 0.2)} width={s * 1.2} />
          <Stroke d="M50 88 L50 36" p={part(p, 0.1, 0.35)} width={s * 0.9} />
          <Stroke d={`M${lx} ${ly} L${rx} ${ry}`} p={part(p, 0.3, 0.5)} width={s * 0.9} />
          {pan(lx, ly, DOCU_INK, part(p, 0.45, 0.6))}
          {pan(rx, ry, DOCU_RED, part(p, 0.5, 0.65))}
          <circle cx={50} cy={36} r={2} fill={DOCU_INK} opacity={part(p, 0.3, 0.4)} />
        </>
      );
    },
  },
  chart: {
    travel: { from: [14, 84], to: [84, 20] },
    draw: (p, frame, s) => {
      const end = easeOut(part(p, 0.85, 1));
      return (
        <>
          <Stroke d="M10 12 L10 88 L94 88" p={part(p, 0, 0.3)} width={s * 0.5} />
          {[30, 50, 70].map((y, i) => (
            <Stroke key={y} d={`M10 ${y} L94 ${y}`} p={part(p, 0.1 + i * 0.05, 0.4 + i * 0.05)} width={s * 0.15} colour={SOFT} />
          ))}
          <Stroke d="M12 80 L28 70 L40 74 L54 54 L66 58 L84 22" p={part(p, 0.3, 0.88)} width={s * 1.3} />
          {end > 0 && <circle cx={84} cy={22} r={3.6 * end} fill={DOCU_RED} />}
        </>
      );
    },
  },
  clock: {
    travel: { from: [50, 50], to: [50, 50] },
    draw: (p, frame, s) => {
      const hands = part(p, 0.55, 1);
      const minute = (-90 + 360 * 1.5 * easeInOut(hands)) * (Math.PI / 180);
      const hour = (-30 + 45 * easeInOut(hands)) * (Math.PI / 180);
      const second = (frame * 6 * (Math.PI / 180)) / 2;
      return (
        <>
          <Stroke d="M50 14 A36 36 0 1 1 49.99 14" p={part(p, 0, 0.45)} width={s * 1.3} />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30 * Math.PI) / 180;
            const r1 = i % 3 === 0 ? 28 : 31;
            return (
              <line
                key={i}
                x1={50 + Math.sin(a) * r1}
                y1={50 - Math.cos(a) * r1}
                x2={50 + Math.sin(a) * 33}
                y2={50 - Math.cos(a) * 33}
                stroke={DOCU_INK}
                strokeWidth={s * (i % 3 === 0 ? 0.6 : 0.3)}
                opacity={part(p, 0.35 + i * 0.015, 0.45 + i * 0.015)}
              />
            );
          })}
          {hands > 0 && (
            <g>
              <line x1={50} y1={50} x2={50 + Math.cos(hour) * 17} y2={50 + Math.sin(hour) * 17} stroke={DOCU_INK} strokeWidth={s * 1.1} strokeLinecap="round" />
              <line x1={50} y1={50} x2={50 + Math.cos(minute) * 26} y2={50 + Math.sin(minute) * 26} stroke={DOCU_INK} strokeWidth={s * 0.7} strokeLinecap="round" />
              <line x1={50} y1={50} x2={50 + Math.sin(second) * 29} y2={50 - Math.cos(second) * 29} stroke={DOCU_RED} strokeWidth={s * 0.3} strokeLinecap="round" />
              <circle cx={50} cy={50} r={1.8} fill={DOCU_RED} />
            </g>
          )}
        </>
      );
    },
  },
  target: {
    travel: { from: [50, 50], to: [50, 50] },
    draw: (p, frame, s) => {
      const fly = easeOut(part(p, 0.65, 0.85));
      const hit = part(p, 0.85, 1);
      const ax = 96 - 46 * fly;
      const ay = 12 + 38 * fly;
      return (
        <>
          {[36, 26, 16].map((r, i) => (
            <Stroke
              key={r}
              d={`M50 ${50 - r} A${r} ${r} 0 1 1 49.99 ${50 - r}`}
              p={part(p, i * 0.15, 0.3 + i * 0.15)}
              width={s * (i === 0 ? 1.2 : 0.8)}
            />
          ))}
          <circle cx={50} cy={50} r={6 * easeOut(part(p, 0.5, 0.65))} fill={DOCU_RED} />
          {fly > 0 && (
            <g transform={`translate(${ax} ${ay}) rotate(${-38 + Math.sin(hit * Math.PI * 4) * 4 * (1 - hit)})`}>
              <line x1={0} y1={0} x2={26} y2={0} stroke={DOCU_INK} strokeWidth={s * 0.6} strokeLinecap="round" />
              <path d="M26 0 L33 -4 L31 0 L33 4Z" fill={DOCU_INK} />
            </g>
          )}
        </>
      );
    },
  },
};

/** A key line's drawing: a horizon drawn across, a small flag at its end. */
const HORIZON: Drawing = {
  travel: { from: [10, 70], to: [74, 62] },
  draw: (p, frame, s) => (
    <>
      <Stroke d="M4 72 Q 30 66 50 70 T 96 66" p={part(p, 0, 0.7)} width={s * 0.8} />
      <Stroke d="M18 82 Q 40 78 60 80" p={part(p, 0.2, 0.75)} width={s * 0.3} colour={SOFT} />
      <Flag x={74} y={68.6} size={16} p={part(p, 0.65, 1)} frame={frame} stroke={s} />
    </>
  ),
};

/** A chapter's drawing: a road along the bottom with a flag per chapter, this one red. */
function chapterDrawing(index: number, count: number): Drawing {
  const n = Math.max(1, Math.min(6, count));
  const at = Math.min(n, Math.max(1, index));
  const xs = Array.from({ length: n }, (_, i) => 12 + (76 * (i + (n === 1 ? 0.5 : 0))) / Math.max(1, n === 1 ? 1 : n - 1));
  const here = xs[at - 1];
  return {
    travel: { from: [xs[0], 70], to: [here, 66] },
    draw: (p, frame, s) => (
      <>
        <Stroke d="M2 74 L98 74" p={part(p, 0, 0.5)} width={s * 1.6} />
        {xs.map((x, i) =>
          i + 1 === at ? (
            <Flag key={i} x={x} y={74} size={18} p={part(p, 0.55, 1)} frame={frame} stroke={s} />
          ) : (
            <g key={i} opacity={part(p, 0.3 + i * 0.05, 0.4 + i * 0.05)}>
              <line x1={x} y1={74} x2={x} y2={64} stroke={DOCU_INK} strokeWidth={s * 0.4} />
              <path d={`M${x} 64 L${x + 6} 66 L${x} 68Z`} fill={i + 1 < at ? DOCU_INK : "none"} stroke={DOCU_INK} strokeWidth={s * 0.25} />
            </g>
          ),
        )}
      </>
    ),
  };
}

/** The words: the line small, the key word big and red underneath (as in "time is / money"). */
function Words({ text, emphasis, frame, delay, size }: { text: string; emphasis: string | null; frame: number; delay: number; size: number }) {
  const words = splitWords(text, emphasis);
  const hasKey = words.some((w) => w.special);
  // The key word goes big on its own line when it ends the line ("time is /
  // money"); in the middle of a line it stays in place, big and red.
  const keyLast = hasKey && words[words.length - 1].special;
  const plain = words.filter((w) => !w.special).map((w) => w.w);
  const key = words.filter((w) => w.special).map((w) => w.w).join(" ");
  const arrive = (d: number): React.CSSProperties => {
    const p = easeOut((frame - d) / 14);
    return { opacity: p, transform: `translateY(${(1 - p) * size * 0.25}px)`, display: "inline-block" };
  };
  if (!keyLast) {
    return (
      <div style={{ fontSize: size, fontWeight: 700, lineHeight: 1.2, color: DOCU_INK, letterSpacing: "-0.01em" }}>
        {words.map((w, i) => (
          <span
            key={i}
            style={{
              ...arrive(delay + i * 3),
              marginRight: size * 0.24,
              ...(w.special ? { color: DOCU_RED, fontWeight: 800, fontSize: "1.25em" } : {}),
            }}
          >
            {w.w}
          </span>
        ))}
      </div>
    );
  }
  // The key word is shown last, big, whatever its place in the line.
  return (
    <div style={{ lineHeight: 1.05 }}>
      {plain.length > 0 && (
        <div style={{ fontSize: size * 0.72, fontWeight: 600, color: DOCU_INK, marginBottom: size * 0.15 }}>
          {plain.map((w, i) => (
            <span key={i} style={{ ...arrive(delay + i * 3), marginRight: size * 0.18 }}>
              {w}
            </span>
          ))}
        </div>
      )}
      <div style={{ ...arrive(delay + plain.length * 3 + 6), fontSize: size * 1.7, fontWeight: 800, color: DOCU_RED, letterSpacing: "-0.02em" }}>
        {key}
      </div>
    </div>
  );
}

export function DocuScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const length = Math.max(1, g.to - g.from);
  const opacity = clamp01(frame / 4) * exitOpacity(frame, length, 6);

  const drawing =
    g.type === "chapter"
      ? chapterDrawing(g.chapter?.index ?? 1, g.chapter?.count ?? 1)
      : g.type === "metaphor" && g.motif
        ? MOTIF_DRAWINGS[g.motif]
        : HORIZON;

  // The drawing draws itself over most of the graphic (at least a second
  // and a half, at most three), then holds.
  const drawFrames = Math.min(90, Math.max(45, length * 0.7));
  const p = easeInOut((frame - 4) / drawFrames);

  // The camera: close in on where the drawing starts, then travels along it
  // and pulls back to show the whole; it never quite stops (a slow push).
  const travel = easeInOut((frame - 2) / (drawFrames * 1.05));
  const ox = drawing.travel.from[0] + (drawing.travel.to[0] - drawing.travel.from[0]) * travel;
  const oy = drawing.travel.from[1] + (drawing.travel.to[1] - drawing.travel.from[1]) * travel;
  const zoom = 1.45 - 0.45 * travel + 0.04 * clamp01((frame - drawFrames) / Math.max(1, length - drawFrames));

  // The drawing's square box: the upper part of the frame, the words below.
  const box = portrait ? Math.min(width * 0.86, height * 0.42) : Math.min(width * 0.5, height * 0.56);
  const boxTop = portrait ? height * 0.2 : height * 0.08;
  const stroke = 1.6;
  const size = unit * (portrait ? 6.4 : 4.8);

  return (
    <AbsoluteFill style={{ background: DOCU_STAGE, opacity, overflow: "hidden", fontFamily: SANS, fontSynthesis: "none" }}>
      {/* The camera's window: the drawing never runs into the words below. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: boxTop + box + unit * 1.5,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: (width - box) / 2,
            top: boxTop,
            width: box,
            height: box,
            transform: `scale(${zoom})`,
            transformOrigin: `${ox}% ${oy}%`,
          }}
        >
          <svg viewBox="0 0 100 100" width={box} height={box} style={{ overflow: "visible" }}>
            {drawing.draw(p, frame, stroke)}
          </svg>
        </div>
      </div>
      {/* The stage's soft vignette, over the drawing. */}
      <AbsoluteFill style={{ boxShadow: `inset 0 0 ${unit * 22}px rgba(0, 0, 0, 0.28)`, pointerEvents: "none" }} />
      {g.type === "chapter" && g.chapter && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: boxTop + box + unit * (portrait ? 4 : 2),
            textAlign: "center",
            fontSize: unit * 2.4,
            fontWeight: 600,
            letterSpacing: "0.3em",
            color: SOFT,
            opacity: easeOut((frame - 6) / 12),
          }}
        >
          {`CHAPTER ${g.chapter.index}`}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          top: boxTop + box + unit * (g.type === "chapter" ? (portrait ? 9 : 6) : portrait ? 6 : 3),
          textAlign: "center",
        }}
      >
        <Words text={g.text} emphasis={g.emphasis} frame={frame} delay={g.type === "chapter" ? 14 : 18} size={size} />
      </div>
    </AbsoluteFill>
  );
}
