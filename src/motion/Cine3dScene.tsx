// The 3D Cinematic look's scenes: key lines, chapters and metaphors cut to a
// dark stage lit red from one side. A metaphor shows its photo-real object
// picture (made by the AI) with a slow 3D camera - a push-in that drifts
// and turns a little - soft focus toward the edges and a red rim glow, and
// its words big and glowing ("time is" small, "money" huge). Key lines and
// chapters (and a metaphor still without its picture) get the glowing words
// alone, over drifting specks of light. No app imports: the worker bundles
// src/motion on its own.

import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { SANS } from "@/motion/theme";
import type { PlacedGraphic } from "@/motion/timing";
import {
  ImagesContext,
  clamp01,
  easeInOut,
  easeOut,
  exitOpacity,
  rand,
  splitWords,
  useStepFrame,
  useUnit,
} from "@/motion/kit";

export const CINE_STAGE = "#070405";
export const CINE_RED = "#FF2A2A";
const WHITE = "#FFF6F2";
const GLOW = "0 0 0.35em rgba(255, 240, 235, 0.65), 0 0 1.1em rgba(255, 60, 50, 0.45)";
const RED_GLOW = "0 0 0.3em rgba(255, 90, 80, 0.9), 0 0 1em rgba(255, 30, 30, 0.6)";

/** The types the 3D Cinematic look draws as a scene. */
const CINE_SCENE_TYPES = new Set<PlacedGraphic["type"]>(["keyline", "chapter", "metaphor"]);

/** True when this graphic is drawn as a stage scene (not one behind the speaker). */
export const isCineScene = (g: PlacedGraphic) => CINE_SCENE_TYPES.has(g.type) && !g.behind;

