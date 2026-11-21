// The Monument look (Quote reel): a quote set like an inscription. Near-black
// stage, huge Instrument Serif italic in warm ivory with a soft fade to grey
// on the lower half of the letters, the key word in gold. Each word rises
// from blurred to sharp (saas-animation's text rule), then one soft band of
// light passes across the gold word. A metaphor shows its AI picture - a
// white marble sculpture of the idea - with a slow push and drift, the line
// beneath it. Behind the speaker, the line is huge italic around head
// height. Chapters and labels are small spaced gold capitals with thin gold
// rules drawing outward. Everything else uses the Monument skin
// (MinimalGraphics MONUMENT_SKIN). Every move goes one way and is slow. No
// app imports: the worker bundles src/motion on its own.

import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { SANS, SERIF } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import {
  ImagesContext,
  behindBand,
  clamp01,
  easeInOut,
  easeOut,
  exitOpacity,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

export const MONUMENT_BLACK = "#0D0B08";
export const MONUMENT_GOLD = "#C9A45C";
export const MONUMENT_IVORY = "#EDE6DA";

/** The types the Monument look draws itself. */
const MONUMENT_TYPES = new Set<PlacedGraphic["type"]>(["keyline", "metaphor", "chapter", "label"]);

export const isMonumentScene = (g: PlacedGraphic) =>
  MONUMENT_TYPES.has(g.type) && (!g.behind || g.type === "keyline");

/** Frames between words (about 0.08 s at 30 fps, rounded to the 15 fps step). */
const STAGGER = 3;

/** Ivory letters fading toward warm grey on their lower half. */
const IVORY_TEXT: React.CSSProperties = {
  backgroundImage: `linear-gradient(180deg, ${MONUMENT_IVORY} 52%, #A39C91 100%)`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

/** Gold letters with a band of light at `sweep` (0 → 1 crosses the word once). */
const goldText = (sweep: number): React.CSSProperties => ({
  backgroundImage: `linear-gradient(100deg, ${MONUMENT_GOLD} 0%, ${MONUMENT_GOLD} 42%, #FFF0CC 50%, ${MONUMENT_GOLD} 58%, ${MONUMENT_GOLD} 100%)`,
  backgroundSize: "300% 100%",
  backgroundPosition: `${100 - 100 * sweep}% 0`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
});

/** A word rising from blurred to sharp. */
const rise = (frame: number, at: number, size: number): React.CSSProperties => {
  const t = easeOut((frame - at) / 14);
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * size * 0.18}px)`,
    filter: t < 1 ? `blur(${(1 - t) * size * 0.08}px)` : undefined,
  };
};

/** The line, word by word, the key word in gold with its light sweep. */
function Inscription({
  text,
  emphasis,
  frame,
  size,
  delay = 0,
  shadow = false,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  size: number;
  delay?: number;
  shadow?: boolean;
}) {
  const words = splitWords(text, emphasis);
  const lastKey = words.reduce((k, w, i) => (w.special ? i : k), -1);
  // The sweep starts once the last gold word is sharp, and crosses in ~1 s.
  const sweep = easeInOut((frame - (delay + lastKey * STAGGER + 14)) / 30);
  return (
    <div
      style={{
        fontFamily: SERIF,
        fontStyle: "italic",
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: "-0.01em",
        textAlign: "center",
        filter: shadow ? "drop-shadow(0 0.04em 0.12em rgba(0, 0, 0, 0.55))" : undefined,
      }}
    >
      {words.map((w, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            margin: `0 ${size * 0.11}px`,
            paddingBottom: size * 0.06,
            ...rise(frame, delay + i * STAGGER, size),
            ...(w.special ? goldText(sweep) : IVORY_TEXT),
          }}
        >
          {w.w}
        </span>
      ))}
    </div>
  );
}

/** A slow dolly in, one way, over the graphic's life. */
const dolly = (frame: number, length: number, amount = 0.05): React.CSSProperties => ({
  transform: `scale(${1 + amount * easeInOut(frame / length)})`,
});

/** The warm light from the upper left, and dark edges. */
function Stage() {
  return (
    <>
      <AbsoluteFill style={{ background: MONUMENT_BLACK }} />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse 80% 60% at 32% 28%, rgba(201, 164, 92, 0.16), transparent 70%)" }}
      />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 50%, rgba(0, 0, 0, 0.7) 100%)" }}
      />
    </>
  );
}

/** 1 + 2 · The quote on the stage, with the light sweep on the gold word. */
function Quote({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  return (
    <AbsoluteFill style={{ opacity: Math.min(easeOut(frame / 8), exitOpacity(frame, length, 10)) }}>
      <Stage />
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", padding: "0 8%", ...dolly(frame, length) }}
      >
        <Inscription text={g.text} emphasis={g.emphasis} frame={frame} size={unit * (portrait ? 15 : 12)} delay={4} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** 3 · Metaphor: the marble sculpture with a slow push and drift, the line beneath. */
function Sculpture({ g, frame, length, url }: { g: PlacedGraphic; frame: number; length: number; url: string }) {
  const { unit, portrait } = useUnit();
  const t = easeInOut(frame / length);
  return (
    <AbsoluteFill style={{ opacity: Math.min(easeOut(frame / 10), exitOpacity(frame, length, 10)) }}>
      <AbsoluteFill style={{ background: MONUMENT_BLACK }} />
      <AbsoluteFill style={{ transform: `translate(${-1.5 + 3 * t}%, 0) scale(${1.04 + 0.1 * t})` }}>
        <Img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(13, 11, 8, 0.92) 0%, rgba(13, 11, 8, 0.55) 28%, transparent 50%), radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(0, 0, 0, 0.65) 100%)",
        }}
      />
      <div style={{ position: "absolute", left: "7%", right: "7%", bottom: portrait ? "11%" : "8%" }}>
        <Inscription text={g.text} emphasis={g.emphasis} frame={frame} size={unit * (portrait ? 9 : 7)} delay={14} />
      </div>
    </AbsoluteFill>
  );
}

/** 4 · Behind the speaker: huge italic around head height. */
function Behind({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length, 10) }}>
      <div style={{ ...behindBand(portrait), ...dolly(frame, length, 0.03) }}>
        <Inscription
          text={g.text}
          emphasis={g.emphasis}
          frame={frame}
          size={unit * (portrait ? 15 : 12)}
          shadow
        />
      </div>
    </AbsoluteFill>
  );
}

/** 5 · Chapter or label: small spaced gold capitals, thin rules drawing outward. */
function Title({ g, frame, length, stage }: { g: PlacedGraphic; frame: number; length: number; stage: boolean }) {
  const { unit, portrait } = useUnit();
  const rule = easeOut((frame - 10) / 18);
  const ruleStyle: React.CSSProperties = {
    width: unit * (portrait ? 10 : 8),
    height: Math.max(1, unit * 0.2),
    background: MONUMENT_GOLD,
    transform: `scaleX(${rule})`,
  };
  const words = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: unit * 2.4,
        fontFamily: SANS,
        fontWeight: stage ? 500 : 600,
        fontSize: unit * (portrait ? (stage ? 3.4 : 4) : stage ? 2.7 : 3.2),
        letterSpacing: "0.34em",
        textTransform: "uppercase",
        color: MONUMENT_GOLD,
        textShadow: stage ? undefined : "0 1px 10px rgba(0, 0, 0, 0.7)",
      }}
    >
      <div style={{ ...ruleStyle, transformOrigin: "100% 50%" }} />
      <span style={rise(frame, 2, unit * 3)}>{g.text}</span>
      <div style={{ ...ruleStyle, transformOrigin: "0% 50%" }} />
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: Math.min(easeOut(frame / 8), exitOpacity(frame, length, 10)) }}>
      {stage && <Stage />}
      {stage ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...dolly(frame, length, 0.04) }}>
          {g.chapter && (
            <div
              style={{
                fontFamily: SERIF,
                fontStyle: "italic",
                fontSize: unit * (portrait ? 14 : 11),
                lineHeight: 1,
                marginBottom: unit * 2,
                ...rise(frame, 0, unit * 10),
                ...goldText(clamp01((frame - 20) / 30)),
              }}
            >
              {ROMAN[g.chapter.index - 1] ?? g.chapter.index}
            </div>
          )}
          {words}
        </AbsoluteFill>
      ) : (
        <>
          {/* A soft dark floor so the thin gold reads on any footage. */}
          <AbsoluteFill
            style={{
              background: "linear-gradient(to top, rgba(13, 11, 8, 0.75) 0%, rgba(13, 11, 8, 0.35) 25%, transparent 42%)",
            }}
          />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: portrait ? "20%" : "13%" }}>{words}</div>
        </>
      )}
    </AbsoluteFill>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function MonumentScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const images = React.useContext(ImagesContext);
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  if (g.type === "chapter") return <Title {...props} stage />;
  if (g.type === "label") return <Title {...props} stage={false} />;
  if (g.type === "metaphor") {
    const path = g.scenes?.[0]?.image;
    const url = path ? images[path] : undefined;
    if (url) return <Sculpture {...props} url={url} />;
  }
  return g.behind ? <Behind {...props} /> : <Quote {...props} />;
}
