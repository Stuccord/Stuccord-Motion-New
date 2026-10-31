// The Motion Explainer graphics drawn over the live preview: the same
// Remotion composition the export renders (stage 3), shown at the frame
// under the playhead with @remotion/player's Thumbnail. Drawn twice: the
// graphics behind the speaker (under their cut-out) and the rest in front.

import { useEffect, useMemo } from "react";
import { Thumbnail } from "@remotion/player";
import { cn } from "@/lib/utils";
import { MotionGraphics, type MotionGraphicsProps } from "@/motion/MotionGraphics";
import { MOTION_FONTS, type MotionTheme } from "@/motion/theme";
import { MOTION_FPS, frameSize, type PlacedGraphic } from "@/motion/timing";

let fontsAdded = false;
/** Loads the graphics' fonts from /fonts once. */
function useMotionFonts() {
  useEffect(() => {
    if (fontsAdded || typeof document === "undefined" || typeof FontFace === "undefined") return;
    fontsAdded = true;
    for (const f of MOTION_FONTS) {
      const face = new FontFace(f.family, `url(/fonts/${f.file})`, {
        style: f.style,
        weight: f.weight,
      });
      face
        .load()
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => {
          // The fallback fonts still show the graphics.
        });
    }
  }, []);
}

export function MotionOverlay({
  timeMs,
  graphics,
  theme,
  aspect,
  layer,
}: {
  timeMs: number;
  graphics: PlacedGraphic[];
  theme: MotionTheme;
  aspect: string;
  /** Only the graphics behind the speaker, or only the others. */
  layer: "behind" | "front";
}) {
  useMotionFonts();
  const { width, height } = frameSize(aspect);
  const frame = Math.max(0, Math.round((timeMs / 1000) * MOTION_FPS));
  const active = graphics.filter(
    (g) => frame >= g.from && frame < g.to && g.behind === (layer === "behind"),
  );
  // Only what's on screen is drawn; the props stay the same object while
  // the same graphics are showing.
  const activeKey = active.map((g) => g.id).join(",");
  const inputProps = useMemo<MotionGraphicsProps>(
    () => ({ graphics: active, theme }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeKey, graphics, theme],
  );
  if (active.length === 0) return null;
  const durationInFrames = Math.max(frame + 1, ...active.map((g) => g.to));
  return (
    <div
      className={cn(
        "absolute inset-0 pointer-events-none",
        // Behind graphics share a level with the cut-out, which comes after them.
        layer === "behind" ? "z-[8]" : "z-[9]",
      )}
      data-motion-overlay={layer}
    >
      <Thumbnail
        component={MotionGraphics}
        inputProps={inputProps}
        compositionWidth={width}
        compositionHeight={height}
        durationInFrames={durationInFrames}
        fps={MOTION_FPS}
        frameToDisplay={frame}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      />
    </div>
  );
}
