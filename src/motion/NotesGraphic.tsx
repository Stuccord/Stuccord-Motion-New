// The Notes split screen (stage 10b): the speaker moves to one half (the
// footage shift is in timing.ts splitShift and the worker's splitFilters)
// and an iPad-style note page on the other half fills up as they talk -
// each line written on its word, with a simple sketch drawn on beside it.
// From the studied "one-person business" video (docs/style-research/07).
// The same page in the glass and the paper look.

import { AbsoluteFill } from "remotion";
import { SANS, SERIF, type MotionTheme } from "@/motion/theme";
import { SKETCH_PATHS } from "@/motion/sketches";
import type { PlacedGraphic } from "@/motion/timing";
import { clamp01, easeOut, inkAccent, useStepFrame, useUnit } from "@/motion/kit";

const PAGE = "#FCFBF7";
const INK = "#1E1D22";

/** A sketch drawn on stroke by stroke as `on` goes 0 to 1. */
function Sketch({ id, size, color, on }: { id: string; size: number; color: string; on: number }) {
  const paths = SKETCH_PATHS[id as keyof typeof SKETCH_PATHS];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ flexShrink: 0, overflow: "visible" }}
    >
      {paths.map((d, i) => {
        // Each stroke draws in turn.
        const part = clamp01(on * paths.length - i);
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - part}
          />
        );
      })}
    </svg>
  );
}

export function NotesGraphic({ g, theme }: { g: PlacedGraphic; theme: MotionTheme }) {
  const frame = useStepFrame();
  const { unit, portrait, width, height } = useUnit();
  const length = g.to - g.from;
  const lines = g.lines ?? [];
  const accent = inkAccent(theme);

  // The page's half: the right of a wide frame, the bottom of a tall one.
  const half = portrait
    ? { left: 0, top: height / 2, w: width, h: height / 2 }
    : { left: width / 2, top: 0, w: width / 2, h: height };
  // It slides in from its side and back out at the end.
  const p = Math.min(easeOut(frame / 10), easeOut((length - frame) / 8));
  const slide = portrait
    ? `translateY(${(1 - p) * half.h}px)`
    : `translateX(${(1 - p) * half.w}px)`;

  const bezel = unit * 1.4;
  const margin = unit * 2.4;
  const pad = unit * 4;
  const pageH = half.h - margin * 2 - bezel * 2;
  const titleH = g.text ? unit * (portrait ? 9 : 10) : unit * 2;
  const rowH = Math.min(
    unit * (portrait ? 12.5 : 11),
    (pageH - titleH - pad * 1.5) / Math.max(4, lines.length),
  );
  const textSize = rowH * (portrait ? 0.5 : 0.46);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: half.left + margin,
          top: half.top + margin,
          width: half.w - margin * 2,
          height: half.h - margin * 2,
          transform: slide,
          borderRadius: unit * 3.6,
          background: "#121214",
          padding: bezel,
          boxSizing: "border-box",
          boxShadow: `0 ${unit * 2}px ${unit * 8}px rgba(0,0,0,0.55), 0 0 ${unit * 4}px ${theme.glow}`,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: unit * 2.4,
            background: PAGE,
            overflow: "hidden",
            color: INK,
            fontFamily: SANS,
          }}
        >
          {/* A note app's top bar. */}
          <div
            style={{
              height: unit * 3.2,
              borderBottom: "1px solid rgba(0,0,0,0.07)",
              display: "flex",
              alignItems: "center",
              gap: unit * 0.8,
              paddingLeft: pad * 0.6,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: unit * 0.9,
                  height: unit * 0.9,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.12)",
                }}
              />
            ))}
          </div>
          {g.text && (
            <div style={{ position: "absolute", left: pad, right: pad, top: unit * 5.4 }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: unit * (portrait ? 4.6 : 4.8),
                  lineHeight: 1.1,
                  clipPath: `inset(0 ${(1 - easeOut((frame - 6) / 12)) * 100}% 0 0)`,
                }}
              >
                {g.text}
              </div>
              <svg
                width="70%"
                height={unit * 1.6}
                style={{ display: "block", overflow: "visible" }}
              >
                <path
                  d={`M0 ${unit * 0.8} Q ${unit * 22} ${unit * 1.6} ${unit * 60} ${unit * 0.4}`}
                  stroke={accent}
                  strokeWidth={unit * 0.45}
                  fill="none"
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - easeOut((frame - 14) / 10)}
                />
              </svg>
            </div>
          )}
          {lines.map((l, i) => {
            const local = frame - (l.from - g.from);
            const write = easeOut(local / Math.max(8, l.text.length * 0.6));
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: pad,
                  right: pad,
                  top: unit * 3.2 + titleH + pad * 0.6 + i * rowH,
                  height: rowH,
                  display: "flex",
                  alignItems: "center",
                  gap: unit * 2,
                  opacity: local >= 0 ? 1 : 0,
                }}
              >
                <span
                  style={{
                    width: unit * 1.1,
                    height: unit * 1.1,
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                    transform: `scale(${easeOut(local / 4)})`,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontFamily: SERIF,
                    fontStyle: "italic",
                    fontSize: textSize,
                    lineHeight: 1.05,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    clipPath: `inset(0 ${(1 - write) * 100}% 0 0)`,
                  }}
                >
                  {l.text}
                </span>
                {l.sketch && (
                  <Sketch
                    id={l.sketch}
                    size={rowH * 0.86}
                    color={accent}
                    on={easeOut((local - 4) / 14)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
