// Frame-based time, like After Effects: exports run at 30 fps, so the
// timeline counts and steps in 30ths of a second.

export const FPS = 30;

/** h:mm:ss:ff, e.g. 0:00:05:12 (5 seconds and 12 frames). */
export function formatFrameTimecode(ms: number): string {
  const totalFrames = Math.max(0, Math.round((ms * FPS) / 1000));
  const frames = totalFrames % FPS;
  const totalSeconds = Math.floor(totalFrames / FPS);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${h}:${two(m)}:${two(s)}:${two(frames)}`;
}

/** Rounds a time in seconds to the nearest frame. */
export const snapToFrame = (seconds: number) => Math.round(seconds * FPS) / FPS;
