// The automatic edit's colour pick: Claude looks at one frame of the footage,
// knows the video's look and what it's about, and picks one of the
// ready-made LUTs (src/motion/lut-packs.ts) at a strength, or none, when the
// look's own colour suits it best. Best-effort: any problem means none.

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

function instructions(look: string, about: string): string {
  return `You colour-grade short talking videos. This frame is from the creator's footage. The video's style is "${look}", which already has its own colour grade made for it. The video is about: ${about || "(not known)"}.

Look at the footage's light and colour (flat, dull, too warm, too cool, mixed lighting, dark) and the mood the topic and style call for, then pick the LUT that would make it look best, at the strength that suits it. A LUT replaces the style's grade, so answer none only when the footage already looks right and no LUT would improve it. Keep faces natural: use a lower strength for strong LUTs. Black and white or sepia only for the noir style or a topic clearly about the past.

LUTs (id: what it does (highest strength to use)):
${choices().join("\n")}

Answer with one line only, either
none
or
<id> <strength 0.3-1>`;
}

/** Claude's pick for this footage, or null for the look's own colour. */
export async function pickLut(input: {
  /** One frame of the footage, JPEG, base64. */
  frame: string;
  look: string;
  /** A line or two of what's said. */
  about: string;
}): Promise<MotionLut | null> {
  const { plannerClient, PLAN_MODEL } = await import("@/lib/motion-plan.server");
  const message = await plannerClient().messages.create({
    model: PLAN_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: input.frame },
          },
          { type: "text", text: instructions(input.look, input.about.slice(0, 600)) },
        ],
      },
    ],
  });
  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .toLowerCase();
  console.info(`[lut-pick] ${input.look}: ${text.slice(0, 80)}`);
  return parsePick(text);
}

/** "orange-teal 0.7" → the pick (strength kept within the LUT's limit); else null. */
export function parsePick(text: string): MotionLut | null {
  const m = /([a-z0-9-]+)\s+([01](?:\.\d+)?)/.exec(text);
  if (!m || !packLut(m[1]) || !LUT_NOTES[m[1]]) return null;
  const strength = Math.min(LUT_NOTES[m[1]].max, Math.max(0.3, Number(m[2])));
  return { id: m[1], strength: Math.round(strength * 20) / 20, by: "ai" };
}
