// Shared pieces of the Motion Explainer drawings: the 15 fps step, pop-ins,
// fades, sizes, the special word, and the pictures' links. Used by the glass
// look (MotionGraphics) and the paper look (PaperGraphics). No app imports:
// the worker bundles src/motion on its own.

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

/** Pictures' links, for the graphics that show pictures. */
export const ImagesContext = React.createContext<Record<string, string>>({});
/** The brand kit logo's link, if there's a logo. */
export const LogoContext = React.createContext<string | null>(null);

// ---------- motion helpers ----------

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/** Timings below are in frames at 30 fps. */
export const BASE_FPS = 30;

/**
 * Graphics move at 15 fps (every other frame at 30), like the studied edits.
 * Returns the frame in 30 fps terms, whatever rate the composition runs at:
 * the export draws at 15 fps, since every other frame would be the same.
 */
export function useStepFrame() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (fps >= BASE_FPS) return Math.floor(frame / 2) * 2;
  return Math.floor((frame * BASE_FPS) / fps / 2) * 2;
}

/** A pop-in that starts `delay` frames in: rise, unblur, fade in. */
export function pop(frame: number, delay: number, unit: number, frames = 14): React.CSSProperties {
  const p = easeOut((frame - delay) / frames);
  return {
    opacity: p,
    transform: `translateY(${(1 - p) * unit * 2.4}px)`,
    filter: p < 1 ? `blur(${(1 - p) * unit * 0.9}px)` : undefined,
  };
}

/** Fades the whole graphic out over its last frames. */
export function exitOpacity(frame: number, length: number, frames = 8) {
  return clamp01((length - frame) / frames);
}

/**
 * Graphics behind the speaker sit big, around head height, so the words show
 * above and either side of the head (the cut-out covers the middle).
 */
export function behindBand(portrait: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    // Tall videos: level with the top of the head, so the head covers less.
    top: portrait ? "9%" : "14%",
    height: portrait ? "28%" : "46%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  };
}

export function useUnit() {
  const { width, height } = useVideoConfig();
  return { unit: Math.min(width, height) / 100, portrait: height > width, width, height };
}

/** Splits a line into words, marking the ones that are the special word. */
export function splitWords(text: string, emphasis: string | null) {
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

/** A steady pseudo-random number in 0-1 for an item and a property. */
export const rand = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** The accent made dark enough to read on white paper (ink, ticks, numbers). */
export function inkAccent(theme: { accent: string }): string {
  const m = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(theme.accent);
  return m ? `hsl(${m[1]}, ${Math.min(80, Number(m[2]))}%, 40%)` : "#B3261E";
}
