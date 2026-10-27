// Captions and the AI hook drawn over the live timeline preview, sized to the
// frame like the export burns them in (render-worker/server.js): captions in
// the lower third, white with a dark outline, the spoken word in yellow; the
// hook at the top, on a dark box, for the first 3 seconds.

import React from "react";
import { captionAt, type TimelineWord } from "@/lib/captions";

const HOOK_MS = 3000;

export function PreviewOverlay({
  timeMs,
  phrases,
  hook,
}: {
  timeMs: number;
  /** Caption phrases on the timeline; empty when captions are off. */
  phrases: TimelineWord[][];
  /** The hook from the last cloud render, if any. */
  hook: string | null;
}) {
  const caption = phrases.length ? captionAt(phrases, timeMs) : null;
  const showHook = !!hook && timeMs < HOOK_MS;
  if (!caption && !showHook) return null;
  return (
    // Sizes in container units, so they follow the frame like the export's
    // (which are fractions of the video's width and height).
    <div
      className="absolute inset-0 z-10 pointer-events-none select-none"
      style={{ containerType: "size" }}
    >
      {showHook && (
        <div className="absolute inset-x-0 flex justify-center px-[6cqw]" style={{ top: "8cqh" }}>
          <span
            className="bg-black/55 text-white font-semibold text-center leading-tight"
            style={{ fontSize: "5.5cqh", padding: "1.2cqh 2.2cqh" }}
          >
            {hook}
          </span>
        </div>
      )}
      {caption && (
        <div
          className="absolute inset-x-0 flex justify-center text-center px-[8cqw]"
          style={{ bottom: "20cqh" }}
        >
          <p
            className="font-extrabold text-white leading-tight"
            style={{
              fontSize: "7.5cqmin",
              // The export's dark outline around each letter.
              textShadow:
                "0 0 0.6cqmin #000, 0.15cqmin 0.15cqmin 0 #000, -0.15cqmin 0.15cqmin 0 #000, 0.15cqmin -0.15cqmin 0 #000, -0.15cqmin -0.15cqmin 0 #000",
            }}
          >
            {caption.words.map((w, i) => (
              <React.Fragment key={w.key}>
                {i > 0 && " "}
                <span style={i === caption.active ? { color: "#FFD700" } : undefined}>
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
