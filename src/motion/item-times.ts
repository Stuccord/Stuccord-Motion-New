// When each item of a list, steps, comparison or card comes on screen: on
// the word where the speaker says it, so the graphic explains along with
// them instead of on its own clock. Mirrored in render-worker/motion.js
// (itemTimes), which places the export's graphics.

/** Small words that don't name an item ("or even exams" is "exams"). */
const FILLER = new Set(
  (
    "a an the and or nor but of to in on at by for from with without into onto " +
    "my your our their his her its me you we they it i is are was were be been " +
    "even also just some more most very really so then that this these those " +
    "all any every each no not too like as about up down out over"
  ).split(" "),
);

/** A text's words, lower case, without punctuation. */
export function itemWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The same word, allowing for endings ("lecture" / "lectures", "plan" / "planning"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const n = Math.min(a.length, b.length, 5);
  return a.slice(0, n) === b.slice(0, n) && Math.abs(a.length - b.length) <= 4;
}

/**
 * The frame each item comes on: the start of the first spoken word (in
 * order, after the item before) that names it. `spoken` is the graphic's
 * words in time order, each with its first frame. Items not found go between
 * their neighbours; null when none could be found (the graphic keeps its own
 * timing). Never before `from + lead` (the title arrives first) or after `to`.
 */
export function itemTimes(
  items: string[],
  spoken: { text: string; frame: number }[],
  from: number,
  to: number,
  lead = 6,
): number[] | null {
  if (items.length < 2 || !spoken.length) return null;
  const words = spoken.map((w) => ({ frame: w.frame, word: itemWords(w.text)[0] ?? "" }));
  const found: (number | null)[] = [];
  let next = 0;
  for (const item of items) {
    const all = itemWords(item);
    const keys = all.filter((w) => !FILLER.has(w));
    const look = keys.length ? keys : all;
    let at: number | null = null;
    for (let i = next; i < words.length; i++) {
      if (look.some((k) => sameWord(k, words[i].word))) {
        at = words[i].frame;
        next = i + 1;
        break;
      }
    }
    found.push(at);
  }
  if (found.every((f) => f == null)) return null;
  const first = from + lead;
  const last = to - 1;
  // Missing ones between their found neighbours (or spread to the ends).
  const out = found.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) continue;
    let a = i - 1;
    while (a >= 0 && found[a] == null) a--;
    let b = i + 1;
    while (b < out.length && found[b] == null) b++;
    const fa = a >= 0 ? (found[a] as number) : first;
    const fb =
      b < out.length
        ? (found[b] as number)
        : Math.max(fa + 1, Math.round(last - (last - fa) * 0.25));
    const ia = a >= 0 ? a : -1;
    const ib = b < out.length ? b : out.length;
    out[i] = Math.round(fa + ((fb - fa) * (i - ia)) / (ib - ia));
  }
  // In order, inside the graphic.
  let prev = first - 1;
  return out.map((f) => {
    const v = Math.min(last, Math.max(prev + 1, f as number, first));
    prev = v;
    return v;
  });
}
