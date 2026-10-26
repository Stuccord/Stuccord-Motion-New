// Caption words on the editor timeline.
//
// Transcripts are stored per source file, in source-file time. These helpers
// place them on the timeline the same way the render worker does
// (render-worker/server.js: placeWordsOnTimeline / groupCaptionWords), so the
// Captions panel shows the phrases and times the export will burn in.

export type TranscriptWord = { text: string; start_ms: number; end_ms: number };

/** One main-track clip: which source it plays, and where it sits on the timeline. */
export type CaptionSegment = {
  clipId: string;
  storagePath: string;
  /** Source time where the clip starts playing. */
  trimInMs: number;
  /** How long the clip plays. */
  durationMs: number;
  /** Where the clip starts on the timeline. */
  offsetMs: number;
};

export type TimelineWord = {
  /** Stable key: clip id + index of the word in its source transcript. */
  key: string;
  clipId: string;
  storagePath: string;
  /** Index into the source transcript's words array. */
  wordIndex: number;
  text: string;
  /** Timeline time (ms). */
  startMs: number;
  endMs: number;
};

/** Keeps well-formed words and sorts them by start time. */
export function cleanTranscriptWords(words: unknown): TranscriptWord[] {
  if (!Array.isArray(words)) return [];
  return words
    .filter(
      (w): w is TranscriptWord =>
        !!w &&
        typeof w.text === "string" &&
        w.text.trim() !== "" &&
        Number.isFinite(w.start_ms) &&
        Number.isFinite(w.end_ms) &&
        w.end_ms >= w.start_ms,
    )
    .map((w) => ({ text: w.text.trim(), start_ms: w.start_ms, end_ms: w.end_ms }))
    .sort((a, b) => a.start_ms - b.start_ms);
}

/**
 * Places each segment's source words on the timeline. Words that start
 * outside a clip's played window are left out (they're trimmed away); a word
 * running past the window is cut off at the clip's end.
 */
export function placeTranscripts(
  segments: CaptionSegment[],
  transcripts: Map<string, TranscriptWord[]>,
): TimelineWord[] {
  const placed: TimelineWord[] = [];
  for (const seg of segments) {
    const words = transcripts.get(seg.storagePath);
    if (!words) continue;
    const windowEnd = seg.trimInMs + seg.durationMs;
    words.forEach((w, wordIndex) => {
      if (w.start_ms < seg.trimInMs || w.start_ms >= windowEnd) return;
      placed.push({
        key: `${seg.clipId}:${wordIndex}`,
        clipId: seg.clipId,
        storagePath: seg.storagePath,
        wordIndex,
        text: w.text,
        startMs: seg.offsetMs + (w.start_ms - seg.trimInMs),
        endMs: seg.offsetMs + (Math.min(w.end_ms, windowEnd) - seg.trimInMs),
      });
    });
  }
  return placed;
}

/** Converts a timeline time inside a segment back to source-file time. */
export function toSourceMs(seg: CaptionSegment, timelineMs: number): number {
  return Math.max(0, Math.round(seg.trimInMs + (timelineMs - seg.offsetMs)));
}

// Same grouping rules as the worker's captions.
const MAX_WORDS = 3;
const MAX_GAP_MS = 400;
const MAX_SPAN_MS = 1500;

/** Groups timeline words into the short phrases shown on screen. */
export function groupIntoPhrases(words: TimelineWord[]): TimelineWord[][] {
  const phrases: TimelineWord[][] = [];
  let cur: TimelineWord[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const startNew =
      prev &&
      (cur.length >= MAX_WORDS ||
        w.startMs - prev.endMs > MAX_GAP_MS ||
        /[.!?,;:]$/.test(prev.text) ||
        w.endMs - cur[0].startMs > MAX_SPAN_MS);
    if (startNew) {
      phrases.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) phrases.push(cur);
  return phrases;
}
