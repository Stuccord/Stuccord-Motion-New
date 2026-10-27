// Where clips sit on a track, shared by the timeline, the preview, captions
// and the browser export (the cloud worker has the same rule in JS).
//
// A clip with start_ms sits there. One without follows the clip before it,
// which is how every clip was laid out before clips could be placed, so
// untouched projects look and export the same. Clips are taken in order
// (ordinal) and never overlap: a clip that would start inside the one
// before it starts where that one ends.

export type Placeable = { id: string; start_ms?: number | null };

export type TrackLayout = {
  /** Where each clip starts on the timeline (ms). */
  starts: Map<string, number>;
  /** Where the last clip ends (ms); 0 for an empty track. */
  endMs: number;
};

export function layoutTrack<T extends Placeable>(
  clips: T[],
  lengthMs: (clip: T) => number,
): TrackLayout {
  const starts = new Map<string, number>();
  let endMs = 0;
  for (const c of clips) {
    const start = Math.max(endMs, Math.round(c.start_ms ?? endMs));
    starts.set(c.id, start);
    endMs = start + Math.max(0, lengthMs(c));
  }
  return { starts, endMs };
}
