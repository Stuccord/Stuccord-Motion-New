// Captions, the AI hook and the brand logo drawn over the live timeline
// preview, sized to the frame like the export burns them in
// (render-worker/server.js): captions in the brand kit's font, colours, size
// and position (by default the lower third, white with a dark outline, the
// spoken word in yellow); the hook at the top, on a box, for the first 3
// seconds; the logo in its corner.

import React from "react";
import { captionAt, type TimelineWord } from "@/lib/captions";
import {
  CAPTION_SIZE,
  DEFAULT_KIT,
  fontCss,
  useBrandFonts,
  withAlpha,
  type BrandKit,
} from "@/lib/brand-kit";

const HOOK_MS = 3000;

export function PreviewOverlay({
  timeMs,
  phrases,
  hook,
  kit = DEFAULT_KIT,
  logoUrl = null,
}: {
  timeMs: number;
  /** Caption phrases on the timeline; empty when captions are off. */
  phrases: TimelineWord[][];
  /** The hook from the last cloud render, if any. */
  hook: string | null;
  /** The account's brand kit. */
  kit?: BrandKit;
  /** A link to the brand logo, when the kit has one. */
  logoUrl?: string | null;
}) {
  useBrandFonts();
  const caption = phrases.length ? captionAt(phrases, timeMs) : null;
  const showHook = !!hook && timeMs < HOOK_MS;
  const logo = kit.logo && logoUrl ? kit.logo : null;
  if (!caption && !showHook && !logo) return null;
  const fontFamily = fontCss(kit.font) || undefined;
  const o = kit.outlineColor;
  // Captions' place: like the export's margins (20% of the height; at the
  // top 24%, to clear the hook).
  const captionPlace: React.CSSProperties =
    kit.position === "top"
      ? { top: "24cqh" }
      : kit.position === "middle"
        ? { top: "50%", transform: "translateY(-50%)" }
        : { bottom: "20cqh" };
  return (
    // Sizes in container units, so they follow the frame like the export's
    // (which are fractions of the video's width and height).
    <div
      className="absolute inset-0 z-10 pointer-events-none select-none"
      style={{ containerType: "size" }}
    >
      {logo && (
        <img
          src={logoUrl!}
          alt=""
          className="absolute"
          style={{
            width: `${logo.width * 100}cqw`,
            opacity: logo.opacity,
            [logo.corner.startsWith("t") ? "top" : "bottom"]: "4cqmin",
            [logo.corner.endsWith("l") ? "left" : "right"]: "4cqmin",
          }}
        />
      )}
      {showHook && (
        <div className="absolute inset-x-0 flex justify-center px-[6cqw]" style={{ top: "8cqh" }}>
          <span
            // One line, as the export draws it.
            className="font-semibold text-center leading-tight whitespace-nowrap"
            style={{
              fontSize: "5.5cqh",
              padding: "1.2cqh 2.2cqh",
              color: kit.textColor,
              background: withAlpha(kit.hookBoxColor, 0.55),
              fontFamily,
            }}
          >
            {hook}
          </span>
        </div>
      )}
      {caption && (
        <div
          className="absolute inset-x-0 flex justify-center text-center px-[8cqw]"
          style={captionPlace}
        >
          <p
            className="font-extrabold leading-tight"
            style={{
              fontSize: `${CAPTION_SIZE[kit.size] * 100}cqmin`,
              color: kit.textColor,
              fontFamily,
              // The export's outline around each letter.
              textShadow: `0 0 0.6cqmin ${o}, 0.15cqmin 0.15cqmin 0 ${o}, -0.15cqmin 0.15cqmin 0 ${o}, 0.15cqmin -0.15cqmin 0 ${o}, -0.15cqmin -0.15cqmin 0 ${o}`,
            }}
          >
            {caption.words.map((w, i) => (
              <React.Fragment key={w.key}>
                {i > 0 && " "}
                <span style={i === caption.active ? { color: kit.highlightColor } : undefined}>
                  {w.text}
                </span>
              </React.Fragment>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
