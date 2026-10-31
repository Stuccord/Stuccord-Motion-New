// The Minimal look: every Motion Explainer graphic as clean type and thin
// lines - no cards, glows or 3D. Words in one sans at light and medium
// weights, the key word in the accent colour, hairlines that draw on, lots
// of empty space, and gentle fades without blur. Full-screen graphics sit on
// a near-black page. Same timings and sounds as the other looks; only the
// drawing changes (the video's finish is set in looks.ts).

import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { Bell, Link2, MessageCircle, MousePointer2, ThumbsUp } from "lucide-react";
import { SANS, type MotionTheme } from "@/motion/theme";
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
  behindBand,
  clamp01,
  easeOut,
  exitOpacity,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

const PAGE = "#0D0D0F";
const INK = "#F2F2F0";
const SOFT = "rgba(242, 242, 240, 0.7)";
const LINE = "rgba(242, 242, 240, 0.2)";
const TILE = "#1B1B1F";
// Over the footage: a soft shadow under every word, so light words read on bright rooms.
const OVER = "0 1px 12px rgba(0, 0, 0, 0.55), 0 0 2px rgba(0, 0, 0, 0.35)";

type Draw = (p: { g: PlacedGraphic; theme: MotionTheme }) => React.ReactElement;

// ---------- shared pieces ----------

/** A gentle arrival: fades in and rises a little, no blur. */
function fade(frame: number, delay: number, unit: number, frames = 16): React.CSSProperties {
  const p = easeOut((frame - delay) / frames);
  return { opacity: p, transform: `translateY(${(1 - p) * unit * 1.4}px)` };
}

/** How far a hairline has drawn (0-1). */
const drawn = (frame: number, delay: number, frames = 18) => easeOut((frame - delay) / frames);

/** A line of words, one after another, the key word in the accent colour. */
function Words({
  text,
  emphasis,
  frame,
  delay = 0,
  step = 2,
  size,
  weight = 500,
  theme,
  unit,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  delay?: number;
  step?: number;
  size: number;
  weight?: number;
  theme: MotionTheme;
  unit: number;
}) {
  return (
    <>
      {splitWords(text, emphasis).map(({ w, special }, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            marginRight: size * 0.26,
            fontWeight: weight,
            color: special ? theme.accent : INK,
            ...fade(frame, delay + i * step, unit),
          }}
        >
          {w}
        </span>
      ))}
    </>
  );
}

/** A thin line that draws on from the left. */
function Rule({
  frame,
  delay,
  length,
  colour,
  unit,
  style,
}: {
  frame: number;
  delay: number;
  length: number;
  colour: string;
  unit: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        height: Math.max(1, unit * 0.22),
        width: length * drawn(frame, delay),
        background: colour,
        ...style,
      }}
    />
  );
}

/** A soft dark wash behind words over the footage, so they read anywhere. */
function Wash({ side, opacity }: { side: "bottom" | "left" | "right"; opacity: number }) {
  const to = side === "bottom" ? "to top" : side === "left" ? "to right" : "to left";
  return (
    <AbsoluteFill
      style={{
        opacity,
        background: `linear-gradient(${to}, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.5) 35%, rgba(0,0,0,0.22) 58%, transparent 76%)`,
      }}
    />
  );
}

/** The near-black page full-screen graphics sit on. */
function Page({ opacity, children }: { opacity: number; children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{ opacity, background: PAGE, fontFamily: SANS, color: INK, overflow: "hidden" }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** A full-screen graphic's title along the top, left-aligned under a short line. */
function Title({
  g,
  frame,
  theme,
  unit,
  portrait,
}: {
  g: PlacedGraphic;
  frame: number;
  theme: MotionTheme;
  unit: number;
  portrait: boolean;
}) {
  if (!g.text) return null;
  const size = unit * (portrait ? 5.2 : 4.2);
  return (
    <div
      style={{
        position: "absolute",
        left: unit * 8,
        right: unit * 8,
        top: portrait ? "9%" : "8%",
        fontSize: size,
        lineHeight: 1.18,
        letterSpacing: "-0.02em",
        zIndex: 2,
      }}
    >
      <Rule
        frame={frame}
        delay={0}
        length={unit * 8}
        colour={theme.accent}
        unit={unit}
        style={{ marginBottom: unit * 2.4 }}
      />
      <Words
        text={g.text}
        emphasis={g.emphasis}
        frame={frame}
        delay={2}
        size={size}
        theme={theme}
        unit={unit}
      />
    </div>
  );
}

/** A picture filling its box, or a flat tile while there's none. */
function Picture({ url, fit = "cover" }: { url: string | undefined; fit?: "cover" | "contain" }) {
  return url ? (
    <Img src={url} style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }} />
  ) : (
    <div style={{ width: "100%", height: "100%", background: TILE }} />
  );
}

