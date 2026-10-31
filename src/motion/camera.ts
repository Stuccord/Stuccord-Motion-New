// The story graphic's camera (drawn in MotionGraphics). Kept free of app
// imports: the worker bundles src/motion on its own, without src/lib.

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Frames the camera takes to fly from one scene to the next. */
const STORY_MOVE = 16;

/**
 * Where the camera is (in scenes: 1.5 = halfway from the second to the
 * third) at a frame into the story; the move into each scene is centred on
 * its start, so the camera is fastest exactly at the cut.
 */
export function storyCamera(starts: number[], frame: number): number {
  let c = 0;
  for (let i = 1; i < starts.length; i++) {
    const room = Math.min(starts[i] - starts[i - 1], (starts[i + 1] ?? Infinity) - starts[i]);
    const move = Math.max(4, Math.min(STORY_MOVE, room));
    c += easeInOut(clamp01((frame - (starts[i] - move / 2)) / move));
  }
  return c;
}
