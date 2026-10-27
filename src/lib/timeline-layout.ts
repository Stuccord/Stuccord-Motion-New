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

/** A clip's span on a track (ms). */
export type Span = { start: number; end: number };

/**
 * The start nearest `wantMs` where something `lengthMs` long fits among
 * `spans` (sorted, not overlapping) without overlapping any of them: inside
 * the gap at `wantMs` if it fits there, so it stops at a neighbour's edge,
 * otherwise in the nearest gap that is big enough (there is always room
 * after the last clip).
 */
export function fitStart(spans: Span[], wantMs: number, lengthMs: number): number {
  const gaps: [number, number][] = [];
  let prevEnd = 0;
  for (const s of spans) {
    gaps.push([prevEnd, s.start]);
    prevEnd = Math.max(prevEnd, s.end);
  }
  gaps.push([prevEnd, Infinity]);
  let best = prevEnd;
  let bestDistance = Infinity;
  for (const [from, to] of gaps) {
    if (to - from < lengthMs) continue;
    const start = Math.min(Math.max(wantMs, from), to - lengthMs);
    const distance = Math.abs(start - wantMs);
    if (distance < bestDistance) {
      best = start;
      bestDistance = distance;
    }
  }
  return Math.max(0, Math.round(best));
}

type VideoClip = Placeable & { role: string; ordinal: number };
export type VideoTrack = "aroll" | "broll";

/** One clip's saved place: what updateClipOrder takes. */
export type ClipPlacement = { id: string; ordinal: number; role: string; start_ms: number | null };

/** The video clips as they're saved now, for undo. */
export function currentPlacements(aRoll: VideoClip[], bRoll: VideoClip[]): ClipPlacement[] {
  return [...aRoll, ...bRoll].map((c) => ({
    id: c.id,
    ordinal: c.ordinal,
    role: c.role,
    start_ms: c.start_ms ?? null,
  }));
}

/**
 * Places clips on a video track at about `wantMs` (each one after the
 * previous), at the nearest spot where they fit, leaving every other clip
 * where it is. `moving` may already be on a track (a move) or be new.
 * Tracks that change get explicit start times so nothing else shifts; an
 * untouched track keeps its clips as they are. Returns the new placements
 * of all video clips (A-roll first, by time) and where the first one starts.
 */
export function planPlacement<T extends VideoClip>(
  aRoll: T[],
  bRoll: T[],
  moving: T[],
  toTrack: VideoTrack,
  wantMs: number,
  lengthMs: (clip: T) => number,
): { placements: ClipPlacement[]; startMs: number } {
  const movingIds = new Set(moving.map((c) => c.id));
  const placed = (clips: T[]) => {
    const { starts } = layoutTrack(clips, lengthMs);
    return clips
      .filter((c) => !movingIds.has(c.id))
      .map((c) => ({ clip: c, role: c.role, start: starts.get(c.id) ?? 0 }));
  };
  const tracks = { aroll: placed(aRoll), broll: placed(bRoll) };
  const changed = new Set<VideoTrack>([toTrack]);
  for (const c of moving) {
    if (aRoll.some((x) => x.id === c.id)) changed.add("aroll");
    if (bRoll.some((x) => x.id === c.id)) changed.add("broll");
  }

  let firstStart = 0;
  let want = wantMs;
  moving.forEach((c, i) => {
    const spans = tracks[toTrack]
      .map((p) => ({ start: p.start, end: p.start + lengthMs(p.clip) }))
      .sort((a, b) => a.start - b.start);
    const start = fitStart(spans, want, lengthMs(c));
    if (i === 0) firstStart = start;
    const role = toTrack === "broll" ? "broll" : c.role === "broll" ? "aroll" : c.role;
    tracks[toTrack].push({ clip: c, role, start });
    want = start + lengthMs(c);
  });

  const sorted = (t: VideoTrack) => [...tracks[t]].sort((a, b) => a.start - b.start);
  const a = sorted("aroll");
  const b = sorted("broll");
  const placements = [
    ...a.map((p, i) => ({
      id: p.clip.id,
      ordinal: i,
      role: p.role,
      start_ms: changed.has("aroll") ? p.start : (p.clip.start_ms ?? null),
    })),
    ...b.map((p, i) => ({
      id: p.clip.id,
      ordinal: a.length + i,
      role: "broll",
      start_ms: changed.has("broll") ? p.start : (p.clip.start_ms ?? null),
    })),
  ];
  return { placements, startMs: firstStart };
}

/** "Close gaps" on the A-roll: its clips back to back again, in order. */
export function closeGapsPlacements(aRoll: VideoClip[], bRoll: VideoClip[]): ClipPlacement[] {
  return [
    ...aRoll.map((c, i) => ({ id: c.id, ordinal: i, role: c.role, start_ms: null })),
    ...bRoll.map((c, i) => ({
      id: c.id,
      ordinal: aRoll.length + i,
      role: c.role,
      start_ms: c.start_ms ?? null,
    })),
  ];
}
