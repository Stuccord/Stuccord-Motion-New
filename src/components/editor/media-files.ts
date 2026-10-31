// The media list's entries: one per uploaded file.

import type { ClipRow } from "./types";

/**
 * One entry per uploaded file: splitting a clip or adding a copy makes more
 * clips on the timeline, but they all share the same file. The entry shows
 * the original clip (else the first) and lists every clip made from it.
 */
export function filesOf(clips: ClipRow[]): { clip: ClipRow; ids: string[] }[] {
  const byPath = new Map<string, ClipRow[]>();
  for (const c of clips) {
    const list = byPath.get(c.storage_path);
    if (list) list.push(c);
    else byPath.set(c.storage_path, [c]);
  }
  return [...byPath.values()].map((list) => ({
    clip: list.find((c) => !c.parent_clip_id) ?? list[0],
    ids: list.map((c) => c.id),
  }));
}
