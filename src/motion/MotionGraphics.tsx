// The Motion Explainer graphics as a Remotion composition: drawn over the
// footage in the editor preview (via @remotion/player's Thumbnail) and, in
// stage 3, rendered the same way for the export.
//
// The look follows docs/style-research (tutorials 1, 2 and 5): dark glass
// cards with rounded corners and a glowing edge, one sans font plus an
// italic serif for the special word, a 60/30/10 colour split, pop-ins that
// rise, unblur and fade with a fast-start/slow-end ease, items staggered,
// and graphics stepped at 15 fps for a hand-made feel.

import React from "react";
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Bell, Link2, MessageCircle, MousePointer2, ThumbsUp } from "lucide-react";
import { SANS, SERIF, type MotionTheme } from "@/motion/theme";
import { storyCamera, type PlacedGraphic } from "@/motion/timing";

export type MotionGraphicsProps = {
  graphics: PlacedGraphic[];
  theme: MotionTheme;
  /** Links to story pictures, by storage path. */
  images?: Record<string, string>;
};

/** Story pictures' links, for the story graphic. */
const ImagesContext = React.createContext<Record<string, string>>({});

// ---------- motion helpers ----------

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/** Timings below are in frames at 30 fps. */
const BASE_FPS = 30;

/**
 * Graphics move at 15 fps (every other frame at 30), like the studied edits.
 * Returns the frame in 30 fps terms, whatever rate the composition runs at:
 * the export draws at 15 fps, since every other frame would be the same.
 */
function useStepFrame() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (fps >= BASE_FPS) return Math.floor(frame / 2) * 2;
  return Math.floor((frame * BASE_FPS) / fps / 2) * 2;
}

/** A pop-in that starts `delay` frames in: rise, unblur, fade in. */
function pop(frame: number, delay: number, unit: number, frames = 14): React.CSSProperties {
  const p = easeOut((frame - delay) / frames);
  return {
    opacity: p,
    transform: `translateY(${(1 - p) * unit * 2.4}px)`,
    filter: p < 1 ? `blur(${(1 - p) * unit * 0.9}px)` : undefined,
  };
}

/** Fades the whole graphic out over its last frames. */
function exitOpacity(frame: number, length: number, frames = 8) {
  return clamp01((length - frame) / frames);
}

/**
 * Graphics behind the speaker sit big, at head height, so the words show
 * either side of the head (the cut-out covers the middle).
 */
function behindBand(portrait: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top: portrait ? "20%" : "14%",
    height: portrait ? "30%" : "46%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  };
}

// ---------- story: pictures in 3D space, one moving camera ----------

function Story({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const images = React.useContext(ImagesContext);
  const scenes = g.scenes ?? [];
  const length = g.to - g.from;
  // Scene starts relative to the story.
  const starts = scenes.map((sc) => Math.max(0, sc.from - g.from));
  const cam = storyCamera(starts, frame);
  const speed = Math.abs(storyCamera(starts, frame + 2) - cam) / 2;
  const current = Math.min(scenes.length - 1, Math.max(0, Math.round(cam)));

  // Each scene's card: alternating left and right, further away each time,
  // turned a little toward the path.
  const cardW = width * (portrait ? 0.8 : 0.62);
  const cardH = (cardW * height) / width;
  const place = (i: number) => ({
    x: i === 0 ? 0 : (i % 2 ? 1 : -1) * width * 0.62,
    y: (i % 2 ? -1 : 1) * height * 0.03,
    z: -i * width * 1.5,
    r: i === 0 ? 0 : (i % 2 ? -1 : 1) * 22,
  });
  // The camera between two scenes' places, plus a slow constant push in.
  const a = place(Math.floor(cam));
  const b = place(Math.min(scenes.length - 1, Math.floor(cam) + 1));
  const t = cam - Math.floor(cam);
  const mix = (p: number, q: number) => p + (q - p) * t;
  const push = frame * unit * 0.06;
  const world =
    `translateZ(${push}px) rotateY(${-mix(a.r, b.r)}deg) ` +
    `translate3d(${-mix(a.x, b.x)}px, ${-mix(a.y, b.y)}px, ${-mix(a.z, b.z)}px)`;

  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(easeOut(frame / 8), exitOpacity(frame, length)),
        background: `radial-gradient(ellipse at 50% 40%, ${theme.secondary} 0%, ${theme.main} 70%)`,
        fontFamily: SANS,
        color: theme.text,
        overflow: "hidden",
      }}
    >
      {/* Blur on fast moves sells the camera's speed. */}
      <AbsoluteFill
        style={{
          perspective: width * 1.1,
          filter: speed > 0.02 ? `blur(${Math.min(unit * 1.6, speed * unit * 9)}px)` : undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transformStyle: "preserve-3d",
            transform: world,
          }}
        >
          {scenes.map((sc, i) => {
            const p = place(i);
            const url = sc.image ? images[sc.image] : undefined;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  width: cardW,
                  height: cardH,
                  left: -cardW / 2,
                  top: -cardH / 2,
                  transform: `translate3d(${p.x}px, ${p.y}px, ${p.z}px) rotateY(${p.r}deg)`,
                  borderRadius: unit * 3,
                  overflow: "hidden",
                  background: `linear-gradient(160deg, ${theme.secondary}, ${theme.main})`,
                  boxShadow: `0 ${unit * 3}px ${unit * 10}px rgba(0,0,0,0.55), 0 0 ${unit * 4}px ${theme.glow}`,
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {url && (
                  <Img
                    src={url}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                )}
                {/* Darker toward the bottom, where the words go. */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.25) 38%, transparent 60%)",
                  }}
                />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* The current scene's words, flat on top, with a line drawing on. */}
      {scenes[current] && (
        <SceneWords
          key={current}
          text={scenes[current].text}
          emphasis={scenes[current].emphasis}
          frame={frame - starts[current]}
          theme={theme}
          unit={unit}
          portrait={portrait}
        />
      )}
    </AbsoluteFill>
  );
}

