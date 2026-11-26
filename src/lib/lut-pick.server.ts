// The automatic edit's colour pick, so the grade matches the video:
//   1. Claude looks at frames from across the footage (its light, colour,
//      setting and mood), knows the look and the topic, and shortlists up
//      to four ready-made LUTs (src/motion/lut-packs.ts) at strengths.
//   2. The worker grades those same frames through each shortlisted LUT and
//      through the look's own grade, exactly as the export would.
//   3. Claude compares the real results and picks the one that suits this
//      footage best (the look's own grade is one of the options).
// Best-effort: any problem means the look's own grade.

import { PACK_LUTS, packLut } from "@/motion/lut-packs";
import type { MotionLut } from "@/lib/motion-plan";

/**
 * What each LUT does, measured from the LUT itself (skin, sky, foliage,
 * reds, blacks, whites), and the most it should be used at, so faces stay
 * natural. Keyed by id; a LUT missing here isn't offered.
 */
const LUT_NOTES: Record<string, { does: string; max: number }> = {
  "hue-haven-autumn-dull": {
    does: "near neutral; greens turned warm olive, a quiet autumn feel",
    max: 1,
  },
  "hue-haven-autumn-rich": {
    does: "near neutral; greens to olive, reds deepened to crimson",
    max: 1,
  },
  "hue-haven-b-w-faded": {
    does: "black and white, lifted grey blacks, soft and nostalgic",
    max: 1,
  },
  "hue-haven-b-w-high-contrast": {
    does: "black and white, deep blacks, hard contrast, dramatic",
    max: 1,
  },
  "hue-haven-bright": {
    does: "much brighter and warmer, punchy colour; for dark or flat footage",
    max: 0.7,
  },
  "hue-haven-classy": {
    does: "strong contrast and saturation, bright cyan skies, glossy commercial look",
    max: 0.55,
  },
  "hue-haven-deep": { does: "darker and moodier, rich saturated colour, deep shadows", max: 0.6 },
  "hue-haven-dream": { does: "bright, pink-violet airy tint, soft dreamy", max: 0.5 },
  "hue-haven-orange-teal-faded": {
    does: "cinematic orange skin and teal blues, lifted faded blacks",
    max: 0.85,
  },
  "hue-haven-orange-teal": { does: "cinematic orange-teal, darker mids, rich contrast", max: 0.8 },
  "hue-haven-prime": { does: "warm brighter skin, lifted blacks, a soft magenta haze", max: 0.7 },
  "hue-haven-stark": {
    does: "crisp, a little warmer skin, stronger reds, clean contrast",
    max: 0.9,
  },
  "hue-haven-vintage": { does: "warm brown-lifted blacks, warm faded film", max: 0.8 },
  "hue-haven-wash": { does: "very flat and washed out, dim whites, muted", max: 0.6 },
  "prism-tones-better-sepia": { does: "sepia (brown monochrome), old photograph", max: 1 },
  "prism-tones-color-punch-cool": {
    does: "blue-lifted shadows, pink skin, vivid cool colour",
    max: 0.5,
  },
  "prism-tones-color-punch-warm": {
    does: "vivid warm colour, bright skin, saturated greens and blues",
    max: 0.6,
  },
  "prism-tones-earthy": { does: "brown earthy tones, muted blues, natural outdoors", max: 0.8 },
  "prism-tones-edgy": { does: "desaturated, grey lifted blacks, dim whites, gritty", max: 0.7 },
  "prism-tones-golden": { does: "strong golden yellow cast, bright, sunset warmth", max: 0.5 },
  "prism-tones-hipstagram": { does: "warm yellow-green photo-app filter, faded", max: 0.6 },
  "prism-tones-hipstawash": { does: "faded and muted, grey blacks, soft", max: 0.7 },
  "prism-tones-keep-red": {
    does: "black and white except reds and skin, which keep their colour",
    max: 1,
  },
  "prism-tones-red-pink": { does: "pink-red tint, lifted blacks, dim whites, retro", max: 0.5 },
};

const choices = () =>
  PACK_LUTS.filter((l) => LUT_NOTES[l.id]).map(
    (l) => `- ${l.id}: ${LUT_NOTES[l.id].does} (at most ${LUT_NOTES[l.id].max})`,
  );

const STYLE_NAMES: Record<string, string> = {
  glass: "Motion Explainer (dark glass cards, punchy colour)",
  paper: "Paper (paper on a desk, warm and soft)",
  minimal: "Minimal (quiet, softer colour)",
  film: "Cinematic (film colour, grain, black bars)",
  saas: "SaaS (bright, clean, light pages)",
  docu: "Documentary (calm, true to life)",
  cine3d: "3D Cinematic (deep contrast, red light)",
  bulletin: "Bulletin (newsroom, crisp and neutral)",
  impact: "Impact (loud, hard contrast)",
  noir: "Noir (black and white)",
  monument: "Monument (warm, gold, deep blacks)",
  talk: "Studio Talk (warm podcast)",
  notebook: "Notebook (bright, clean)",
  hud: "Spec HUD (crisp, a little cool)",
  studio: "Studio 3D (clean and bright)",
};

