// The Bulletin look (News drop): newsroom graphics. Over the footage, a key
// line is a headline bar (a red UPDATE tag, then a navy bar that grows from
// the left, the words rising in, the key word in a red box); a number is a
// navy stat box that slides in from the side and ticks up, with a red label
// strip; a label is a white lower-third strap with a red edge. Chapters cut
// to a light section slate revealed by a red edge wiping across; a
// comparison is a split board whose two panels push in from opposite sides,
// "VS" where they meet.
// Everything else uses the Bulletin skin (MinimalGraphics BULLETIN_SKIN).
// Motion follows the saas-animation rules: one direction per move, fast then
// slow, a slow push while it holds, nothing bounces. No app imports: the
// worker bundles src/motion on its own.

import React from "react";
import { AbsoluteFill } from "remotion";
import { SANS } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
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

export const NEWS_RED = "#D7262E";
export const NEWS_NAVY = "#0B1F3A";
export const NEWS_PAGE = "#F4F5F7";
const WHITE = "#FFFFFF";
/** The headline tag: true for any news-style video (owner's pick, 2026-11-20). */
const TAG = "UPDATE";

/** The types the Bulletin look draws itself (not behind the speaker). */
const BULLETIN_TYPES = new Set<PlacedGraphic["type"]>([
  "keyline",
  "chapter",
  "counter",
  "label",
  "compare",
]);

export const isBulletinScene = (g: PlacedGraphic) => BULLETIN_TYPES.has(g.type) && !g.behind;

/** A move's progress: 0 before `at`, eased to 1 over `frames`. */
const p = (frame: number, at: number, frames: number) => easeOut((frame - at) / frames);

/** Leaves the way it came in, quicker: slides back out over the last frames. */
const out = (frame: number, length: number, frames = 7) =>
  easeIn((frame - (length - frames)) / frames);

