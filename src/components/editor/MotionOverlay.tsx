// The Motion Explainer graphics drawn over the live preview: the same
// Remotion composition the export renders (stage 3), shown at the frame
// under the playhead with @remotion/player's Thumbnail.

import { useEffect, useMemo } from "react";
import { Thumbnail } from "@remotion/player";
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
}: {
  timeMs: number;
  graphics: PlacedGraphic[];
  theme: MotionTheme;
  aspect: string;
}) {
  useMotionFonts();
  const { width, height } = frameSize(aspect);
  const frame = Math.max(0, Math.round((timeMs / 1000) * MOTION_FPS));
  const active = graphics.filter((g) => frame >= g.from && frame < g.to);
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
    <div className="absolute inset-0 z-[9] pointer-events-none" data-motion-overlay>
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