const image = (data: string) =>
  ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data },
  }) as const;

async function ask(content: unknown[], maxTokens: number): Promise<string> {
  const { plannerClient, PLAN_MODEL } = await import("@/lib/motion-plan.server");
  const message = await plannerClient().messages.create({
    model: PLAN_MODEL,
    max_tokens: maxTokens,
    // The SDK's content type: images and text blocks.
    messages: [{ role: "user", content: content as never }],
  });
  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .toLowerCase();
  if (!text) {
    console.warn(
      `[lut-pick] Empty answer (${message.stop_reason}; ${message.content.map((b) => b.type).join(",")})`,
    );
  }
  return text;
}

/** A pack LUT and strength (kept within its limit) from "id 0.6"; else null. */
export function parsePick(text: string): MotionLut | null {
  const m = /([a-z0-9-]+)\s+([01](?:\.\d+)?)/.exec(text);
  if (!m || !packLut(m[1]) || !LUT_NOTES[m[1]]) return null;
  const strength = Math.min(LUT_NOTES[m[1]].max, Math.max(0.3, Number(m[2])));
  return { id: m[1], strength: Math.round(strength * 20) / 20, by: "ai" };
}

/** Up to four LUTs worth trying on this footage (one per line of the answer). */
async function shortlist(frames: string[], style: string, about: string): Promise<MotionLut[]> {
  const text = await ask(
    [
      ...frames.map(image),
      {
        type: "text",
        text: `You colour-grade short talking videos. These frames are from across one video. Its style is ${style}, which has its own colour grade. It's about: ${about || "(not known)"}.

Study the footage: the light (daylight, tungsten, LED, mixed, dim), the colours in the room and clothes, the skin tones, the setting, and the mood of the topic. Shortlist up to four of these LUTs that could make this footage look its best and match its mood, each at the strength that would suit it. Keep skin natural: lower strengths for strong LUTs. Black and white or sepia only for the noir style or a topic clearly about the past.

LUTs (id: what it does (highest strength to use)):
${choices().join("\n")}

Answer with one LUT per line, as <id> <strength 0.3-1>, and nothing else.`,
      },
    ],
    2000,
  );
  const picks: MotionLut[] = [];
  for (const line of text.split("\n")) {
    const p = parsePick(line);
    if (p && !picks.some((q) => q.id === p.id)) picks.push(p);
  }
  return picks.slice(0, 4);
}

/**
 * The finished frames for each choice: "look" (the look's own grade) and the
 * shortlisted LUTs, graded on the worker as the export would; key → JPEG.
 */
export type GradeSheets = (
  choices: { key: string; id: string; strength: number }[],
) => Promise<{ key: string; jpeg: string }[]>;

const LETTERS = "ABCDEFGH";

/** Claude's pick for this footage, or null for the look's own grade. */
export async function pickLut(input: {
  /** Frames from across the footage, JPEG, base64. */
  frames: string[];
  look: string;
  /** A line or two of what's said. */
  about: string;
  /** Grades the frames on the worker. */
  sheets: GradeSheets;
}): Promise<MotionLut | null> {
  const style = STYLE_NAMES[input.look] ?? input.look;
  const about = input.about.slice(0, 600);
  const candidates = await shortlist(input.frames, style, about);
  console.info(
    `[lut-pick] ${input.look} shortlist: ${candidates.map((c) => `${c.id} ${c.strength}`).join(", ") || "none"}`,
  );
  if (!candidates.length) return null;

  const graded = await input.sheets([
    // The look's own grade last, so its place doesn't favour it.
    ...candidates.map((c) => ({ key: c.id, id: c.id, strength: c.strength })),
    { key: "look", id: "look", strength: 1 },
  ]);
  if (graded.length < 2) return null;
  const content: unknown[] = [];
  graded.forEach((g, i) => {
    content.push({ type: "text", text: `Option ${LETTERS[i]}:` }, image(g.jpeg));
  });
  content.push({
    type: "text",
    text: `Each option is the same frames of one talking video, finished with a different colour grade. The video's style is ${style}; it's about: ${about || "(not known)"}.

Pick the option that makes this footage look best and whose colour best matches it: skin looks natural and healthy, the grade suits the footage's own light and setting rather than fighting it, nothing looks over-processed, and the mood fits the topic and style. Judge each on its own merits: a flat, dull, grey or off-colour picture is a poor match even if it's subtle, and a stronger grade is fine when it makes the footage look better and still natural.

Answer with one letter only.`,
  });
  // Room to think: comparing the options is the hard part.
  const answer = await ask(content, 4000);
  const letter = /\b([a-h])\b/.exec(answer)?.[1]?.toUpperCase();
  const chosen = letter ? graded[LETTERS.indexOf(letter)] : undefined;
  console.info(
    `[lut-pick] ${input.look} chose ${letter ?? `? "${answer.slice(0, 60)}"`} (${chosen?.key ?? "look"})`,
  );
  if (!chosen || chosen.key === "look") return null;
  return candidates.find((c) => c.id === chosen.key) ?? null;
}