function SceneWords({
  text,
  emphasis,
  frame,
  theme,
  unit,
  portrait,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  theme: MotionTheme;
  unit: number;
  portrait: boolean;
}) {
  const words = splitWords(text, emphasis);
  const size = unit * (portrait ? 6 : 4.8);
  const line = easeOut((frame - 6) / 16);
  return (
    <div
      style={{
        position: "absolute",
        left: unit * 8,
        right: unit * 8,
        bottom: portrait ? "18%" : "12%",
        textAlign: "center",
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.15,
      }}
    >
      {words.map(({ w, special }, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            marginRight: size * 0.26,
            ...pop(frame, 4 + i * 3, unit),
            ...(special
              ? {
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  fontWeight: 400,
                  fontSize: size * 1.2,
                  color: theme.accent,
                  textShadow: `0 0 ${unit * 2.4}px ${theme.glow}`,
                }
              : { textShadow: "0 2px 14px rgba(0,0,0,0.6)" }),
          }}
        >
          {w}
        </span>
      ))}
      <div
        style={{
          margin: `${unit * 2.2}px auto 0`,
          height: unit * 0.6,
          width: `${Math.round(line * 46)}%`,
          borderRadius: unit,
          background: theme.accent,
          boxShadow: `0 0 ${unit * 2}px ${theme.glow}`,
        }}
      />
    </div>
  );
}

function useUnit() {
  const { width, height } = useVideoConfig();
  return { unit: Math.min(width, height) / 100, portrait: height > width, width, height };
}

// ---------- shared pieces ----------

function Glass({
  theme,
  unit,
  style,
  children,
}: {
  theme: MotionTheme;
  unit: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: `linear-gradient(160deg, ${theme.secondary} 0%, ${theme.main} 70%)`,
        border: `${Math.max(1, unit * 0.18)}px solid ${theme.glow}`,
        borderRadius: unit * 3.2,
        boxShadow: `0 0 ${unit * 4}px ${theme.glow}, inset 0 0 ${unit * 2}px rgba(255,255,255,0.04)`,
        padding: `${unit * 3}px ${unit * 3.6}px`,
        color: theme.text,
        fontFamily: SANS,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Where cards sit: the right side in landscape, the lower middle in portrait. */
function cardPlace(portrait: boolean, unit: number): React.CSSProperties {
  return portrait
    ? { position: "absolute", left: unit * 7, right: unit * 7, top: "52%" }
    : {
        position: "absolute",
        right: unit * 6,
        top: "50%",
        width: "38%",
        transform: "translateY(-50%)",
      };
}

/** Splits a line into words, marking the ones that are the special word. */
function splitWords(text: string, emphasis: string | null) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!emphasis) return words.map((w) => ({ w, special: false }));
  const em = emphasis.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}%$]/gu, ""));
  const target = em.map((e) => e.replace(/[^\p{L}\p{N}%$]/gu, ""));
  let at = -1;
  for (let i = 0; i + target.length <= lower.length; i++) {
    if (target.every((t, j) => lower[i + j] === t)) {
      at = i;
      break;
    }
  }
  return words.map((w, i) => ({ w, special: at >= 0 && i >= at && i < at + target.length }));
}

