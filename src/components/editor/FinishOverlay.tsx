// A look's finish over the live preview, like the export adds it
// (render-worker/motion.js finishFilters): film grain and a vignette over
// the picture and graphics, then thin black bars, all under the captions.
// Also holds the SVG filter with the look's colour curves, which the
// picture's CSS filter points at (looks.ts gradeCss).

import { useMemo } from "react";
import { GRADE_FILTER_ID, barHeight, type LookFinish } from "@/motion/looks";
import { frameSize } from "@/motion/timing";

/** A tile of grey noise, made once. */
let noiseTile: string | null = null;
function grainTile(): string | null {
  if (noiseTile || typeof document === "undefined") return noiseTile;
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(size, size);
  // A steady pseudo-random pattern, so the tile is the same every time.
  let seed = 7;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 16807) % 2147483647;
    // About ±40 grey levels; at the opacity below that is the export's ±10 or so.
    const v = 128 + ((seed % 256) - 128) * 0.31;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noiseTile = canvas.toDataURL("image/png");
  return noiseTile;
}

export function FinishOverlay({
  finish,
  timeMs,
  aspect,
}: {
  finish: LookFinish;
  timeMs: number;
  /** The project's shape ("9:16"...), for the bars' height. */
  aspect: string;
}) {
  const curves = finish.grade?.curves;
  const tile = useMemo(() => (finish.grain > 0 ? grainTile() : null), [finish.grain]);
  const { width, height } = frameSize(aspect);
  const bar = finish.bars ? (barHeight(width, height) / height) * 100 : 0;
  // The grain moves every frame (24 times a second, like film).
  const step = Math.floor((timeMs / 1000) * 24);
  const jitter = (k: number) => ((step * (k === 0 ? 7919 : 104729)) % 160) - 80;
  if (!curves && !tile && !finish.vignette && !bar) return null;
  return (
    <div className="absolute inset-0 z-[9] pointer-events-none">
      {curves && (
        <svg width="0" height="0" className="absolute" aria-hidden>
          <filter id={GRADE_FILTER_ID} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="table" tableValues={curves.r.join(" ")} />
              <feFuncG type="table" tableValues={curves.g.join(" ")} />
              <feFuncB type="table" tableValues={curves.b.join(" ")} />
            </feComponentTransfer>
          </filter>
        </svg>
      )}
      {tile && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${tile})`,
            backgroundPosition: `${jitter(0)}px ${jitter(1)}px`,
            mixBlendMode: "overlay",
            opacity: finish.grain * 0.5,
          }}
        />
      )}
      {finish.vignette && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.22) 78%, rgba(0,0,0,0.5) 100%)",
          }}
        />
      )}
      {bar > 0 && (
        <>
          <div className="absolute inset-x-0 top-0 bg-black" style={{ height: `${bar}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-black" style={{ height: `${bar}%` }} />
        </>
      )}
    </div>
  );
}
