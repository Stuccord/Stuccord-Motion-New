// The Paper look (stage 10): every Motion Explainer graphic as paper on a
// dark desk, seen from above - a desk lamp in the corner and blind shadows
// across it, the words printed on a white sheet with the key word
// highlighted, a pen pointing at each line as it's read, photos as prints,
// section cards as a paper stack, labels as paper tags. From the studied
// "laziest business" video (docs/style-research/05). Same timings and
// sounds as the glass look; only the drawing changes.

import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { Bell, Link2, MessageCircle, ThumbsUp } from "lucide-react";
import { SANS, SERIF, type MotionTheme } from "@/motion/theme";
import {
  coinBeats,
  coinCount,
  loopBeats,
  profileBeats,
  stepStarts,
  streamBeats,
} from "@/motion/beats";
import type { PlacedGraphic } from "@/motion/timing";
import { NotesGraphic } from "@/motion/NotesGraphic";
import {
  ImagesContext,
  LogoContext,
  inkAccent,
  behindBand,
  clamp01,
  easeOut,
  exitOpacity,
  pop,
  rand,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

const DESK = "#16120E";
const PAPER = "#F4F0E6";
const INK = "#1D1B1A";
const INK_SOFT = "#6A645B";

type Draw = (p: { g: PlacedGraphic; theme: MotionTheme }) => React.ReactElement;

const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

// ---------- the desk, the sheet, the pen ----------

/** The desk from above: warm lamp light from a corner, blind shadows across. */
function Desk({ opacity, children }: { opacity: number; children: React.ReactNode }) {
  return (
    <AbsoluteFill style={{ opacity, background: DESK, overflow: "hidden", fontFamily: SANS }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 12% 8%, rgba(255,214,160,0.28) 0%, rgba(255,214,160,0.08) 35%, transparent 60%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(118deg, transparent 0px, transparent 70px, rgba(0,0,0,0.22) 70px, rgba(0,0,0,0.22) 110px)",
          opacity: 0.6,
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

/** Where the sheet lies: most of a tall frame, the middle of a wide one. */
function useSheet() {
  const { unit, portrait, width, height } = useUnit();
  const w = portrait ? width * 0.84 : width * 0.47;
  const h = portrait ? height * 0.6 : height * 0.84;
  return {
    unit,
    portrait,
    width,
    height,
    w,
    h,
    left: (width - w) / 2,
    top: (height - h) / 2,
    pad: unit * 6,
  };
}

/** A white sheet sliding onto the desk and settling; children placed inside it. */
function Sheet({
  frame,
  rot = -1.2,
  children,
  style,
}: {
  frame: number;
  rot?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { unit, w, h, left, top } = useSheet();
  const p = easeOut(frame / 10);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        height: h,
        background: `linear-gradient(172deg, #FBF8F1 0%, ${PAPER} 60%, #EAE4D6 100%)`,
        boxShadow: `0 ${unit * 2}px ${unit * 6}px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.05)`,
        transform: `translateY(${(1 - p) * unit * 40}px) rotate(${rot + (1 - p) * 4}deg)`,
        color: INK,
        fontFamily: SANS,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A highlighter stroke behind words, swiping across as `on` goes 0 to 1. */
function Marker({
  theme,
  on,
  children,
}: {
  theme: MotionTheme;
  on: number;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(transparent 50%, ${theme.glow} 50%, ${theme.glow} 92%, transparent 92%)`,
        backgroundSize: `${clamp01(on) * 100}% 100%`,
        backgroundRepeat: "no-repeat",
      }}
    >
      {children}
    </span>
  );
}

/** Printed words appearing one after another, the special word highlighted. */
function Printed({
  text,
  emphasis,
  frame,
  delay,
  theme,
  style,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  delay: number;
  theme: MotionTheme;
  style?: React.CSSProperties;
}) {
  const words = splitWords(text, emphasis);
  return (
    <div style={style}>
      {words.map(({ w, special }, i) => {
        const at = delay + i * 2;
        return (
          <span key={i} style={{ opacity: clamp01((frame - at) / 3) }}>
            {special ? (
              <Marker theme={theme} on={(frame - at - 2) / 6}>
                <b>{w}</b>
              </Marker>
            ) : (
              w
            )}{" "}
          </span>
        );
      })}
    </div>
  );
}

/** Where the pen points: gliding from target to target, arriving at each `at`. */
type PenTarget = { at: number; x: number; y: number };
function penAt(targets: PenTarget[], frame: number, unit: number) {
  if (!targets.length) return null;
  const first = targets[0];
  // It comes in from the lower right before the first target.
  let from = { x: first.x + unit * 30, y: first.y + unit * 40 };
  let to = first;
  let start = first.at - 10;
  for (let i = 0; i < targets.length; i++) {
    if (frame >= targets[i].at) {
      from = targets[i];
      to = targets[i + 1] ?? targets[i];
      start = targets[i + 1] ? targets[i + 1].at - 8 : targets[i].at;
    }
  }
  const t = easeInOut((frame - start) / (to === first && frame < first.at ? 10 : 8));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** A pen lying at an angle, its tip at (x, y) in the sheet. */
function Pen({
  at,
  unit,
  theme,
}: {
  at: { x: number; y: number } | null;
  unit: number;
  theme: MotionTheme;
}) {
  if (!at) return null;
  const s = unit * 0.26;
  const shape = (
    <>
      <polygon points="0,0 16,-4.5 16,4.5" fill="#C9C2B4" />
      <polygon points="0,0 5,-1.5 5,1.5" fill="#222" />
      <rect x="16" y="-6" width="28" height="12" rx="3" fill="#2A2A2E" />
      <rect x="44" y="-6.5" width="86" height="13" rx="5" fill={inkAccent(theme)} />
      <rect x="48" y="-4.5" width="76" height="2.5" rx="1" fill="rgba(255,255,255,0.35)" />
      <rect x="112" y="-8" width="5" height="16" rx="1.5" fill="#D9D3C4" />
    </>
  );
  return (
    <svg
      width={1}
      height={1}
      style={{ position: "absolute", left: at.x, top: at.y, overflow: "visible", zIndex: 5 }}
    >
      <g transform={`translate(${unit * 1.6} ${unit * 2.4}) scale(${s}) rotate(32)`} opacity={0.3}>
        <g style={{ filter: "blur(3px)" }} fill="#000">
          {shape}
        </g>
      </g>
      <g transform={`scale(${s}) rotate(32)`}>{shape}</g>
    </svg>
  );
}

/** A photo print: a white border, the picture, an optional handwritten caption. */
function Print({
  url,
  w,
  h,
  caption,
  unit,
  theme,
  style,
}: {
  url: string | undefined;
  w: number;
  h: number;
  caption?: string;
  unit: number;
  theme: MotionTheme;
  style?: React.CSSProperties;
}) {
  const border = Math.max(4, w * 0.04);
  return (
    <div
      style={{
        position: "absolute",
        width: w,
        padding: border,
        paddingBottom: caption ? border * 4.2 : border,
        background: "#FBF9F4",
        boxShadow: `0 ${unit * 1.6}px ${unit * 5}px rgba(0,0,0,0.5)`,
        boxSizing: "border-box",
        ...style,
      }}
    >
      <div style={{ width: "100%", height: h, overflow: "hidden", background: "#D8D2C4" }}>
        {url && <Img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      {caption && (
        <div
          style={{
            position: "absolute",
            left: border,
            right: border,
            bottom: border * 0.9,
            textAlign: "center",
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: Math.min(unit * 4.6, border * 2.6),
            color: inkAccent(theme),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}

/** Behind the speaker: the words on torn strips of paper at head height. */
function PaperStrips({
  lines,
  frame,
  length,
  theme,
  big,
}: {
  lines: { text: string; emphasis: string | null; size: number }[];
  frame: number;
  length: number;
  theme: MotionTheme;
  big?: boolean;
}) {
  const { unit, portrait } = useUnit();
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length), fontFamily: SANS }}>
      <div style={{ ...behindBand(portrait), gap: unit * 1.4 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ transform: `rotate(${i % 2 ? 1.6 : -1.8}deg)`, maxWidth: "90%" }}>
            <div
              style={{
                background: PAPER,
                color: INK,
                padding: `${unit * 0.6}px ${unit * 2.4}px`,
                fontWeight: 800,
                fontSize: l.size,
                lineHeight: 1.05,
                letterSpacing: big ? "-0.03em" : undefined,
                boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
                clipPath: "polygon(0 4%, 3% 0, 97% 3%, 100% 0, 99% 96%, 96% 100%, 2% 97%, 0 100%)",
                ...pop(frame, i * 5, unit),
              }}
            >
              <Printed
                text={l.text}
                emphasis={l.emphasis}
                frame={frame}
                delay={i * 5}
                theme={theme}
              />
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

// ---------- the graphics on paper ----------

const PaperKeyLine: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, w, h, pad } = useSheet();
  const length = g.to - g.from;
  if (g.behind) {
    return (
      <PaperStrips
        lines={[{ text: g.text, emphasis: g.emphasis, size: unit * 9 }]}
        frame={frame}
        length={length}
        theme={theme}
        big
      />
    );
  }
  const words = g.text.split(/\s+/).filter(Boolean).length;
  const size = unit * 6.6;
  // The pen runs along the last printed line (its length guessed from the
  // number of letters that fit on a line).
  const perLine = Math.max(8, (w - pad * 2) / (size * 0.55));
  const lineCount = Math.max(1, Math.ceil(g.text.length / perLine));
  const lastShare = Math.min(1, (g.text.length - (lineCount - 1) * perLine) / perLine);
  const y = h * 0.34 + lineCount * size * 1.18;
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      <Sheet frame={frame}>
        <div
          style={{
            position: "absolute",
            left: pad,
            top: pad,
            width: unit * 10,
            height: 3,
            background: inkAccent(theme),
          }}
        />
        <Printed
          text={g.text}
          emphasis={g.emphasis}
          frame={frame}
          delay={6}
          theme={theme}
          style={{
            position: "absolute",
            left: pad,
            right: pad,
            top: h * 0.34,
            fontSize: size,
            fontWeight: 800,
            lineHeight: 1.18,
            letterSpacing: "-0.01em",
          }}
        />
        <Pen
          at={penAt(
            [
              { at: 6, x: pad, y },
              { at: 6 + words * 2 + 4, x: pad + (w - pad * 2) * Math.max(0.3, lastShare), y },
            ],
            frame,
            unit,
          )}
          unit={unit}
          theme={theme}
        />
      </Sheet>
    </Desk>
  );
};

const PaperCounter: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, w, h, pad } = useSheet();
  const length = g.to - g.from;
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const decimals = Number.isInteger(n.value)
    ? 0
    : Math.min(2, String(n.value).split(".")[1]?.length ?? 0);
  const value = `${n.prefix}${(n.value * easeOut((frame - 4) / 26)).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${n.suffix}`;
  if (g.behind) {
    return (
      <PaperStrips
        lines={[
          ...(g.text ? [{ text: g.text, emphasis: null, size: unit * 4.4 }] : []),
          { text: value, emphasis: null, size: unit * 22 },
        ]}
        frame={frame}
        length={length}
        theme={theme}
        big
      />
    );
  }
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      <Sheet frame={frame}>
        {g.text && (
          <div
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              top: h * 0.2,
              fontSize: unit * 4.4,
              color: INK_SOFT,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              ...pop(frame, 8, unit),
            }}
          >
            {g.text}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            left: pad,
            right: pad,
            top: h * 0.34,
            fontSize: unit * 20,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            fontVariantNumeric: "tabular-nums",
            color: inkAccent(theme),
          }}
        >
          <Marker theme={theme} on={(frame - 26) / 8}>
            {value}
          </Marker>
        </div>
        <Pen
          at={penAt([{ at: 30, x: w * 0.72, y: h * 0.6 }], frame, unit)}
          unit={unit}
          theme={theme}
        />
      </Sheet>
    </Desk>
  );
};

/** A list or card: lines on the sheet with ticks or dashes, the pen at each. */
function PaperLines({
  g,
  theme,
  ticks,
  starts,
}: {
  g: PlacedGraphic;
  theme: MotionTheme;
  ticks: boolean;
  starts: number[];
}) {
  const frame = useStepFrame();
  const { unit, portrait, h, pad } = useSheet();
  const length = g.to - g.from;
  const size = unit * 6;
  const row = size * 2.1;
  const top = g.text ? h * 0.24 : h * 0.14;
  const accent = inkAccent(theme);
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      <Sheet frame={frame}>
        {g.text && (
          <div style={{ position: "absolute", left: pad, right: pad, top: h * 0.08 }}>
            <Printed
              text={g.text}
              emphasis={g.emphasis}
              frame={frame}
              delay={4}
              theme={theme}
              style={{ fontSize: size * 1.25, fontWeight: 800 }}
            />
            <svg width="60%" height={unit * 2} style={{ display: "block", overflow: "visible" }}>
              <path
                d={`M0 ${unit} Q ${unit * 20} ${unit * 1.8} ${unit * 60} ${unit * 0.6}`}
                stroke={accent}
                strokeWidth={unit * 0.45}
                fill="none"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - easeOut((frame - 8) / 10)}
              />
            </svg>
          </div>
        )}
        {g.items.map((item, i) => {
          const at = starts[i] ?? 0;
          const y = top + i * row;
          const tick = easeOut((frame - at - 2) / 6);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: pad,
                right: pad,
                top: y,
                height: row,
                display: "flex",
                alignItems: "center",
                gap: unit * 2,
                fontSize: size,
                fontWeight: 600,
                opacity: clamp01((frame - at) / 4),
              }}
            >
              {ticks ? (
                <svg width={size} height={size} style={{ flexShrink: 0, overflow: "visible" }}>
                  <rect
                    x={1}
                    y={1}
                    width={size - 2}
                    height={size - 2}
                    rx={3}
                    fill="none"
                    stroke={INK}
                    strokeWidth={2}
                  />
                  <path
                    d={`M${size * 0.18} ${size * 0.55} L${size * 0.42} ${size * 0.8} L${size * 0.95} ${size * 0.05}`}
                    fill="none"
                    stroke={accent}
                    strokeWidth={size * 0.14}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - tick}
                  />
                </svg>
              ) : (
                <span style={{ color: accent, fontWeight: 800 }}>–</span>
              )}
              <span>{item}</span>
            </div>
          );
        })}
        <Pen
          at={penAt(
            g.items.map((_, i) => ({
              at: starts[i] ?? 0,
              x: pad + size * 0.5,
              y: top + i * row + row * 0.7,
            })),
            frame,
            unit,
          )}
          unit={unit}
          theme={theme}
        />
      </Sheet>
    </Desk>
  );
}

const PaperList: Draw = ({ g, theme }) => {
  const length = g.to - g.from;
  // The same rhythm as the glass list (and its click sounds).
  const step = g.items.length > 1 ? Math.max(6, (length * 0.66) / g.items.length) : 0;
  return (
    <PaperLines g={g} theme={theme} ticks starts={g.items.map((_, i) => Math.round(i * step))} />
  );
};

const PaperCard: Draw = ({ g, theme }) => (
  <PaperLines g={g} theme={theme} ticks={false} starts={g.items.map((_, i) => 10 + i * 5)} />
);

const PaperCompare: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, w, h, pad } = useSheet();
  const length = g.to - g.from;
  const second = Math.max(10, Math.round(length * 0.4));
  const [a, b] = [g.items[0] ?? "", g.items[1] ?? ""];
  const size = unit * 6.4;
  const accent = inkAccent(theme);
  const side = (text: string, at: number, x: number) => (
    <div
      style={{
        position: "absolute",
        left: x,
        width: w / 2 - pad * 1.9,
        top: h * 0.42,
        textAlign: "center",
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.15,
        ...pop(frame, at, unit),
      }}
    >
      {text}
    </div>
  );
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      <Sheet frame={frame}>
        {g.text && (
          <Printed
            text={g.text}
            emphasis={g.emphasis}
            frame={frame}
            delay={4}
            theme={theme}
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              top: h * 0.1,
              textAlign: "center",
              fontSize: size * 0.9,
              fontWeight: 700,
            }}
          />
        )}
        <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
          <line
            x1={w / 2}
            y1={h * 0.28}
            x2={w / 2}
            y2={h * 0.85}
            stroke={INK}
            strokeWidth={2}
            strokeDasharray={`${unit} ${unit}`}
            opacity={easeOut((frame - 6) / 8)}
          />
          <ellipse
            cx={w / 2}
            cy={h * 0.5}
            rx={unit * 7}
            ry={unit * 5}
            fill={PAPER}
            stroke={accent}
            strokeWidth={unit * 0.4}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - easeOut((frame - second + 4) / 8)}
          />
          <text
            x={w / 2}
            y={h * 0.5 + unit * 1.7}
            textAnchor="middle"
            fontFamily={SERIF}
            fontStyle="italic"
            fontSize={unit * 5}
            fill={accent}
          >
            vs
          </text>
        </svg>
        {side(a, 4, pad * 0.5)}
        {frame >= second && side(b, second, w / 2 + pad * 1.4)}
        <Pen
          at={penAt(
            [
              { at: 6, x: w * 0.25, y: h * 0.62 },
              { at: second + 2, x: w * 0.75, y: h * 0.62 },
            ],
            frame,
            unit,
          )}
          unit={unit}
          theme={theme}
        />
      </Sheet>
    </Desk>
  );
};

/** Prints laid on the desk one after another, each with its caption. */
function PrintsOnDesk({
  g,
  theme,
  starts,
}: {
  g: PlacedGraphic;
  theme: MotionTheme;
  starts: number[];
}) {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const images = React.useContext(ImagesContext);
  const length = g.to - g.from;
  const scenes = g.scenes ?? [];
  const pw = portrait ? width * 0.74 : height * 0.62;
  const ph = portrait ? pw * 1.05 : pw * 0.78;
  return (
    <Desk opacity={Math.min(easeOut(frame / 6), exitOpacity(frame, length))}>
      {scenes.map((sc, i) => {
        const at = starts[i] ?? 0;
        if (frame < at - 1) return null;
        const p = easeOut((frame - at) / 10);
        const rot = (rand(i, 3) - 0.5) * 10;
        return (
          <Print
            key={i}
            url={sc.image ? images[sc.image] : undefined}
            w={pw}
            h={ph}
            caption={sc.text}
            unit={unit}
            theme={theme}
            style={{
              left: (width - pw) / 2 + (rand(i, 1) - 0.5) * unit * 8,
              top: (height - ph * 1.18) / 2 + (rand(i, 2) - 0.5) * unit * 6,
              transform: `translateX(${(1 - p) * width * 0.7}px) rotate(${rot + (1 - p) * 14}deg)`,
            }}
          />
        );
      })}
      {g.text && g.type === "story" && (
        <div
          style={{
            position: "absolute",
            left: unit * 6,
            right: unit * 6,
            top: portrait ? "6%" : "4%",
            textAlign: "center",
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: unit * (portrait ? 6 : 4.6),
            color: PAPER,
            ...pop(frame, 2, unit),
          }}
        >
          {g.text}
        </div>
      )}
    </Desk>
  );
}

const PaperStory: Draw = ({ g, theme }) => (
  <PrintsOnDesk
    g={g}
    theme={theme}
    starts={(g.scenes ?? []).map((sc) => Math.max(0, sc.from - g.from))}
  />
);

const PaperCartoon: Draw = ({ g, theme }) => (
  <PrintsOnDesk g={{ ...g, scenes: (g.scenes ?? []).slice(0, 1) }} theme={theme} starts={[0]} />
);

const PaperSteps: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, w, h, pad } = useSheet();
  const length = g.to - g.from;
  const items = g.items.length ? g.items : [""];
  const n = items.length;
  const starts = stepStarts(n, length);
  const accent = inkAccent(theme);
  // A staircase drawn up the sheet, one tread per step as it's reached.
  const x0 = pad;
  const x1 = w - pad;
  const y0 = h - pad * 1.4;
  const y1 = h * (g.text ? 0.3 : 0.16);
  const sw = (x1 - x0) / n;
  const sh = (y0 - y1) / (n + 0.4);
  let d = `M${x0} ${y0}`;
  for (let i = 0; i < n; i++) {
    d += ` L${x0 + i * sw} ${y0 - (i + 1) * sh} L${x0 + (i + 1) * sw} ${y0 - (i + 1) * sh}`;
  }
  const drawn = starts.reduce((sum, s) => sum + easeOut((frame - s) / 8), 0) / n;
  const size = unit * 4;
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      <Sheet frame={frame}>
        {g.text && (
          <Printed
            text={g.text}
            emphasis={g.emphasis}
            frame={frame}
            delay={2}
            theme={theme}
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              top: h * 0.08,
              fontSize: size * 1.5,
              fontWeight: 800,
            }}
          />
        )}
        <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
          <path
            d={d}
            fill="none"
            stroke={INK}
            strokeWidth={unit * 0.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - drawn}
          />
        </svg>
        {items.map((label, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x0 + i * sw,
              width: sw,
              top: y0 - (i + 1) * sh - size * 3.4,
              textAlign: "center",
              ...pop(frame, starts[i] + 4, unit, 8),
            }}
          >
            <div style={{ fontSize: size * 1.7, fontWeight: 800, color: accent, lineHeight: 1 }}>
              <Marker theme={theme} on={(frame - starts[i] - 6) / 6}>
                {i + 1}
              </Marker>
            </div>
            <div
              style={{ fontSize: size, fontWeight: 700, lineHeight: 1.1, marginTop: unit * 0.6 }}
            >
              {label}
            </div>
          </div>
        ))}
        <Pen
          at={penAt(
            starts.map((s, i) => ({ at: s + 6, x: x0 + (i + 1) * sw, y: y0 - (i + 1) * sh })),
            frame,
            unit,
          )}
          unit={unit}
          theme={theme}
        />
      </Sheet>
    </Desk>
  );
};

const PaperLoop: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, w, h, pad } = useSheet();
  const length = g.to - g.from;
  const n = Math.max(1, g.items.length);
  const beats = loopBeats(n, length);
  const accent = inkAccent(theme);
  const cx = w / 2;
  const cy = h * 0.56;
  const r = Math.min(w, h) * (portrait ? 0.24 : 0.22);
  const drawn = easeOut((frame - beats.arcFrom) / beats.arcFrames);
  const swapT = g.swap ? clamp01((frame - beats.swapAt) / 8) : 0;
  const size = unit * 3.8;
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      <Sheet frame={frame}>
        {g.text && (
          <Printed
            text={g.text}
            emphasis={g.emphasis}
            frame={frame}
            delay={2}
            theme={theme}
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              top: h * 0.07,
              textAlign: "center",
              fontSize: size * 1.6,
              fontWeight: 800,
            }}
          />
        )}
        <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
          {/* A hand-drawn circle from the top, clockwise, with an arrow head. */}
          <path
            d={`M${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`}
            fill="none"
            stroke={INK}
            strokeWidth={unit * 0.45}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - drawn}
          />
          <path
            d={`M${cx - unit * 1.6} ${cy - r - unit * 1.4} L${cx} ${cy - r} L${cx - unit * 1.6} ${cy - r + unit * 1.4}`}
            fill="none"
            stroke={INK}
            strokeWidth={unit * 0.45}
            strokeLinecap="round"
            opacity={drawn >= 0.98 ? 1 : 0}
          />
          {g.items.map((_, i) => {
            const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
            return (
              <circle
                key={i}
                cx={cx + r * Math.cos(a)}
                cy={cy + r * Math.sin(a)}
                r={unit * 1.1 * (frame >= beats.dots[i] ? easeOut((frame - beats.dots[i]) / 4) : 0)}
                fill={accent}
              />
            );
          })}
        </svg>
        {g.items.map((label, i) => {
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const dx = Math.cos(a);
          const lx = cx + (r + unit * 3) * dx;
          const ly = cy + (r + unit * 3) * Math.sin(a);
          const align = Math.abs(dx) < 0.25 ? "center" : dx > 0 ? "left" : "right";
          const swapped = g.swap?.item === i;
          const room =
            align === "left" ? w - lx - unit * 2 : align === "right" ? lx - unit * 2 : w * 0.5;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: ly,
                left: align === "right" ? lx - room : align === "center" ? lx - room / 2 : lx,
                width: room,
                transform: "translateY(-50%)",
                textAlign: align,
                fontSize: size,
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              <div style={pop(frame, beats.dots[i], unit, 8)}>
                <span style={{ position: "relative" }}>
                  {label}
                  {swapped && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: "52%",
                        height: Math.max(2, unit * 0.4),
                        width: `${swapT * 100}%`,
                        background: accent,
                      }}
                    />
                  )}
                </span>
                {swapped && g.swap && (
                  <div
                    style={{
                      fontFamily: SERIF,
                      fontStyle: "italic",
                      fontWeight: 400,
                      color: accent,
                      fontSize: size * 1.2,
                      opacity: clamp01((frame - beats.swapAt - 6) / 5),
                    }}
                  >
                    {g.swap.text}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <Pen
          at={penAt(
            g.items.map((_, i) => {
              const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
              return { at: beats.dots[i], x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
            }),
            frame,
            unit,
          )}
          unit={unit}
          theme={theme}
        />
      </Sheet>
    </Desk>
  );
};

/** A drawn coin: two rings and a dollar sign. */
function DrawnCoin({ size, ink, on }: { size: number; ink: string; on: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="#F7EBC4"
        stroke={INK}
        strokeWidth="4"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - on}
      />
      <circle cx="50" cy="50" r="34" fill="none" stroke={ink} strokeWidth="3" opacity={on} />
      <text
        x="50"
        y="64"
        textAnchor="middle"
        fontSize="40"
        fontWeight="800"
        fill={ink}
        opacity={on}
        fontFamily={SANS}
      >
        $
      </text>
    </svg>
  );
}

const PaperCoins: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, w, h, pad } = useSheet();
  const length = g.to - g.from;
  const { fanAt } = coinBeats(length);
  const count = coinCount(g.items.length);
  const accent = inkAccent(theme);
  const big = Math.min(w, h) * 0.34;
  const ring = Math.min(w, h) * 0.3;
  const small = big * 0.38;
  const cy = h * 0.6;
  const fan = easeOut((frame - fanAt) / 10);
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      <Sheet frame={frame}>
        <Printed
          text={g.text}
          emphasis={g.emphasis}
          frame={frame}
          delay={2}
          theme={theme}
          style={{
            position: "absolute",
            left: pad,
            right: pad,
            top: h * 0.08,
            textAlign: "center",
            fontSize: unit * 5.6,
            fontWeight: 800,
            lineHeight: 1.15,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: w / 2 - big / 2,
            top: cy - big / 2,
            opacity: 1 - fan,
            transform: `scale(${1 - fan * 0.6}) rotate(${(1 - easeOut(frame / 20)) * -40}deg)`,
          }}
        >
          <DrawnCoin size={big} ink={accent} on={easeOut((frame - 4) / 12)} />
        </div>
        {frame >= fanAt &&
          Array.from({ length: count }, (_, i) => {
            const p = easeOut((frame - fanAt - i * 2) / 10);
            const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
            const label = g.items[i];
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: w / 2 + Math.cos(a) * ring * p - small / 2,
                  top: cy + Math.sin(a) * ring * p - small / 2,
                  width: small,
                  textAlign: "center",
                  opacity: p,
                }}
              >
                <DrawnCoin size={small} ink={accent} on={p} />
                {label && (
                  <div
                    style={{
                      fontSize: unit * 3,
                      fontWeight: 700,
                      marginTop: unit * 0.4,
                      whiteSpace: "nowrap",
                      marginLeft: -small,
                      marginRight: -small,
                    }}
                  >
                    {label}
                  </div>
                )}
              </div>
            );
          })}
      </Sheet>
    </Desk>
  );
};

const PaperStream: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const images = React.useContext(ImagesContext);
  const logo = React.useContext(LogoContext);
  const length = g.to - g.from;
  const pics = (g.scenes ?? []).map((sc) => (sc.image ? images[sc.image] : undefined));
  const beats = streamBeats(pics.length);
  const pile = logo ? pics : pics.slice(0, -1);
  const finale = logo ?? pics[pics.length - 1];
  const pw = portrait ? width * 0.5 : width * 0.2;
  const ph = pw * 1.1;
  // Prints drop onto the desk from above the camera: big, then settling.
  const drop = (at: number) => easeOut((frame - at) / 10);
  return (
    <Desk opacity={Math.min(easeOut(frame / 6), exitOpacity(frame, length))}>
      {g.text && (
        <div
          style={{
            position: "absolute",
            left: unit * 6,
            right: unit * 6,
            top: portrait ? "8%" : "5%",
            textAlign: "center",
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: unit * (portrait ? 6 : 4.6),
            color: PAPER,
            zIndex: 3,
            ...pop(frame, 2, unit),
          }}
        >
          {g.text}
        </div>
      )}
      {pile.map((url, i) => {
        const p = drop(beats.cards[i]);
        if (frame < beats.cards[i]) return null;
        return (
          <Print
            key={i}
            url={url}
            w={pw}
            h={ph}
            unit={unit}
            theme={theme}
            style={{
              left: width / 2 - pw / 2 + (rand(i, 1) - 0.5) * width * (portrait ? 0.4 : 0.3),
              top: height * 0.54 - ph / 2 + (rand(i, 2) - 0.5) * height * 0.2,
              opacity: clamp01(p * 2),
              transform: `scale(${1 + (1 - p) * 0.8}) rotate(${(rand(i, 3) - 0.5) * 36 + (1 - p) * 20}deg)`,
            }}
          />
        );
      })}
      {finale && frame >= beats.finaleAt && (
        <div
          style={{
            position: "absolute",
            left: width / 2 - pw * 0.55,
            top: height * 0.54 - pw * 0.55,
            width: pw * 1.1,
            height: pw * 1.1,
            background: "#FBF9F4",
            padding: pw * (logo ? 0.16 : 0.05),
            boxSizing: "border-box",
            boxShadow: `0 ${unit * 2}px ${unit * 7}px rgba(0,0,0,0.6)`,
            opacity: clamp01(drop(beats.finaleAt) * 2),
            transform: `scale(${1 + (1 - drop(beats.finaleAt)) * 0.9})`,
          }}
        >
          <Img
            src={finale}
            style={{ width: "100%", height: "100%", objectFit: logo ? "contain" : "cover" }}
          />
        </div>
      )}
    </Desk>
  );
};

const PaperProfile: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height, w, h, pad } = useSheet();
  const images = React.useContext(ImagesContext);
  const length = g.to - g.from;
  const d = g.profile ?? { handle: "", name: "", bio: "", posts: "", followers: "", following: "" };
  const shots = (g.scenes ?? []).map((sc) => (sc.image ? images[sc.image] : undefined));
  const grid = shots.slice(1, 7);
  const tiles = Array.from({ length: 6 }, (_, i) => grid[i]);
  const beats = profileBeats(grid.length, length);
  const current = beats.flicks.reduce((c, f, i) => (frame >= f ? i : c), -1);
  const text = unit * 3.4;
  const handle = d.handle ? `@${d.handle}` : "";
  const stat = (v: string, label: string) => (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontWeight: 800, fontSize: text * 1.3 }}>{v || "-"}</div>
      <div style={{ fontSize: text * 0.85, color: INK_SOFT }}>{label}</div>
    </div>
  );
  return (
    <Desk opacity={Math.min(easeOut(frame / 6), exitOpacity(frame, length))}>
      <Sheet frame={frame}>
        <div style={{ position: "absolute", left: pad, right: pad, top: pad }}>
          <div
            style={{
              textAlign: "center",
              fontWeight: 800,
              fontSize: text * 1.15,
              marginBottom: unit * 2,
            }}
          >
            {handle || d.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: unit * 2.4 }}>
            <div
              style={{
                width: w * 0.22,
                height: w * 0.22,
                borderRadius: "50%",
                overflow: "hidden",
                flexShrink: 0,
                border: `${unit * 0.4}px solid ${inkAccent(theme)}`,
                background: "#D8D2C4",
              }}
            >
              {shots[0] && (
                <Img src={shots[0]} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )}
            </div>
            <div style={{ display: "flex", flex: 1 }}>
              {stat(d.posts, "posts")}
              {stat(d.followers, "followers")}
              {stat(d.following, "following")}
            </div>
          </div>
          {(d.name || d.bio) && (
            <div style={{ marginTop: unit * 1.6, fontSize: text, lineHeight: 1.3 }}>
              {d.name && <div style={{ fontWeight: 800 }}>{d.name}</div>}
              {d.bio && <div style={{ color: INK_SOFT }}>{d.bio}</div>}
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: Math.max(2, unit * 0.35),
              marginTop: unit * 2.4,
            }}
          >
            {tiles.map((url, i) => (
              <div
                key={i}
                style={{
                  aspectRatio: "1 / 1",
                  overflow: "hidden",
                  background: "#D8D2C4",
                  ...pop(frame, beats.grid[i] ?? 10 + i * 5, unit * 2, 10),
                }}
              >
                {url && (
                  <Img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </Sheet>
      {current >= 0 && (
        <Print
          url={grid[current]}
          w={Math.min(width, height) * (portrait ? 0.8 : 0.62)}
          h={Math.min(width, height) * (portrait ? 0.8 : 0.62) * 0.9}
          caption={handle}
          unit={unit}
          theme={theme}
          style={{
            left: (width - Math.min(width, height) * (portrait ? 0.8 : 0.62)) / 2,
            top: height * (portrait ? 0.2 : 0.06),
            transform: `translateY(${(1 - easeOut((frame - beats.flicks[current]) / 5)) * h * 0.6}px) rotate(${(rand(current, 4) - 0.5) * 8}deg)`,
          }}
        />
      )}
    </Desk>
  );
};

const PaperChapter: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, h, pad } = useSheet();
  const length = g.to - g.from;
  const ch = g.chapter ?? { index: 1, count: 1 };
  if (g.behind) {
    return (
      <PaperStrips
        lines={[
          {
            text: `Part ${ch.index} of ${ch.count}`,
            emphasis: null,
            size: unit * 3.6,
          },
          { text: g.text, emphasis: null, size: unit * 10 },
        ]}
        frame={frame}
        length={length}
        theme={theme}
        big
      />
    );
  }
  return (
    <Desk opacity={exitOpacity(frame, length)}>
      {/* A stack: two sheets below, the section's sheet on top. */}
      <Sheet frame={frame - 2} rot={4} style={{ filter: "brightness(0.82)" }}>
        {null}
      </Sheet>
      <Sheet frame={frame - 1} rot={-3.5} style={{ filter: "brightness(0.9)" }}>
        {null}
      </Sheet>
      <Sheet frame={frame} rot={0.6}>
        <div style={{ position: "absolute", left: pad, right: pad, top: h * 0.3 }}>
          <div
            style={{
              fontSize: unit * 3.4,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: inkAccent(theme),
              ...pop(frame, 6, unit),
            }}
          >
            Part {ch.index} of {ch.count}
          </div>
          <Printed
            text={g.text}
            emphasis={g.emphasis}
            frame={frame}
            delay={10}
            theme={theme}
            style={{
              marginTop: unit * 2,
              fontSize: unit * 9,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          />
          <div style={{ display: "flex", gap: unit, marginTop: unit * 4 }}>
            {Array.from({ length: ch.count }, (_, i) => (
              <div
                key={i}
                style={{
                  width: unit * 2.2,
                  height: unit * 2.2,
                  borderRadius: "50%",
                  border: `2px solid ${INK}`,
                  background: i < ch.index ? inkAccent(theme) : "transparent",
                  opacity: clamp01((frame - 14 - i * 2) / 4),
                }}
              />
            ))}
          </div>
        </div>
      </Sheet>
    </Desk>
  );
};

/** A paper tag with a strip of tape, low on the left (over the footage). */
const PaperLabel: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from) }}>
      <div
        style={{
          position: "absolute",
          left: unit * 4,
          bottom: portrait ? "9%" : unit * 4,
          padding: `${unit * 1}px ${unit * 2.2}px`,
          background: PAPER,
          color: INK,
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: unit * 2.8,
          boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
          transform: "rotate(-2deg)",
          ...pop(frame, 0, unit),
        }}
      >
        <span
          style={{
            position: "absolute",
            left: unit * 1.5,
            top: -unit * 1.1,
            width: unit * 6,
            height: unit * 2,
            background: "rgba(240,228,190,0.75)",
            transform: "rotate(-6deg)",
          }}
        />
        <Marker theme={theme} on={(frame - 6) / 6}>
          {g.text}
        </Marker>
      </div>
    </AbsoluteFill>
  );
};

const CTA_TEXT = {
  like: "Like",
  subscribe: "Subscribe",
  comment: "Comment",
  link: "Link below",
} as const;
const CTA_ICON = { like: ThumbsUp, subscribe: Bell, comment: MessageCircle, link: Link2 } as const;

/** A sticky note the pen taps (the same moment the glass pointer clicks). */
const PaperCta: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const kind = g.cta ?? "like";
  const Icon = CTA_ICON[kind];
  const tap = frame >= 22 && frame < 28;
  const done = frame >= 24;
  const nw = unit * (portrait ? 40 : 30);
  const left = (width - nw) / 2;
  const top = height * (portrait ? 0.56 : 0.5);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from) }}>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: nw,
          padding: `${unit * 2.4}px ${unit * 2}px`,
          background: "#F6E27A",
          color: INK,
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: unit * 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: unit * 1.6,
          boxShadow: "0 10px 26px rgba(0,0,0,0.5)",
          transform: `rotate(-3deg) scale(${tap ? 0.96 : 1})`,
          ...pop(frame, 0, unit),
        }}
      >
        <Icon
          size={unit * 4.2}
          strokeWidth={2.6}
          color={done ? inkAccent(theme) : INK}
          fill={done && kind === "like" ? inkAccent(theme) : "none"}
        />
        <Marker theme={theme} on={(frame - 24) / 6}>
          {g.text || CTA_TEXT[kind]}
        </Marker>
      </div>
      <Pen
        at={penAt([{ at: 22, x: left + nw * 0.78, y: top + unit * 5 }], frame, unit)}
        unit={unit}
        theme={theme}
      />
    </AbsoluteFill>
  );
};

const PAPER_DRAW: Record<PlacedGraphic["type"], Draw> = {
  keyline: PaperKeyLine,
  counter: PaperCounter,
  list: PaperList,
  card: PaperCard,
  compare: PaperCompare,
  story: PaperStory,
  cartoon: PaperCartoon,
  steps: PaperSteps,
  loop: PaperLoop,
  coins: PaperCoins,
  stream: PaperStream,
  profile: PaperProfile,
  notes: NotesGraphic,
  chapter: PaperChapter,
  label: PaperLabel,
  cta: PaperCta,
};

/** One graphic in the paper look. */
export function PaperGraphic({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const Draw = PAPER_DRAW[g.type];
  return <Draw g={g} theme={theme} />;
}