// ---------- the graphics ----------

function KeyLine({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const words = splitWords(g.text, g.emphasis);
  // Behind the speaker: twice the size, at head height.
  const size = unit * (portrait ? 6.4 : 5.2) * (g.behind ? 2 : 1);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from) }}>
      {/* Darker, softer bottom so the words read over any footage (behind
          the speaker, the room is darkened instead). */}
      {!g.behind && (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 32%, transparent 58%)",
            opacity: easeOut(frame / 10),
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          ...(g.behind
            ? { left: unit * 3, right: unit * 3, top: portrait ? "22%" : "14%" }
            : { left: unit * 7, right: unit * 7, bottom: portrait ? "24%" : "13%" }),
          textAlign: "center",
          fontFamily: SANS,
          fontWeight: g.behind ? 800 : 600,
          fontSize: size,
          lineHeight: g.behind ? 1.02 : 1.18,
          color: theme.text,
          letterSpacing: g.behind ? "-0.03em" : "-0.01em",
        }}
      >
        {words.map(({ w, special }, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: size * 0.28,
              ...pop(frame, i * 3, unit),
              ...(special
                ? {
                    fontFamily: SERIF,
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: size * 1.22,
                    color: theme.accent,
                    textShadow: `0 0 ${unit * 2.4}px ${theme.glow}`,
                  }
                : { textShadow: "0 2px 12px rgba(0,0,0,0.5)" }),
            }}
          >
            {w}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function Counter({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const n = g.number ?? { value: 0, prefix: "", suffix: "" };
  const decimals = Number.isInteger(n.value)
    ? 0
    : Math.min(2, String(n.value).split(".")[1]?.length ?? 0);
  const shown = n.value * easeOut((frame - 4) / 26);
  const value = `${n.prefix}${shown.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${n.suffix}`;
  if (g.behind) {
    // Behind the speaker: the caption, then a huge number at head height.
    return (
      <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from), fontFamily: SANS }}>
        <div style={behindBand(portrait)}>
          {g.text && (
            <div
              style={{
                fontSize: unit * (portrait ? 4.4 : 3.6),
                fontWeight: 600,
                color: theme.text,
                textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                ...pop(frame, 8, unit),
              }}
            >
              {g.text}
            </div>
          )}
          <div
            style={{
              fontWeight: 800,
              fontSize: unit * (portrait ? 30 : 24),
              lineHeight: 1,
              color: theme.accent,
              textShadow: `0 0 ${unit * 4}px ${theme.glow}`,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.04em",
              ...pop(frame, 0, unit),
            }}
          >
            {value}
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from) }}>
      <div style={{ ...cardPlace(portrait, unit) }}>
        <Glass theme={theme} unit={unit} style={{ textAlign: "center", ...pop(frame, 0, unit) }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: unit * (portrait ? 15 : 12),
              lineHeight: 1,
              color: theme.accent,
              textShadow: `0 0 ${unit * 3}px ${theme.glow}`,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.03em",
            }}
          >
            {value}
          </div>
          {g.text && (
            <div
              style={{
                marginTop: unit * 1.6,
                fontSize: unit * 3.2,
                color: theme.muted,
                ...pop(frame, 8, unit),
              }}
            >
              {g.text}
            </div>
          )}
        </Glass>
      </div>
    </AbsoluteFill>
  );
}