/** Where words over the footage go: the lower part (tall) or the right side (wide). */
function sidePlace(portrait: boolean, unit: number): React.CSSProperties {
  return portrait
    ? { position: "absolute", left: unit * 8, right: unit * 8, top: "54%" }
    : {
        position: "absolute",
        left: "56%",
        right: unit * 7,
        top: "50%",
        transform: "translateY(-50%)",
      };
}

const format = (n: NonNullable<PlacedGraphic["number"]>, shown: number) => {
  const decimals = Number.isInteger(n.value)
    ? 0
    : Math.min(2, String(n.value).split(".")[1]?.length ?? 0);
  return `${n.prefix}${shown.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${n.suffix}`;
};

// ---------- over the footage ----------

const MinimalKeyLine: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  if (g.behind) {
    const size = unit * (portrait ? 11 : 9);
    return (
      <AbsoluteFill
        style={{ opacity: exitOpacity(frame, length), fontFamily: SANS, textShadow: OVER }}
      >
        <div style={{ ...behindBand(portrait), left: unit * 4, right: unit * 4 }}>
          <div style={{ fontSize: size, lineHeight: 1.02, letterSpacing: "-0.035em" }}>
            <Words
              text={g.text}
              emphasis={g.emphasis}
              frame={frame}
              size={size}
              weight={600}
              theme={theme}
              unit={unit}
            />
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  const size = unit * (portrait ? 6 : 4.8);
  return (
    <AbsoluteFill
      style={{ opacity: exitOpacity(frame, length), fontFamily: SANS, textShadow: OVER }}
    >
      <Wash side="bottom" opacity={easeOut(frame / 12)} />
      <div
        style={{
          position: "absolute",
          left: unit * 8,
          right: unit * 8,
          bottom: portrait ? "30%" : "17%",
          fontSize: size,
          lineHeight: 1.16,
          letterSpacing: "-0.02em",
        }}
      >
        <Words
          text={g.text}
          emphasis={g.emphasis}
          frame={frame}
          size={size}
          theme={theme}
          unit={unit}
        />
        <Rule
          frame={frame}
          delay={8}
          length={unit * 12}
          colour={theme.accent}
          unit={unit}
          style={{ marginTop: unit * 2.2 }}
        />
      </div>
    </AbsoluteFill>
  );
};

const MinimalCounter: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const value = format(n, n.value * easeOut((frame - 4) / 26));
  const label = g.text && (
    <div
      style={{
        fontSize: unit * (portrait ? 3 : 2.4),
        fontWeight: 500,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: SOFT,
        ...fade(frame, 6, unit),
      }}
    >
      {g.text}
    </div>
  );
  if (g.behind) {
    return (
      <AbsoluteFill
        style={{ opacity: exitOpacity(frame, length), fontFamily: SANS, textShadow: OVER }}
      >
        <div style={behindBand(portrait)}>
          {label}
          <div
            style={{
              fontWeight: 200,
              fontSize: unit * (portrait ? 30 : 24),
              lineHeight: 1,
              color: INK,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.05em",
              ...fade(frame, 0, unit),
            }}
          >
            {value}
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{ opacity: exitOpacity(frame, length), fontFamily: SANS, textShadow: OVER }}
    >
      <Wash side={portrait ? "bottom" : "right"} opacity={easeOut(frame / 12)} />
      <div style={sidePlace(portrait, unit)}>
        {label}
        <div
          style={{
            marginTop: unit * 1.2,
            fontWeight: 200,
            fontSize: unit * (portrait ? 17 : 13),
            lineHeight: 1,
            color: INK,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.05em",
            ...fade(frame, 0, unit),
          }}
        >
          {value}
        </div>
        <Rule
          frame={frame}
          delay={10}
          length={unit * 10}
          colour={theme.accent}
          unit={unit}
          style={{ marginTop: unit * 2.4 }}
        />
      </div>
    </AbsoluteFill>
  );
};