/** Words rising in one by one behind a mask (no blur: news type is crisp). */
function Rising({
  text,
  emphasis,
  frame,
  delay,
  size,
  colour,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  delay: number;
  size: number;
  colour: string;
}) {
  return (
    <span style={{ display: "inline" }}>
      {splitWords(text, emphasis).map((w, i) => {
        const t = p(frame, delay + i * 2, 8);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              overflow: "hidden",
              verticalAlign: "bottom",
              marginRight: size * 0.22,
              paddingBottom: size * 0.04,
            }}
          >
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - t) * 105}%)`,
                color: w.special ? WHITE : colour,
                ...(w.special
                  ? {
                      background: NEWS_RED,
                      padding: `0 ${size * 0.16}px`,
                      boxShadow: `0 0 0 ${size * 0.02}px ${NEWS_RED}`,
                    }
                  : {}),
              }}
            >
              {w.w}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** A soft dark floor under over-the-footage graphics, so white type always reads. */
function Floor({ opacity, side }: { opacity: number; side: "bottom" | "right" }) {
  return (
    <AbsoluteFill
      style={{
        opacity,
        background:
          side === "bottom"
            ? "linear-gradient(to top, rgba(4, 10, 22, 0.55) 0%, rgba(4, 10, 22, 0.2) 30%, transparent 48%)"
            : "linear-gradient(to left, rgba(4, 10, 22, 0.5) 0%, transparent 45%)",
      }}
    />
  );
}

/** 1 · Key line: the headline bar over the footage. */
function Headline({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const size = unit * (portrait ? 6.4 : 5);
  const leave = out(frame, length);
  const tag = p(frame, 0, 7);
  const bar = p(frame, 3, 12);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Floor side="bottom" opacity={easeOut(frame / 10) * (1 - leave)} />
      <div
        style={{
          position: "absolute",
          left: portrait ? "5%" : "4%",
          right: portrait ? "5%" : "18%",
          bottom: portrait ? "17%" : "10%",
          transform: `translateX(${-leave * 110}%)`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: NEWS_RED,
            color: WHITE,
            fontWeight: 800,
            fontSize: size * 0.42,
            letterSpacing: "0.12em",
            padding: `${size * 0.12}px ${size * 0.3}px`,
            transform: `translateX(${(1 - tag) * -120}%)`,
          }}
        >
          {TAG}
        </div>
        <div
          style={{
            background: NEWS_NAVY,
            clipPath: `inset(0 ${(1 - bar) * 100}% 0 0)`,
            padding: `${size * 0.22}px ${size * 0.34}px`,
            fontSize: size,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            borderBottom: `${Math.max(2, unit * 0.45)}px solid ${NEWS_RED}`,
          }}
        >
          <Rising
            text={g.text}
            emphasis={g.emphasis}
            frame={frame}
            delay={9}
            size={size}
            colour={WHITE}
          />
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

/** 3 · Number: a navy stat box sliding in from the side, ticking up. */
function StatBox({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const box = p(frame, 0, 12);
  const leave = out(frame, length);
  const count = easeOut((frame - 6) / 24);
  const size = unit * (portrait ? 13 : 10);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Floor side="right" opacity={easeOut(frame / 10) * (1 - leave)} />
      <div
        style={{
          position: "absolute",
          right: portrait ? "6%" : "5%",
          top: portrait ? "20%" : "16%",
          minWidth: unit * (portrait ? 42 : 30),
          transform: `translateX(${(1 - box + leave) * 130}%)`,
          background: NEWS_NAVY,
          color: WHITE,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: size,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            padding: `${unit * 2.4}px ${unit * 3}px ${unit * 1.8}px`,
          }}
        >
          {shownNumber(n, count)}
        </div>
        {g.text && (
          <div
            style={{
              background: NEWS_RED,
              fontSize: unit * (portrait ? 2.6 : 2),
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: `${unit * 1}px ${unit * 2}px`,
              clipPath: `inset(0 ${(1 - p(frame, 8, 10)) * 100}% 0 0)`,
            }}
          >
            {g.text}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** 4 · Label: a white lower-third strap with a red edge, low left. */
function Strap({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const edge = p(frame, 0, 6);
  const strap = p(frame, 3, 11);
  const leave = out(frame, length);
  const size = unit * (portrait ? 4.6 : 3.6);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <div
        style={{
          position: "absolute",
          left: portrait ? "5%" : "4%",
          bottom: portrait ? "24%" : "16%",
          maxWidth: portrait ? "86%" : "60%",
          display: "flex",
          alignItems: "stretch",
          transform: `translateX(${-leave * 120}%)`,
        }}
      >
        <div style={{ width: unit * 1.1, background: NEWS_RED, transform: `scaleY(${edge})` }} />
        <div
          style={{
            background: WHITE,
            color: NEWS_NAVY,
            fontSize: size,
            fontWeight: 700,
            lineHeight: 1.2,
            padding: `${size * 0.4}px ${size * 0.7}px`,
            clipPath: `inset(0 ${(1 - strap) * 100}% 0 0)`,
          }}
        >
          <Rising text={g.text} emphasis={null} frame={frame} delay={7} size={size} colour={NEWS_NAVY} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** A slow push for full-frame boards while they hold (never reverses). */
const push = (frame: number, length: number) =>
  ({ transform: `scale(${1 + 0.035 * easeInOut(frame / length)})` }) as React.CSSProperties;

/** The red edge wiping left to right across the frame, revealing the board behind it. */
function Wipe({ frame }: { frame: number }) {
  const t = easeInOut(frame / 12);
  return (
    <>
      <AbsoluteFill style={{ clipPath: `inset(0 ${(1 - t) * 100}% 0 0)`, background: NEWS_PAGE }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${t * 100}%`,
          width: "2.4%",
          marginLeft: "-2.4%",
          background: NEWS_RED,
          opacity: t < 1 ? 1 : 0,
        }}
      />
    </>
  );
}