function List({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  // Items arrive one by one over the first two thirds of the graphic.
  const step = g.items.length > 1 ? Math.max(6, (length * 0.66) / g.items.length) : 0;
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length) }}>
      <div
        style={
          portrait
            ? { position: "absolute", left: unit * 7, right: unit * 7, top: "48%" }
            : {
                position: "absolute",
                left: unit * 6,
                top: "50%",
                width: "40%",
                transform: "translateY(-50%)",
              }
        }
      >
        {g.text && (
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 600,
              fontSize: unit * 3.4,
              color: theme.muted,
              marginBottom: unit * 1.8,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              ...pop(frame, 0, unit),
            }}
          >
            {g.text}
          </div>
        )}
        {g.items.map((item, i) => (
          <Glass
            key={i}
            theme={theme}
            unit={unit}
            style={{
              display: "flex",
              alignItems: "center",
              gap: unit * 2,
              // As wide as the item, so short items stay clear of the speaker.
              width: "fit-content",
              minWidth: portrait ? "62%" : unit * 20,
              maxWidth: "100%",
              padding: `${unit * 1.8}px ${unit * 2.8}px`,
              marginBottom: unit * 1.4,
              fontSize: unit * (portrait ? 4.6 : 3.8),
              fontWeight: 600,
              ...pop(frame, Math.round(i * step), unit),
            }}
          >
            <span
              style={{
                width: unit * 1.4,
                height: unit * 1.4,
                borderRadius: "50%",
                background: theme.accent,
                boxShadow: `0 0 ${unit * 1.6}px ${theme.glow}`,
                flexShrink: 0,
              }}
            />
            {item}
          </Glass>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function Card({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const titleWords = splitWords(g.text, g.emphasis);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from) }}>
      <div style={cardPlace(portrait, unit)}>
        <Glass theme={theme} unit={unit} style={pop(frame, 0, unit, 16)}>
          <div
            style={{ fontSize: unit * (portrait ? 5.6 : 4.6), fontWeight: 700, lineHeight: 1.15 }}
          >
            {titleWords.map(({ w, special }, i) => (
              <span
                key={i}
                style={
                  special
                    ? {
                        fontFamily: SERIF,
                        fontStyle: "italic",
                        fontWeight: 400,
                        fontSize: "1.18em",
                        color: theme.accent,
                        textShadow: `0 0 ${unit * 1.8}px ${theme.glow}`,
                      }
                    : undefined
                }
              >
                {w}{" "}
              </span>
            ))}
          </div>
          {g.items.map((line, i) => (
            <div
              key={i}
              style={{
                marginTop: unit * 1.4,
                fontSize: unit * 3.2,
                color: theme.muted,
                ...pop(frame, 8 + i * 5, unit),
              }}
            >
              {line}
            </div>
          ))}
        </Glass>
      </div>
    </AbsoluteFill>
  );
}

function Compare({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  const [a, b] = [g.items[0] ?? "", g.items[1] ?? ""];
  const second = Math.max(10, Math.round(length * 0.4));
  const side = (text: string, delay: number, accent: boolean) => (
    <Glass
      theme={theme}
      unit={unit}
      style={{
        flex: 1,
        textAlign: "center",
        fontSize: unit * (portrait ? 5 : 4.2),
        fontWeight: 700,
        ...(accent ? { borderColor: theme.accent } : {}),
        ...pop(frame, delay, unit, 16),
      }}
    >
      {text}
    </Glass>
  );
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, length) }}>
      <div
        style={{
          position: "absolute",
          left: unit * 6,
          right: unit * 6,
          top: portrait ? "52%" : "60%",
          display: "flex",
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          gap: unit * 2.4,
        }}
      >
        {side(a, 0, false)}
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: unit * 5,
            color: theme.accent,
            textShadow: `0 0 ${unit * 2}px ${theme.glow}`,
            ...pop(frame, second - 4, unit),
          }}
        >
          vs
        </div>
        {side(b, second, true)}
      </div>
      {g.text && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: portrait ? "42%" : "48%",
            textAlign: "center",
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: unit * 3.4,
            color: theme.text,
            textShadow: "0 2px 12px rgba(0,0,0,0.6)",
            ...pop(frame, 0, unit),
          }}
        >
          {g.text}
        </div>
      )}
    </AbsoluteFill>
  );
}

