// When the parts of the 3D sequences happen (stage 9), in frames at 30 fps
// from the graphic's start: shared by the drawing (MotionGraphics) and the
// sounds (sounds.ts), and mirrored in render-worker/motion.js. No app
// imports: the worker bundles src/motion on its own.

/** Steps: each step's platform is reached in turn over the first 80%. */
export function stepStarts(count: number, length: number): number[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => Math.round((i * length * 0.8) / n));
}

/** Loop: the sphere rises, then the arc draws round it, reaching each dot in turn. */
export function loopBeats(count: number, length: number) {
  const n = Math.max(1, count);
  const arcFrom = 10;
  const arcFrames = Math.max(16, Math.round(length * 0.45));
  return {
    arcFrom,
    arcFrames,
    /** When the arc reaches each dot (the first sits at the top). */
    dots: Array.from({ length: n }, (_, i) => arcFrom + Math.round((arcFrames * i) / n)),
    /** When a swapped word changes. */
    swapAt: Math.max(arcFrom + arcFrames + 6, Math.round(length * 0.72)),
  };
}

/** Coins: one coin spins up, then many fan out in a circle. */
export function coinBeats(length: number) {
  return { fanAt: Math.max(18, Math.round(length * 0.45)) };
}

/** How many coins fan out: one per label, or eight. */
export const coinCount = (labels: number) => (labels >= 2 ? Math.min(8, labels) : 8);

/**
 * Card stream: the pictures jump in 3 frames apart, then the last card (the
 * logo, or without one the last picture) lands flat on top.
 */
export function streamBeats(count: number) {
  return {
    /** When each picture starts its jump. */
    cards: Array.from({ length: count }, (_, i) => 2 + i * 3),
    /** Frames a jump takes, from below the camera to the pile. */
    flight: 16,
    /** When the last card starts its fall. */
    finaleAt: 2 + count * 3 + 5,
  };
}

/** Profile: the header rises, the grid photos one by one, then they flick through big. */
export function profileBeats(photos: number, length: number) {
  const grid = Array.from({ length: photos }, (_, i) => 10 + i * 5);
  const gridEnd = grid.length ? grid[grid.length - 1] + 12 : 10;
  const flickFrom = Math.max(gridEnd + 8, Math.round(length * 0.5));
  const each = photos
    ? Math.min(18, Math.max(8, Math.floor((length - flickFrom - 6) / photos)))
    : 0;
  return {
    grid,
    flickFrom,
    /** When each photo flicks up big (none if there's no room left). */
    flicks: Array.from({ length: photos }, (_, i) => flickFrom + i * each).filter(
      (f) => f < length - 6,
    ),
  };
}
