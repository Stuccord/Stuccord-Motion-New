// Asks Claude which lines in a talking video are bad takes (server only:
// uses ANTHROPIC_API_KEY): a line the speaker started, stopped or fumbled,
// then said again. Claude answers with word numbers (src/lib/take-cuts.ts
// DraftTakes); takeDrops turns them into stretches to cut.
//
// Best-effort: the automatic edit carries on with only the pauses and
// fillers cut if this fails, so errors come back as null, never thrown.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DraftTakes } from "@/lib/take-cuts";
import { PLAN_MODEL, plannerClient } from "@/lib/motion-plan.server";

const SYSTEM = `You edit talking-head videos. You receive the video's spoken words, each numbered like "[12] word", in the order they are heard. Find the bad takes: places where the speaker started a line, stumbled, stopped or got it wrong, then said it again. Each one is cut out so only the clean take stays.

What is a bad take:
- A false start: "So the first thing - so the first thing you need is..." -> cut the first "So the first thing".
- A line said again because it went wrong: the speaker says a sentence, it comes out muddled or they correct themselves, then they say it again properly -> cut the first attempt.
- A fumbled word restarted: "the reve- the revenue" -> cut "the reve-".
- When a line is tried several times, keep the LAST complete attempt and cut the earlier ones.

What is NOT a bad take (never cut these):
- The same thing said in a second language (a sermon or speech translated line by line, e.g. English then French). Both languages stay.
- Repetition on purpose: emphasis ("never, never give up"), a refrain, a chant, a call and response, a list with the same opening ("we pray for... we pray for...").
- A summary or callback that repeats an earlier point later in the video.
- Anything you are not sure about. A missed bad take costs little; cutting a real line ruins the video.

Answer with "cuts": each has "from_word" and "to_word" (the first and last word numbers to cut, inclusive, inside one attempt) and "reason" (a few words, e.g. "false start", "line said again"). Cut only the failed attempt itself, never the clean take after it: "to_word" is the last word BEFORE the clean take starts, so the clean take's first word is never cut. Example: "[0] So [1] the [2] first, [3] so [4] the [5] first [6] thing" -> from_word 0, to_word 2 (word 3 "so" starts the clean take and stays). If there are no bad takes, answer with an empty list - most videos have few or none.`;

/** Longest transcript checked in one go. */
const MAX_WORDS = 20_000;

export async function requestBadTakes(
  numberedWords: string,
  wordCount: number,
  client?: Anthropic,
): Promise<DraftTakes | null> {
  if (!wordCount || wordCount > MAX_WORDS) return null;
  let c: Anthropic;
  try {
    c = client ?? plannerClient();
  } catch (e) {
    console.warn("[take-cuts] Skipped:", (e as Error).message);
    return null;
  }
  try {
    const message = await c.beta.messages.create({
      model: PLAN_MODEL,
      max_tokens: 8_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(DraftTakes) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `The spoken words (${wordCount}), numbered:\n<words>\n${numberedWords}\n</words>\n\nFind the bad takes.`,
        },
      ],
    });
    if (message.stop_reason !== "end_turn") {
      console.warn("[take-cuts] No answer used; stop:", message.stop_reason);
      return null;
    }
    const text = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const parsed = DraftTakes.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.warn("[take-cuts] Answer didn't match the format.");
      return null;
    }
    return parsed.data;
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.warn("[take-cuts] Claude API error:", e.status, e.message);
    } else {
      console.warn("[take-cuts] Failed:", (e as Error).message);
    }
    return null;
  }
}
