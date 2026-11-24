// Cutting filler sounds ("um", "uh") and bad takes (a line the speaker
// started, stopped and said again) out of the talking, from the transcript.
//
// Fillers are found here from the words alone. Bad takes are found by Claude
// (src/lib/take-cuts.server.ts), which answers with word numbers; this file
// turns both into stretches of each source file to drop, which
// src/lib/auto-edit.ts pauseCuts cuts out together with the pauses.

import { z } from "zod/v4";
import type { TimelineWord, TranscriptWord } from "@/lib/captions";

/** A stretch of a source file (ms into the file). */
export type DropRange = {
  fromMs: number;
  toMs: number;
  why: "filler" | "take";
  /** The clip the take was heard in (bad takes only). */
  clipId?: string;
  /** The words cut, for the editor's list. */
  text?: string;
  /** Claude's few words on why (bad takes only). */
  reason?: string;
};

/**
 * Filler sounds, in English and French. Only sounds with no meaning of their
 * own: "oh", "ah" and "eh" are left alone ("oh God" is a real phrase), and so
 * are words like "like" or "so" that are often real words.
 */
const FILLER = /^(u+m+|u+h+m*|e+r+m+|e+r+|h+m+|m+h*m+|e+u+h+)$/;

/** The word as said, without punctuation or case ("Um," -> "um"). */
const bare = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}]/gu, "");

export function isFiller(text: string): boolean {
  const b = bare(text);
  return !!b && FILLER.test(b);
}

/** The filler sounds in one file's words, as stretches to drop. */
export function fillerDrops(words: TranscriptWord[]): DropRange[] {
  return words
    .filter((w) => w.end_ms > w.start_ms && isFiller(w.text))
    .map((w) => ({ fromMs: w.start_ms, toMs: w.end_ms, why: "filler" as const, text: w.text }));
}

// ---------- bad takes (Claude's answer) ----------

/** What Claude answers: the word numbers of each bad take to cut. */
export const DraftTakes = z.object({
  cuts: z.array(
    z.object({
      from_word: z.number().int(),
      to_word: z.number().int(),
      /** A few words on what was repeated, for the review list and the logs. */
      reason: z.string(),
    }),
  ),
});
export type DraftTakes = z.infer<typeof DraftTakes>;

/** A bad take longer than this is more likely a misread than a retake: kept. */
const MAX_TAKE_MS = 20_000;
/** At most this share of the talking is cut as bad takes; past it, none are. */
const MAX_TAKE_SHARE = 0.4;

/**
 * A cut that ends by saying its own opening again ("Close um, Close") has
 * run into the clean take: the repeated words are where it starts, so they
 * stay. Fillers are skipped when comparing. Returns the fixed last word.
 */
export function withoutRestart(words: TimelineWord[], from: number, to: number): number {
  const said = (i: number) => bare(words[i]?.text ?? "");
  const real = [];
  for (let i = from; i <= to && i < words.length; i++) if (!isFiller(words[i].text)) real.push(i);
  for (let k = Math.floor(real.length / 2); k >= 1; k--) {
    const head = real.slice(0, k).map(said);
    const tail = real.slice(real.length - k).map(said);
    if (head.every((w, i) => w && w === tail[i])) return real[real.length - k] - 1;
  }
  return to;
}

/**
 * Claude's bad takes (word numbers into `words`, the video's spoken words in
 * order) as stretches of each source file to drop. Takes that don't make
 * sense (out of range, backwards, too long, crossing two clips) are dropped,
 * and if together they'd cut too much of the video none are used.
 */
export function takeDrops(
  words: TimelineWord[],
  transcripts: Map<string, TranscriptWord[]>,
  draft: DraftTakes,
): Map<string, DropRange[]> {
  const out = new Map<string, DropRange[]>();
  if (!words.length) return out;
  const talkMs = words[words.length - 1].endMs - words[0].startMs;
  let cutMs = 0;
  for (const raw of draft.cuts) {
    const c = { ...raw, to_word: withoutRestart(words, raw.from_word, raw.to_word) };
    const a = words[c.from_word];
    const b = words[c.to_word];
    if (!a || !b || c.to_word < c.from_word) continue;
    // One take lives in one clip (and so one file).
    if (a.clipId !== b.clipId) continue;
    const src = transcripts.get(a.storagePath);
    const first = src?.[a.wordIndex];
    const last = src?.[b.wordIndex];
    if (!first || !last || last.end_ms <= first.start_ms) continue;
    if (last.end_ms - first.start_ms > MAX_TAKE_MS) continue;
    cutMs += last.end_ms - first.start_ms;
    const list = out.get(a.storagePath) ?? [];
    list.push({
      fromMs: first.start_ms,
      toMs: last.end_ms,
      why: "take",
      clipId: a.clipId,
      text: words
        .slice(c.from_word, c.to_word + 1)
        .map((w) => w.text)
        .join(" "),
      reason: c.reason,
    });
    out.set(a.storagePath, list);
  }
  if (talkMs > 0 && cutMs / talkMs > MAX_TAKE_SHARE) return new Map();
  return out;
}

/** Both kinds together, per file, sorted. */
export function mergeDrops(...maps: Map<string, DropRange[]>[]): Map<string, DropRange[]> {
  const out = new Map<string, DropRange[]>();
  for (const m of maps) {
    for (const [path, list] of m) out.set(path, [...(out.get(path) ?? []), ...list]);
  }
  for (const list of out.values()) list.sort((x, y) => x.fromMs - y.fromMs);
  return out;
}

/** Fillers for every file that has words. */
export function allFillerDrops(
  transcripts: Map<string, TranscriptWord[]>,
): Map<string, DropRange[]> {
  const out = new Map<string, DropRange[]>();
  for (const [path, words] of transcripts) {
    const d = fillerDrops(words);
    if (d.length) out.set(path, d);
  }
  return out;
}
