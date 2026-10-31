// The Motion Explainer graphics as a Remotion project, for the export.
// It draws the app's own composition (src/motion/MotionGraphics.tsx), so the
// export looks exactly like the editor's preview. Bundled by
// build-graphics.mjs; rendered by motion.js.

import React, { useEffect, useState } from "react";
import { Composition, continueRender, delayRender, registerRoot, staticFile } from "remotion";
import { MotionGraphics, type MotionGraphicsProps } from "../../src/motion/MotionGraphics";
import { MOTION_FONTS, themeFromAccent } from "../../src/motion/theme";

type Props = MotionGraphicsProps & { width: number; height: number; durationInFrames: number };

/** Draws the graphics once their fonts are in (the bundle's public folder is the worker's fonts). */
function WithFonts(props: Props) {
  const [handle] = useState(() => delayRender("Loading the graphics fonts"));
  useEffect(() => {
    Promise.all(
      MOTION_FONTS.map((f) =>
        new FontFace(f.family, `url(${staticFile(f.file)})`, { style: f.style, weight: f.weight })
          .load()
          .then((face) => document.fonts.add(face)),
      ),
    )
      .catch((e) => console.error("Graphics fonts didn't load", e))
      .finally(() => continueRender(handle));
  }, [handle]);
  return (
    <MotionGraphics
      graphics={props.graphics}
      theme={props.theme}
      images={props.images}
      logo={props.logo}
    />
  );
}

const DEFAULTS: Props = {
  graphics: [],
  theme: themeFromAccent(null),
  width: 1080,
  height: 1920,
  durationInFrames: 30,
};

function Root() {
  return (
    <Composition
      id="graphics"
      component={WithFonts}
      // Drawn at 15 fps: the graphics only change every other frame at 30.
      fps={15}
      width={DEFAULTS.width}
      height={DEFAULTS.height}
      durationInFrames={DEFAULTS.durationInFrames}
      defaultProps={DEFAULTS}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        durationInFrames: Math.max(1, Math.ceil(props.durationInFrames / 2)),
      })}
    />
  );
}

registerRoot(Root);