function Chapter({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const length = g.to - g.from;
  const ch = g.chapter ?? { index: 1, count: 1 };
  const fill = (ch.index - 1 + easeOut((frame - 6) / 20)) / ch.count;
  // The title types in, letter by letter.
  const shownChars = Math.floor(g.text.length * clamp01((frame - 4) / 18));
  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(easeOut(frame / 8), exitOpacity(frame, length)),
        background: `radial-gradient(ellipse at 50% 40%, ${theme.secondary} 0%, ${theme.main} 65%)`,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: SANS,
        color: theme.text,
      }}
    >
      {/* A faint grid, like the studied UI backgrounds. */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)`,
          backgroundSize: `${unit * 8}px ${unit * 8}px`,
        }}
      />
      {/* Behind the speaker: a bigger title at head height. */}
      <div
        style={
          g.behind
            ? { ...behindBand(portrait), left: "4%", right: "4%" }
            : { position: "relative", width: "72%", textAlign: "center" }
        }
      >
        <div
          style={{
            fontSize: unit * 2.8,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: theme.muted,
            ...pop(frame, 0, unit),
          }}
        >
          Part {ch.index} of {ch.count}
        </div>
        <div
          style={{
            marginTop: unit * 2,
            fontSize: unit * (g.behind ? 12 : 7.5),
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          {g.text.slice(0, shownChars)}
          <span style={{ opacity: shownChars < g.text.length ? 1 : 0, color: theme.accent }}>
            |
          </span>
        </div>
        <div
          style={{
            margin: `${unit * 4}px auto 0`,
            height: unit * 1.1,
            width: "70%",
            borderRadius: unit,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.round(fill * 100)}%`,
              background: theme.accent,
              boxShadow: `0 0 ${unit * 2}px ${theme.glow}`,
              borderRadius: unit,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Label({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from) }}>
      <div
        style={{
          position: "absolute",
          left: unit * 4,
          bottom: portrait ? "9%" : unit * 4,
          display: "flex",
          alignItems: "center",
          gap: unit * 1.2,
          padding: `${unit * 0.9}px ${unit * 2}px`,
          borderRadius: unit * 3,
          background: "rgba(0,0,0,0.45)",
          border: `1px solid ${theme.glow}`,
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: unit * 2.6,
          color: theme.text,
          ...pop(frame, 0, unit),
        }}
      >
        <span
          style={{ width: unit, height: unit, borderRadius: "50%", background: theme.accent }}
        />
        {g.text}
      </div>
    </AbsoluteFill>
  );
}

const CTA_TEXT = {
  like: "Like",
  subscribe: "Subscribe",
  comment: "Comment",
  link: "Link below",
} as const;
const CTA_ICON = { like: ThumbsUp, subscribe: Bell, comment: MessageCircle, link: Link2 } as const;

function Cta({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait } = useUnit();
  const kind = g.cta ?? "like";
  // The pointer glides in and clicks the button.
  const arrive = easeOut((frame - 6) / 14);
  const click = frame >= 22 && frame < 30;
  const done = frame >= 26;
  const Icon = CTA_ICON[kind];
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(frame, g.to - g.from) }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          // Above the captions (which sit about 20% up from the bottom).
          bottom: portrait ? "32%" : "31%",
          transform: `translateX(-50%) scale(${click ? 0.94 : 1})`,
          display: "flex",
          alignItems: "center",
          gap: unit * 1.6,
          padding: `${unit * 1.6}px ${unit * 3.4}px`,
          borderRadius: unit * 5,
          background: done ? theme.accent : "rgba(20,20,24,0.85)",
          border: `1px solid ${done ? theme.accent : "rgba(255,255,255,0.18)"}`,
          boxShadow: done ? `0 0 ${unit * 3}px ${theme.glow}` : "0 6px 24px rgba(0,0,0,0.5)",
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: unit * 3.6,
          color: done ? theme.main : theme.text,
          ...pop(frame, 0, unit),
        }}
      >
        <Icon size={unit * 3.8} strokeWidth={2.4} />
        {g.text || CTA_TEXT[kind]}
        <span
          style={{
            position: "absolute",
            right: -unit * 2 + (1 - arrive) * -unit * 14,
            bottom: -unit * 3 + (1 - arrive) * -unit * 10,
            opacity: arrive,
            transform: click ? "scale(0.85)" : undefined,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            color: "#FFFFFF",
          }}
        >
          <MousePointer2 size={unit * 5} fill="#FFFFFF" strokeWidth={1.5} color="#111111" />
        </span>
      </div>
    </AbsoluteFill>
  );
}

const DRAW: Record<
  PlacedGraphic["type"],
  (p: { g: PlacedGraphic; theme: MotionTheme }) => React.ReactElement
> = {
  keyline: KeyLine,
  counter: Counter,
  list: List,
  card: Card,
  compare: Compare,
  story: Story,
  chapter: Chapter,
  label: Label,
  cta: Cta,
};

/** Every graphic, each in its own stretch of the timeline. */
export function MotionGraphics({ graphics, theme, images }: MotionGraphicsProps) {
  // Graphics are placed in 30 fps frames; at a lower rate, scale them.
  const { fps } = useVideoConfig();
  const scale = fps / BASE_FPS;
  return (
    <ImagesContext.Provider value={images ?? {}}>
      <AbsoluteFill>
        {graphics.map((g) => {
          const Draw = DRAW[g.type];
          return (
            <Sequence
              key={g.id}
              from={Math.round(g.from * scale)}
              durationInFrames={Math.max(1, Math.round(g.to * scale) - Math.round(g.from * scale))}
              layout="none"
            >
              <Draw g={g} theme={theme} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </ImagesContext.Provider>
  );
}