/** The red light washing in from the upper right, and the dark edges. */
function Light({ frame, length }: { frame: number; length: number }) {
  // The light breathes a little and slides with the camera.
  const t = frame / Math.max(1, length);
  const x = 72 - 8 * t;
  const a = 0.5 + 0.08 * Math.sin(frame / 18);
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at ${x}% 30%, rgba(220, 30, 30, ${a}), transparent 70%)`,
          mixBlendMode: "screen",
        }}
      />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0, 0, 0, 0.85) 100%)" }}
      />
    </>
  );
}

/** Specks of light drifting slowly up through the beam. */
function Specks({ frame, width, height, unit }: { frame: number; width: number; height: number; unit: number }) {
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      {Array.from({ length: 26 }).map((_, i) => {
        const x = rand(i, 1) * width;
        const speed = 0.4 + rand(i, 2) * 0.9;
        const y = (((rand(i, 3) * height - frame * speed * unit * 0.12) % height) + height) % height;
        const r = unit * (0.12 + rand(i, 4) * 0.3);
        const blur = rand(i, 5) > 0.6 ? unit * 0.25 : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: rand(i, 6) > 0.5 ? "rgba(255, 120, 100, 0.8)" : "rgba(255, 235, 225, 0.7)",
              filter: blur ? `blur(${blur}px)` : undefined,
              opacity: 0.3 + 0.5 * rand(i, 7),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

/**
 * The object picture with the 3D camera: pushes in, drifts sideways and
 * turns a few degrees, a sharp middle over a soft-focus copy at the edges.
 */
function Object3D({ url, frame, length }: { url: string; frame: number; length: number }) {
  const t = easeInOut(frame / Math.max(1, length));
  const scale = 1.06 + 0.18 * t;
  const turn = -5 + 9 * t;
  const tilt = 2.5 - 3 * t;
  const driftX = -2 + 4 * t;
  const driftY = 1.5 - 2.5 * t;
  const camera: React.CSSProperties = {
    transform: `perspective(1400px) translate(${driftX}%, ${driftY}%) rotateY(${turn}deg) rotateX(${tilt}deg) scale(${scale})`,
    transformOrigin: "50% 50%",
  };
  const cover: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const sharpMask = "radial-gradient(ellipse 72% 62% at 50% 48%, #000 55%, transparent 100%)";
  return (
    <AbsoluteFill style={{ opacity: easeOut(frame / 10) }}>
      <AbsoluteFill style={camera}>
        {/* Soft focus everywhere, then the sharp middle on top. */}
        <Img src={url} style={{ ...cover, filter: "blur(8px) brightness(0.8)" }} />
        <AbsoluteFill style={{ WebkitMaskImage: sharpMask, maskImage: sharpMask }}>
          <Img src={url} style={cover} />
        </AbsoluteFill>
      </AbsoluteFill>
      {/* Deeper contrast and a red rim from the right. */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(255deg, rgba(255, 40, 30, 0.35) 0%, transparent 38%)",
          mixBlendMode: "screen",
        }}
      />
    </AbsoluteFill>
  );
}

/** The words: the line small and glowing, the key word huge and red-hot when it ends the line. */
function Words({
  text,
  emphasis,
  frame,
  delay,
  size,
}: {
  text: string;
  emphasis: string | null;
  frame: number;
  delay: number;
  size: number;
}) {
  const words = splitWords(text, emphasis);
  const keyLast = words.length > 0 && words[words.length - 1].special;
  const arrive = (d: number, big = false): React.CSSProperties => {
    const p = easeOut((frame - d) / (big ? 18 : 12));
    return {
      display: "inline-block",
      opacity: p,
      transform: `scale(${big ? 1.25 - 0.25 * p : 1}) translateY(${(1 - p) * size * 0.2}px)`,
      filter: p < 1 ? `blur(${(1 - p) * size * 0.08}px)` : undefined,
    };
  };
  if (!keyLast) {
    return (
      <div style={{ fontSize: size, fontWeight: 700, color: WHITE, textShadow: GLOW, lineHeight: 1.15 }}>
        {words.map((w, i) => (
          <span
            key={i}
            style={{
              ...arrive(delay + i * 3, w.special),
              marginRight: size * 0.24,
              ...(w.special ? { color: CINE_RED, textShadow: RED_GLOW } : {}),
            }}
          >
            {w.w}
          </span>
        ))}
      </div>
    );
  }
  const plain = words.filter((w) => !w.special).map((w) => w.w);
  const key = words.filter((w) => w.special).map((w) => w.w).join(" ");
  return (
    <div style={{ lineHeight: 1 }}>
      {plain.length > 0 && (
        <div style={{ fontSize: size * 0.7, fontWeight: 600, color: WHITE, textShadow: GLOW, marginBottom: size * 0.1 }}>
          {plain.map((w, i) => (
            <span key={i} style={{ ...arrive(delay + i * 3), marginRight: size * 0.18 }}>
              {w}
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          ...arrive(delay + plain.length * 3 + 8, true),
          fontSize: size * 2.1,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          color: WHITE,
          textShadow: GLOW,
        }}
      >
        {key}
      </div>
    </div>
  );
}

export function Cine3dScene({ g }: { g: PlacedGraphic }) {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const images = React.useContext(ImagesContext);
  const length = Math.max(1, g.to - g.from);
  const opacity = clamp01(frame / 5) * exitOpacity(frame, length, 8);
  const path = g.type === "metaphor" ? g.scenes?.[0]?.image : null;
  const url = path ? images[path] : undefined;
  const size = unit * (portrait ? 6.4 : 5);
  // Over a picture the words sit low; on the bare stage, in the middle.
  const top = url ? (portrait ? "76%" : "70%") : portrait ? "40%" : "36%";

  return (
    <AbsoluteFill style={{ background: CINE_STAGE, opacity, overflow: "hidden", fontFamily: SANS, fontSynthesis: "none" }}>
      {url ? (
        <Object3D url={url} frame={frame} length={length} />
      ) : (
        <Specks frame={frame} width={width} height={height} unit={unit} />
      )}
      <Light frame={frame} length={length} />
      {/* A dark band behind the words when they sit over the picture. */}
      {url && (
        <AbsoluteFill
          style={{ background: "linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.5) 25%, transparent 45%)" }}
        />
      )}
      <div style={{ position: "absolute", left: "7%", right: "7%", top, textAlign: "center" }}>
        {g.type === "chapter" && g.chapter && (
          <div
            style={{
              fontSize: unit * 2.4,
              fontWeight: 600,
              letterSpacing: "0.4em",
              color: CINE_RED,
              textShadow: RED_GLOW,
              marginBottom: unit * 2.5,
              opacity: easeOut((frame - 4) / 12),
            }}
          >
            {`CHAPTER ${String(g.chapter.index).padStart(2, "0")}`}
          </div>
        )}
        <Words
          text={g.text}
          emphasis={g.emphasis}
          frame={frame}
          delay={url ? 16 : 8}
          size={g.type === "chapter" ? size * 1.15 : size}
        />
      </div>
    </AbsoluteFill>
  );
}