const MinimalList: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  // Items arrive one by one over the first two thirds (as the other looks).
  const step = g.items.length > 1 ? Math.max(6, (length * 0.66) / g.items.length) : 0;
  const size = unit * (portrait ? 4.6 : 3.6);
  return (
    <AbsoluteFill
      style={{ opacity: exitOpacity(frame, length), fontFamily: SANS, textShadow: OVER }}
    >
      <Wash side={portrait ? "bottom" : "left"} opacity={easeOut(frame / 12)} />
      <div
        style={
          portrait
            ? { position: "absolute", left: unit * 8, right: unit * 8, top: "48%" }
            : {
                position: "absolute",
                left: unit * 7,
                top: "50%",
                width: "40%",
                transform: "translateY(-50%)",
              }
        }
      >
        {g.text && (
          <div
            style={{
              fontSize: unit * (portrait ? 3 : 2.4),
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: SOFT,
              marginBottom: unit * 1.6,
              ...fade(frame, 0, unit),
            }}
          >
            {g.text}
          </div>
        )}
        {g.items.map((item, i) => {
          const at = Math.round(i * step);
          return (
            <div key={i}>
              <Rule
                frame={frame}
                delay={at}
                length={portrait ? unit * 84 : unit * 60}
                colour={LINE}
                unit={unit}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: unit * 2.4,
                  padding: `${unit * 1.6}px 0`,
                  fontSize: size,
                  fontWeight: 400,
                  lineHeight: 1.2,
                  ...fade(frame, at + 2, unit),
                }}
              >
                <span
                  style={{
                    fontSize: size * 0.6,
                    fontWeight: 500,
                    color: theme.accent,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {item}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const MinimalCard: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  const size = unit * (portrait ? 5.4 : 4.2);
  const lines = 1 + g.items.length;
  return (
    <AbsoluteFill
      style={{ opacity: exitOpacity(frame, length), fontFamily: SANS, textShadow: OVER }}
    >
      <Wash side={portrait ? "bottom" : "right"} opacity={easeOut(frame / 12)} />
      <div style={{ ...sidePlace(portrait, unit), display: "flex", gap: unit * 3 }}>
        {/* A thin accent line down the side, growing as the lines arrive. */}
        <div
          style={{
            width: Math.max(1, unit * 0.25),
            alignSelf: "stretch",
            background: theme.accent,
            transformOrigin: "top",
            transform: `scaleY(${drawn(frame, 0, 10 + lines * 5)})`,
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: size, lineHeight: 1.18, letterSpacing: "-0.02em" }}>
            <Words
              text={g.text}
              emphasis={g.emphasis}
              frame={frame}
              size={size}
              theme={theme}
              unit={unit}
            />
          </div>
          {g.items.map((line, i) => (
            <div
              key={i}
              style={{
                marginTop: unit * 1.4,
                fontSize: unit * (portrait ? 3.4 : 2.8),
                fontWeight: 400,
                lineHeight: 1.35,
                color: SOFT,
                ...fade(frame, 8 + i * 5, unit),
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const MinimalCompare: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  const [a, b] = [g.items[0] ?? "", g.items[1] ?? ""];
  const second = Math.max(10, Math.round(length * 0.4));
  const size = unit * (portrait ? 5 : 4);
  const side = (text: string, delay: number, on: boolean) => (
    <div
      style={{
        flex: 1,
        fontSize: size,
        fontWeight: on ? 500 : 300,
        lineHeight: 1.2,
        color: on ? INK : SOFT,
        ...fade(frame, delay, unit),
      }}
    >
      <div
        style={{
          width: unit * 1.2,
          height: unit * 1.2,
          borderRadius: "50%",
          marginBottom: unit * 1.6,
          ...(on
            ? { background: theme.accent }
            : { border: `${Math.max(1, unit * 0.2)}px solid ${SOFT}` }),
        }}
      />
      {text}
    </div>
  );
  return (
    <AbsoluteFill
      style={{ opacity: exitOpacity(frame, length), fontFamily: SANS, textShadow: OVER }}
    >
      <Wash side="bottom" opacity={easeOut(frame / 12)} />
      <div
        style={{
          position: "absolute",
          left: unit * 8,
          right: unit * 8,
          ...(portrait ? { top: "50%" } : { bottom: "16%" }),
        }}
      >
        {g.text && (
          <div
            style={{
              fontSize: unit * (portrait ? 3 : 2.4),
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: SOFT,
              marginBottom: unit * 2.4,
              ...fade(frame, 0, unit),
            }}
          >
            {g.text}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: unit * 3 }}>
          {side(a, 0, false)}
          {/* The divider draws as the second side arrives. */}
          <div
            style={
              portrait
                ? {
                    height: Math.max(1, unit * 0.2),
                    width: `${drawn(frame, second - 6) * 100}%`,
                    background: LINE,
                  }
                : {
                    width: Math.max(1, unit * 0.2),
                    alignSelf: "stretch",
                    background: LINE,
                    transformOrigin: "top",
                    transform: `scaleY(${drawn(frame, second - 6)})`,
                  }
            }
          />
          {side(b, second, true)}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const MinimalLabel: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  return (
    <AbsoluteFill
      style={{ opacity: exitOpacity(frame, g.to - g.from), fontFamily: SANS, textShadow: OVER }}
    >
      <div
        style={{
          position: "absolute",
          left: unit * 5,
          bottom: portrait ? "9%" : unit * 5,
          display: "flex",
          alignItems: "center",
          gap: unit * 1.4,
          fontSize: unit * (portrait ? 3.2 : 2.6),
          fontWeight: 500,
          letterSpacing: "0.04em",
          color: INK,
          textShadow: "0 1px 8px rgba(0,0,0,0.55)",
        }}
      >
        <Rule frame={frame} delay={0} length={unit * 4} colour={theme.accent} unit={unit} />
        <span style={fade(frame, 4, unit)}>{g.text}</span>
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

const MinimalCta: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const kind = g.cta ?? "like";
  // The pointer glides in and clicks (the click sound is at the same frame).
  const arrive = easeOut((frame - 6) / 14);
  const click = frame >= 22 && frame < 30;
  const done = frame >= 26;
  const Icon = CTA_ICON[kind];
  return (
    <AbsoluteFill
      style={{ opacity: exitOpacity(frame, g.to - g.from), fontFamily: SANS, textShadow: OVER }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: portrait ? "32%" : "31%",
          transform: `translateX(-50%) scale(${click ? 0.96 : 1})`,
          display: "flex",
          alignItems: "center",
          gap: unit * 1.4,
          padding: `${unit * 1.4}px ${unit * 3.2}px`,
          borderRadius: unit * 5,
          border: `${Math.max(1, unit * 0.2)}px solid ${done ? INK : "rgba(242,242,240,0.6)"}`,
          background: done ? INK : "rgba(13,13,15,0.35)",
          color: done ? PAGE : INK,
          fontWeight: 500,
          fontSize: unit * 3.2,
          ...fade(frame, 0, unit),
        }}
      >
        <Icon size={unit * 3.4} strokeWidth={1.6} color={done ? theme.accent : INK} />
        {g.text || CTA_TEXT[kind]}
        <span
          style={{
            position: "absolute",
            right: -unit * 2 + (1 - arrive) * -unit * 14,
            bottom: -unit * 3 + (1 - arrive) * -unit * 10,
            opacity: arrive,
            transform: click ? "scale(0.88)" : undefined,
          }}
        >
          <MousePointer2 size={unit * 4.4} fill={INK} strokeWidth={1.2} color={PAGE} />
        </span>
      </div>
    </AbsoluteFill>
  );
};

// ---------- full screen ----------

const MinimalChapter: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  const ch = g.chapter ?? { index: 1, count: 1 };
  const size = unit * (g.behind ? 11 : portrait ? 8 : 6.6);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <Page opacity={Math.min(easeOut(frame / 8), exitOpacity(frame, length))}>
      <div
        style={
          g.behind
            ? { ...behindBand(portrait), left: "6%", right: "6%" }
            : {
                position: "absolute",
                left: unit * 9,
                right: unit * 9,
                top: "50%",
                transform: "translateY(-50%)",
              }
        }
      >
        <div
          style={{
            fontSize: unit * 2.8,
            fontWeight: 500,
            letterSpacing: "0.2em",
            color: theme.accent,
            fontVariantNumeric: "tabular-nums",
            ...fade(frame, 0, unit),
          }}
        >
          {pad(ch.index)} — {pad(ch.count)}
        </div>
        <div
          style={{
            marginTop: unit * 2.4,
            fontSize: size,
            lineHeight: 1.06,
            letterSpacing: "-0.035em",
          }}
        >
          <Words
            text={g.text}
            emphasis={g.emphasis}
            frame={frame}
            delay={4}
            step={3}
            size={size}
            weight={300}
            theme={theme}
            unit={unit}
          />
        </div>
        {/* One thin segment per part; this one fills. */}
        <div style={{ display: "flex", gap: unit * 1.2, marginTop: unit * 4.4 }}>
          {Array.from({ length: ch.count }, (_, i) => {
            const fill = i < ch.index - 1 ? 1 : i === ch.index - 1 ? drawn(frame, 8, 20) : 0;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: Math.max(1, unit * 0.3),
                  background: LINE,
                  ...fade(frame, 2 + i * 2, unit),
                }}
              >
                <div style={{ height: "100%", width: `${fill * 100}%`, background: INK }} />
              </div>
            );
          })}
        </div>
      </div>
    </Page>
  );
};

/** A picture in a thin frame with its words: shared by stories and cartoons. */
function FramedPicture({
  url,
  text,
  emphasis,
  frame,
  life,
  theme,
  unit,
  portrait,
}: {
  url: string | undefined;
  text: string;
  emphasis: string | null;
  /** Frames since this picture came in. */
  frame: number;
  /** How long it stays (frames), for its slow push in. */
  life: number;
  theme: MotionTheme;
  unit: number;
  portrait: boolean;
}) {
  const size = unit * (portrait ? 5.2 : 4.2);
  const push = 1 + 0.06 * clamp01(frame / Math.max(1, life));
  return (
    <>
      <div
        style={{
          position: "absolute",
          ...(portrait
            ? { left: unit * 7, right: unit * 7, top: "8%", height: "60%" }
            : { left: unit * 7, top: unit * 7, bottom: unit * 7, width: "54%" }),
          overflow: "hidden",
          border: `${Math.max(1, unit * 0.15)}px solid ${LINE}`,
        }}
      >
        <div style={{ width: "100%", height: "100%", transform: `scale(${push})` }}>
          <Picture url={url} />
        </div>
      </div>
      {text && (
        <div
          style={{
            position: "absolute",
            ...(portrait
              ? { left: unit * 7, right: unit * 7, top: "73%" }
              : { left: "66%", right: unit * 7, top: "50%", transform: "translateY(-50%)" }),
            fontSize: size,
            lineHeight: 1.18,
            letterSpacing: "-0.02em",
          }}
        >
          <Rule
            frame={frame}
            delay={2}
            length={unit * 8}
            colour={theme.accent}
            unit={unit}
            style={{ marginBottom: unit * 2.2 }}
          />
          <Words
            text={text}
            emphasis={emphasis}
            frame={frame}
            delay={4}
            size={size}
            theme={theme}
            unit={unit}
          />
        </div>
      )}
    </>
  );
}

const MinimalStory: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const images = React.useContext(ImagesContext);
  const length = g.to - g.from;
  const scenes = g.scenes ?? [];
  const starts = scenes.map((sc) => Math.max(0, sc.from - g.from));
  // Each scene fades in over the one before it.
  return (
    <Page opacity={Math.min(easeOut(frame / 8), exitOpacity(frame, length))}>
      {scenes.map((sc, i) => {
        if (frame < starts[i]) return null;
        const end = starts[i + 1] ?? length;
        // Gone once the next one is fully in.
        if (frame >= end + 10) return null;
        return (
          <AbsoluteFill
            key={i}
            style={{ opacity: easeOut((frame - starts[i]) / 10), background: PAGE }}
          >
            <FramedPicture
              url={sc.image ? images[sc.image] : undefined}
              text={sc.text}
              emphasis={sc.emphasis}
              frame={frame - starts[i]}
              life={end - starts[i]}
              theme={theme}
              unit={unit}
              portrait={portrait}
            />
          </AbsoluteFill>
        );
      })}
    </Page>
  );
};

const MinimalCartoon: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const images = React.useContext(ImagesContext);
  const length = g.to - g.from;
  const scene = g.scenes?.[0];
  return (
    <Page opacity={Math.min(easeOut(frame / 6), exitOpacity(frame, length))}>
      <FramedPicture
        url={scene?.image ? images[scene.image] : undefined}
        text={scene?.text ?? ""}
        emphasis={scene?.emphasis ?? null}
        frame={frame}
        life={length}
        theme={theme}
        unit={unit}
        portrait={portrait}
      />
    </Page>
  );
};

const MinimalSteps: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const length = g.to - g.from;
  const items = g.items.length ? g.items : [""];
  const n = items.length;
  const starts = stepStarts(n, length);
  // A track with a node per step, filling to each as it's reached:
  // down the left (tall videos) or across (wide ones).
  const a = portrait ? height * 0.3 : width * 0.12;
  const b = portrait ? height * 0.86 : width * 0.88;
  const pos = (i: number) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1));
  // The last step reached; the fill runs on to it as it's reached.
  const reached = starts.reduce((r, s, i) => (frame >= s ? i : r), 0);
  const prev = pos(Math.max(0, reached - 1));
  const fillTo = prev + (pos(reached) - prev) * easeOut((frame - starts[reached]) / 8);
  const fillFrom = pos(0);
  const track = portrait ? width * 0.16 : height * 0.56;
  const thin = Math.max(1, unit * 0.22);
  const lineIn = drawn(frame, 0, 20);
  return (
    <Page opacity={Math.min(easeOut(frame / 8), exitOpacity(frame, length))}>
      <Title g={g} frame={frame} theme={theme} unit={unit} portrait={portrait} />
      {/* The track, then how far along it is. */}
      <div
        style={
          portrait
            ? {
                position: "absolute",
                left: track,
                top: a,
                height: (b - a) * lineIn,
                width: thin,
                background: LINE,
              }
            : {
                position: "absolute",
                top: track,
                left: a,
                width: (b - a) * lineIn,
                height: thin,
                background: LINE,
              }
        }
      />
      <div
        style={
          portrait
            ? {
                position: "absolute",
                left: track,
                top: fillFrom,
                height: Math.max(0, fillTo - fillFrom),
                width: thin,
                background: theme.accent,
              }
            : {
                position: "absolute",
                top: track,
                left: fillFrom,
                width: Math.max(0, fillTo - fillFrom),
                height: thin,
                background: theme.accent,
              }
        }
      />
      {items.map((label, i) => {
        const p = pos(i);
        const on = frame >= starts[i];
        const pop = easeOut((frame - starts[i]) / 8);
        const r = unit * 1.5;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: (portrait ? track : p) - r + thin / 2,
                top: (portrait ? p : track) - r + thin / 2,
                width: r * 2,
                height: r * 2,
                borderRadius: "50%",
                boxSizing: "border-box",
                border: `${thin}px solid ${on ? theme.accent : SOFT}`,
                background: on ? theme.accent : PAGE,
                transform: `scale(${on ? 1 + 0.25 * (1 - pop) : 1})`,
                ...fade(frame, i * 3, unit),
              }}
            />
            <div
              style={{
                position: "absolute",
                ...(portrait
                  ? { left: track + unit * 5, right: unit * 7, top: p - unit * 3.4 }
                  : {
                      left: p - (width * 0.4) / Math.max(2, n),
                      width: (width * 0.8) / Math.max(2, n),
                      top: track + unit * 3.4,
                      textAlign: "center",
                    }),
                ...fade(frame, starts[i] + 2, unit),
              }}
            >
              <div
                style={{
                  fontSize: unit * 2.4,
                  fontWeight: 500,
                  letterSpacing: "0.16em",
                  color: on ? theme.accent : SOFT,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              {label && (
                <div
                  style={{
                    marginTop: unit * 0.8,
                    fontSize: unit * (portrait ? 4.4 : 3.4),
                    fontWeight: on && i === reached ? 500 : 400,
                    color: on ? INK : SOFT,
                    lineHeight: 1.2,
                  }}
                >
                  {label}
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </Page>
  );
};

const MinimalLoop: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const length = g.to - g.from;
  const items = g.items;
  const n = Math.max(1, items.length);
  const beats = loopBeats(n, length);
  const R = Math.min(width, height) * 0.13;
  const cx = width / 2;
  const cy = height * (portrait ? 0.54 : 0.56);
  const rx = R * (portrait ? 1.75 : 2.6);
  const ry = R * (portrait ? 2.2 : 1.45);
  const at = (k: number) => {
    const ang = -Math.PI / 2 + k * Math.PI * 2;
    return { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) };
  };
  const pts = Array.from({ length: 121 }, (_, i) => at(i / 120));
  const d = pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
  const perimeter = pts.reduce(
    (sum, q, i) => (i ? sum + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0),
    0,
  );
  const arc = easeOut((frame - beats.arcFrom) / beats.arcFrames);
  const swapT = g.swap ? clamp01((frame - beats.swapAt) / 8) : 0;
  const thin = Math.max(1, unit * 0.22);
  return (
    <Page opacity={Math.min(easeOut(frame / 8), exitOpacity(frame, length))}>
      <Title g={g} frame={frame} theme={theme} unit={unit} portrait={portrait} />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <path d={d} fill="none" stroke={LINE} strokeWidth={thin} opacity={easeOut(frame / 10)} />
        <path
          d={d}
          fill="none"
          stroke={theme.accent}
          strokeWidth={thin * 1.4}
          strokeDasharray={perimeter}
          strokeDashoffset={perimeter * (1 - arc)}
        />
      </svg>
      {items.map((label, i) => {
        const q = at(i / n);
        const dotP = easeOut((frame - beats.dots[i]) / 5);
        const dx = q.x - cx;
        const dy = q.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const lx = q.x + (dx / len) * unit * 5 + Math.sign(dx) * unit * 1.5;
        const ly = q.y + (dy / len) * unit * 4.5;
        const align = Math.abs(dx) < rx * 0.2 ? "center" : dx > 0 ? "left" : "right";
        const swapped = g.swap?.item === i;
        const size = unit * (portrait ? 3.8 : 3);
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: q.x - unit * 0.9,
                top: q.y - unit * 0.9,
                width: unit * 1.8,
                height: unit * 1.8,
                borderRadius: "50%",
                background: INK,
                transform: `scale(${frame >= beats.dots[i] ? dotP : 0})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: ly,
                transform: `translate(${align === "center" ? "-50%" : "0"}, -50%)`,
                ...(align === "left"
                  ? { left: lx, width: Math.max(unit * 12, width - lx - unit * 3) }
                  : align === "right"
                    ? { left: unit * 3, width: Math.max(unit * 12, lx - unit * 3) }
                    : { left: lx, width: width * 0.6 }),
                textAlign: align,
                fontWeight: 400,
                fontSize: size,
                lineHeight: 1.15,
              }}
            >
              <div style={{ display: "grid", ...fade(frame, beats.dots[i], unit, 10) }}>
                <span
                  style={{
                    gridArea: "1 / 1",
                    opacity: swapped ? 1 - swapT : 1,
                    transform: swapped ? `translateY(${-swapT * size * 0.8}px)` : undefined,
                  }}
                >
                  {label}
                </span>
                {swapped && g.swap && (
                  <span
                    style={{
                      gridArea: "1 / 1",
                      opacity: swapT,
                      transform: `translateY(${(1 - swapT) * size * 0.8}px)`,
                      color: theme.accent,
                      fontWeight: 500,
                    }}
                  >
                    {g.swap.text}
                  </span>
                )}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </Page>
  );
};

const MinimalCoins: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const length = g.to - g.from;
  const { fanAt } = coinBeats(length);
  const count = coinCount(g.items.length);
  const thin = Math.max(1, unit * 0.22);
  const cx = width / 2;
  const cy = height * (portrait ? 0.55 : 0.57);
  // One ring with a currency sign draws on...
  const C = Math.min(width, height) * (portrait ? 0.34 : 0.28);
  const ringIn = drawn(frame, 0, 16);
  const fan = easeOut((frame - fanAt) / 12);
  // ...then becomes a circle of small rings round where it was.
  const ringR = Math.min(width, height) * (portrait ? 0.3 : 0.26);
  const small = C * 0.36;
  const coin = (size: number, sign: number, on: number): React.ReactElement => (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        boxSizing: "border-box",
        border: `${thin}px solid ${INK}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 200,
        fontSize: size * sign,
        color: theme.accent,
        opacity: on,
      }}
    >
      $
    </div>
  );
  const circumference = Math.PI * C;
  return (
    <Page opacity={Math.min(easeOut(frame / 8), exitOpacity(frame, length))}>
      <Title g={g} frame={frame} theme={theme} unit={unit} portrait={portrait} />
      {frame < fanAt + 12 && (
        <div
          style={{
            position: "absolute",
            left: cx - C / 2,
            top: cy - C / 2,
            width: C,
            height: C,
            opacity: 1 - fan,
            transform: `scale(${1 - fan * 0.6})`,
          }}
        >
          <svg width={C} height={C} style={{ position: "absolute", inset: 0 }}>
            <circle
              cx={C / 2}
              cy={C / 2}
              r={C / 2 - thin}
              fill="none"
              stroke={INK}
              strokeWidth={thin}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - ringIn)}
              transform={`rotate(-90 ${C / 2} ${C / 2})`}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 200,
              fontSize: C * 0.5,
              color: theme.accent,
              ...fade(frame, 8, unit),
            }}
          >
            $
          </div>
        </div>
      )}
      {frame >= fanAt &&
        Array.from({ length: count }, (_, i) => {
          const p = easeOut((frame - fanAt - i * 2) / 12);
          const ang = ((-90 + (360 * i) / count) * Math.PI) / 180;
          const x = cx + Math.cos(ang) * ringR * p;
          const y = cy + Math.sin(ang) * ringR * p * 0.92;
          const label = g.items[i];
          return (
            <div key={i} style={{ position: "absolute", left: x - small / 2, top: y - small / 2 }}>
              {coin(small, 0.5, p)}
              {label && (
                <div
                  style={{
                    position: "absolute",
                    left: -small,
                    width: small * 3,
                    top: small + unit,
                    textAlign: "center",
                    fontWeight: 400,
                    fontSize: unit * (portrait ? 3.2 : 2.6),
                    ...fade(frame, fanAt + 6 + i * 2, unit, 10),
                  }}
                >
                  {label}
                </div>
              )}
            </div>
          );
        })}
    </Page>
  );
};

const MinimalStream: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const images = React.useContext(ImagesContext);
  const logo = React.useContext(LogoContext);
  const length = g.to - g.from;
  const pics = (g.scenes ?? []).map((sc) => (sc.image ? images[sc.image] : undefined));
  const beats = streamBeats(pics.length);
  // A neat grid of the pictures, one by one; then the last card (the logo,
  // or without one the last picture) comes up big over them.
  const pile = logo ? pics : pics.slice(0, -1);
  const finale = logo ?? pics[pics.length - 1];
  const cols = portrait ? 3 : 5;
  const rows = Math.max(1, Math.ceil(pile.length / cols));
  const gap = unit * 1.2;
  const areaW = width - unit * 16;
  const areaH = height * (portrait ? 0.6 : 0.58);
  const tw = Math.min((areaW - gap * (cols - 1)) / cols, (areaH - gap * (rows - 1)) / rows / 1.25);
  const th = tw * 1.25;
  const gridW =
    tw * Math.min(cols, Math.max(1, pile.length)) +
    gap * (Math.min(cols, Math.max(1, pile.length)) - 1);
  const top = height * (portrait ? 0.28 : 0.3);
  const end = easeOut((frame - beats.finaleAt) / 10);
  const fw = Math.min(width, height) * (portrait ? 0.56 : 0.42);
  return (
    <Page opacity={Math.min(easeOut(frame / 6), exitOpacity(frame, length))}>
      <Title g={g} frame={frame} theme={theme} unit={unit} portrait={portrait} />
      <div
        style={{
          position: "absolute",
          left: (width - gridW) / 2,
          top,
          width: gridW,
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(cols, Math.max(1, pile.length))}, ${tw}px)`,
          gap,
          opacity: finale ? 1 - end * 0.75 : 1,
        }}
      >
        {pile.map((url, i) => (
          <div
            key={i}
            style={{
              width: tw,
              height: th,
              overflow: "hidden",
              ...fade(frame, beats.cards[i] ?? 0, unit, 8),
            }}
          >
            <Picture url={url} />
          </div>
        ))}
      </div>
      {finale && frame >= beats.finaleAt && (
        <div
          style={{
            position: "absolute",
            left: width / 2 - fw / 2,
            top: height * (portrait ? 0.56 : 0.58) - (logo ? fw : fw * 1.25) / 2,
            width: fw,
            height: logo ? fw : fw * 1.25,
            boxSizing: "border-box",
            padding: logo ? fw * 0.16 : 0,
            background: logo ? PAGE : undefined,
            border: `${Math.max(1, unit * 0.2)}px solid ${logo ? LINE : INK}`,
            overflow: "hidden",
            opacity: end,
            transform: `scale(${0.96 + 0.04 * end})`,
          }}
        >
          <Picture url={finale} fit={logo ? "contain" : "cover"} />
        </div>
      )}
    </Page>
  );
};

const MinimalProfile: Draw = ({ g, theme }) => {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const images = React.useContext(ImagesContext);
  const length = g.to - g.from;
  const d = g.profile ?? { handle: "", name: "", bio: "", posts: "", followers: "", following: "" };
  const shots = (g.scenes ?? []).map((sc) => (sc.image ? images[sc.image] : undefined));
  const avatar = shots[0];
  const grid = shots.slice(1, 7);
  const tiles = Array.from({ length: 6 }, (_, i) => grid[i]);
  const beats = profileBeats(grid.length, length);
  const handle = d.handle ? `@${d.handle}` : "";
  const cw = portrait ? width * 0.84 : Math.min(width * 0.4, height * 0.62);
  const flicking = beats.flicks.length > 0 && frame >= beats.flickFrom;
  const current = beats.flicks.reduce((c, f, i) => (frame >= f ? i : c), -1);
  const away = flicking ? easeOut((frame - beats.flickFrom) / 8) : 0;
  const text = unit * (portrait ? 3.4 : 2.3);
  const stat = (value: string, label: string) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 500, fontSize: text * 1.3, fontVariantNumeric: "tabular-nums" }}>
        {value || "-"}
      </div>
      <div style={{ fontSize: text * 0.85, color: SOFT }}>{label}</div>
    </div>
  );
  return (
    <Page opacity={Math.min(easeOut(frame / 6), exitOpacity(frame, length))}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: 1 - away * 0.85,
          transform: `scale(${1.04 - 0.04 * easeOut(frame / 30)})`,
        }}
      >
        <div style={{ width: cw }}>
          <div style={fade(frame, 0, unit, 12)}>
            <div style={{ display: "flex", alignItems: "center", gap: unit * 3 }}>
              <div
                style={{
                  width: cw * 0.22,
                  height: cw * 0.22,
                  borderRadius: "50%",
                  overflow: "hidden",
                  flexShrink: 0,
                  border: `${Math.max(1, unit * 0.2)}px solid ${theme.accent}`,
                  boxSizing: "border-box",
                }}
              >
                <Picture url={avatar} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: text * 1.15, marginBottom: unit * 1.2 }}>
                  {handle || d.name}
                </div>
                <div style={{ display: "flex" }}>
                  {stat(d.posts, "posts")}
                  {stat(d.followers, "followers")}
                  {stat(d.following, "following")}
                </div>
              </div>
            </div>
            {(d.name || d.bio) && (
              <div
                style={{ marginTop: unit * 2, fontSize: text, lineHeight: 1.35, fontWeight: 300 }}
              >
                {d.name && <div style={{ fontWeight: 500 }}>{d.name}</div>}
                {d.bio && <div style={{ color: SOFT }}>{d.bio}</div>}
              </div>
            )}
          </div>
          <Rule
            frame={frame}
            delay={6}
            length={cw}
            colour={LINE}
            unit={unit}
            style={{ margin: `${unit * 2.6}px 0` }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: Math.max(2, unit * 0.5),
            }}
          >
            {tiles.map((url, i) => (
              <div
                key={i}
                style={{
                  aspectRatio: "1 / 1",
                  overflow: "hidden",
                  ...fade(frame, beats.grid[i] ?? 10 + i * 5, unit, 10),
                }}
              >
                <Picture url={url} />
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
      {flicking && current >= 0 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          {(() => {
            const t = easeOut((frame - beats.flicks[current]) / 5);
            const size = Math.min(width, height) * (portrait ? 0.8 : 0.66);
            return (
              <div style={{ textAlign: "center", opacity: t }}>
                <div
                  style={{
                    width: size,
                    height: size,
                    overflow: "hidden",
                    border: `${Math.max(1, unit * 0.15)}px solid ${LINE}`,
                    transform: `scale(${1.03 - 0.03 * t})`,
                  }}
                >
                  <Picture url={grid[current]} />
                </div>
                {handle && (
                  <div
                    style={{
                      marginTop: unit * 2.6,
                      fontWeight: 500,
                      fontSize: text * 1.2,
                      color: SOFT,
                    }}
                  >
                    {handle}
                  </div>
                )}
              </div>
            );
          })()}
        </AbsoluteFill>
      )}
    </Page>
  );
};

const MINIMAL_DRAW: Record<PlacedGraphic["type"], Draw> = {
  keyline: MinimalKeyLine,
  counter: MinimalCounter,
  list: MinimalList,
  card: MinimalCard,
  compare: MinimalCompare,
  story: MinimalStory,
  cartoon: MinimalCartoon,
  steps: MinimalSteps,
  loop: MinimalLoop,
  coins: MinimalCoins,
  stream: MinimalStream,
  profile: MinimalProfile,
  notes: NotesGraphic,
  chapter: MinimalChapter,
  label: MinimalLabel,
  cta: MinimalCta,
};

/** One graphic in the minimal look. */
export function MinimalGraphic({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const Draw = MINIMAL_DRAW[g.type];
  return <Draw g={g} theme={theme} />;
}