/** 2 · Chapter: a light section slate. */
function Slate({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const size = unit * (portrait ? 9 : 7.4);
  const shown = frame >= 12;
  return (
    <AbsoluteFill style={{ fontFamily: SANS, opacity: exitOpacity(frame, length, 6) }}>
      <Wipe frame={frame} />
      {shown && (
        <AbsoluteFill style={{ background: NEWS_PAGE, ...push(frame, length) }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "1.6%", background: NEWS_RED }} />
          <AbsoluteFill
            style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 9%" }}
          >
            {g.chapter && (
              <div
                style={{
                  background: NEWS_RED,
                  color: WHITE,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  fontSize: unit * (portrait ? 3.4 : 2.8),
                  padding: `${unit * 1}px ${unit * 2.2}px`,
                  marginBottom: unit * 3,
                  clipPath: `inset(0 ${(1 - p(frame, 12, 8)) * 100}% 0 0)`,
                }}
              >
                {`PART ${String(g.chapter.index).padStart(2, "0")}`}
              </div>
            )}
            <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.12, letterSpacing: "-0.025em" }}>
              <Rising
                text={g.text}
                emphasis={g.emphasis}
                frame={frame}
                delay={16}
                size={size}
                colour={NEWS_NAVY}
              />
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

/** 5 · Comparison: a split board, two panels pushing in from opposite sides. */
function SplitBoard({ g, frame, length }: { g: PlacedGraphic; frame: number; length: number }) {
  const { unit, portrait } = useUnit();
  const [a, b] = [g.items[0] ?? "", g.items[1] ?? ""];
  const left = p(frame, 0, 13);
  const right = p(frame, 5, 13);
  const size = unit * (portrait ? 6.4 : 5.2);
  const seam = unit * (portrait ? 7 : 6.5);
  const panel = (
    text: string,
    bg: string,
    t: number,
    from: 1 | -1,
    delay: number,
  ): React.ReactNode => (
    <div
      style={{
        flex: 1,
        background: bg,
        color: WHITE,
        // Clear of the "VS" disc where the panels meet.
        padding: portrait
          ? from < 0
            ? `${unit * 4}px ${unit * 4}px ${seam}px`
            : `${seam}px ${unit * 4}px ${unit * 4}px`
          : from < 0
            ? `${unit * 4}px ${seam}px ${unit * 4}px ${unit * 4}px`
            : `${unit * 4}px ${unit * 4}px ${unit * 4}px ${seam}px`,
        transform: portrait ? `translateY(${(1 - t) * 110 * from}%)` : `translateX(${(1 - t) * 110 * from}%)`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
        <Rising text={text} emphasis={null} frame={frame} delay={delay} size={size} colour={WHITE} />
      </div>
    </div>
  );
  return (
    <AbsoluteFill
      style={{ fontFamily: SANS, background: NEWS_PAGE, opacity: exitOpacity(frame, length, 6), overflow: "hidden" }}
    >
      <AbsoluteFill
        style={{
          padding: portrait ? "16% 7%" : "9% 7%",
          display: "flex",
          flexDirection: portrait ? "column" : "row",
          gap: unit * 1.4,
          ...push(frame, length),
        }}
      >
        {panel(a, NEWS_NAVY, left, -1, 10)}
        {panel(b, NEWS_RED, right, 1, 16)}
      </AbsoluteFill>
      {/* "VS" where the panels meet (true for any comparison). */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...push(frame, length) }}>
        <div
          style={{
            width: unit * (portrait ? 11 : 9),
            height: unit * (portrait ? 11 : 9),
            borderRadius: "50%",
            background: WHITE,
            color: NEWS_NAVY,
            fontWeight: 800,
            fontSize: unit * (portrait ? 4 : 3.2),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${p(frame, 14, 8)})`,
          }}
        >
          VS
        </div>
      </AbsoluteFill>
      {g.text && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: portrait ? "8%" : "3.5%",
            textAlign: "center",
            color: NEWS_NAVY,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontSize: unit * (portrait ? 3.2 : 2.8),
            opacity: clamp01((frame - 6) / 8),
          }}
        >
          {g.text}
        </div>
      )}
    </AbsoluteFill>
  );
}

export function BulletinScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const length = Math.max(1, g.to - g.from);
  const props = { g, frame, length };
  switch (g.type) {
    case "chapter":
      return <Slate {...props} />;
    case "counter":
      return <StatBox {...props} />;
    case "label":
      return <Strap {...props} />;
    case "compare":
      return <SplitBoard {...props} />;
    default:
      return <Headline {...props} />;
  }
}
