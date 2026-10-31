// Asks Claude for a Motion Explainer plan (server only: uses ANTHROPIC_API_KEY).
//
// The rules below condense docs/style-research/00-style-guide.md: every
// concrete thing said gets a visual at the moment it's said, one at a time,
// in the style's own devices. Claude answers in the DraftPlan shape (word
// numbers from the list it's given); src/lib/motion-plan.ts checks it and
// anchors it to the words.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DraftPlan } from "@/lib/motion-plan";

export const PLAN_MODEL = "claude-sonnet-5-5";

/** Longest transcript we plan in one go (about two hours of talking). */
export const MAX_PLAN_WORDS = 20_000;

const SYSTEM = `You plan on-screen motion graphics for talking-head videos in the "Motion Explainer" style: premium, minimal motion design where the edit never just shows a talking head. You receive the video's spoken words, each numbered like "[12] word", and optionally the creator's script. You choose which graphics appear, on which words, and what they say.

The core rule: every concrete thing the speaker says gets a visual at the moment it is said - a number, a list, a comparison, a product or brand, a key claim, a new section. Graphics are triggered by words, so anchor each one to the words that trigger it.

Graphic types (field "type"):
- keyline: a key sentence written out on screen while it is said. Only the most important lines (the hook, the lesson, a punchline) - never running subtitles. "text" is the line as said (it may be shortened); "emphasis" is the one word or short phrase to show in the special font.
- counter: a number that animates as it is said (money, percentages, counts, durations). Set "number" {value, prefix, suffix} - e.g. "$4 trillion" -> value 4, prefix "$", suffix " trillion"; "98%" -> value 98, suffix "%". "text" is a short caption for what the number means.
- list: items that stack one by one as each is named ("faster, cheaper, and at scale"). "items" has 2-8 short items in spoken order; "text" is an optional title.
- card: a glass UI card for a concept, tip or piece of advice. "text" is the title; "items" up to 4 short lines.
- compare: an A-vs-B idea ("a powerful tool or an expensive burden"). "items" has exactly the two sides; "text" is an optional title.
- story: a short story or journey told over a few sentences ("when I started I had nothing... I slept on a friend's floor... then I made my first sale"). Shown as a sequence of cinematic AI-generated pictures joined by one camera move. Set "scenes": 2-6 scenes in spoken order, each with "from_word" (the word that scene's phrase starts on, within the story's words), "text" (3-7 words on screen, the speaker's words), "emphasis" (one word from that text, or null) and "prompt" (what the picture shows: a person or place living that moment, the setting, the light and mood, in one or two sentences; no words or lettering in the picture; never a real, named person, brand or logo) and "speaker" (true when the speaker themself is in that picture - they are drawn as their own cartoon character - e.g. "I slept on a friend's floor"; false for other people or places). "text" is an optional title for the whole story. Use it for real stories only, at most one or two per video.
- cartoon: a full-screen cartoon of the speaker acting out a moment - a pain point or common mistake ("most people just copy what they see online"), a joke or sarcastic aside, or a metaphor taken literally ("I was drowning in work"). Set "scenes" to exactly one scene: "from_word" the cartoon's first word, "text" an optional caption of 2-6 words from what was said ("" for none), "emphasis" one word from it or null, "prompt" what the speaker's cartoon is doing, where, and the expression, in one or two sentences (no words or lettering; never a real, named person, brand or logo), and "speaker" true. Use it for short moments, 2-5 seconds, at most one every 30 seconds.
- steps: a process or path said as steps ("first you show up, then you build, then you launch"). Full screen: numbered 3D platforms climbing away, each lit as the camera reaches it. "items" has the 2-5 steps in order, 1-3 words each; "text" is an optional title. Use it for real step-by-step moments, at most a few per video.
- loop: a cycle or routine that repeats ("wake up, go to work, come home, sleep, repeat"). Full screen: a glowing sphere with an orbit drawing round it, a stop lighting up for each item. "items" has the 3-6 stops in order, 1-3 words each; "text" is an optional title. If the speaker then changes one part of the loop ("swap the job for building a system"), set "swap" {item: the stop's number from 0, text: the new words}; otherwise null.
- coins: a choice, a gamble or chances ("every choice is a coin flip", "most will fail, one will change everything"). Full screen: a glossy coin spins up, then many fan out in a ring. "text" is the line (under 10 words), "emphasis" one word from it; "items" optional labels for the coins (2-8 short ones) or [].
- stream: proof or a pile of results ("I've worked with hundreds of clients", "all these videos", "look at the results"). Full screen: a stream of pictures jumping into a pile, ending on the brand logo; the pictures come from the creator, not from you. "text" is an optional title (under 6 words). At most one or two per video.
- profile: when the speaker talks about their own social media profile or account ("my Instagram", "my main page is just photo dumps"). Full screen: a social profile that builds itself, then its photos flick through. Set "profile" {handle, name, bio, posts, followers, following} with only what was actually said ("" for everything else - the creator fills it in); "text" is "". At most one per video.
- chapter: a section divider when the speaker starts a new part, tip or step ("tip number one", "moving on to..."). "text" is the section title.
- label: a small "you are here" label naming the current item or topic; it may stay up while other graphics come and go.
- cta: when the speaker asks viewers to like, subscribe, comment or check a link. Set "cta".
- zoom: a punch-in ("in") on an emphatic beat, or an ease back out ("out"). Use zooms to keep stretches without graphics moving.

Behind the speaker (field "behind"):
- true draws the graphic behind the speaker: the person is cut out and stays in front, and the room behind them darkens and softly blurs, so the words sit between the room and the person. It is the style's strongest emphasis.
- Use it for the biggest moments only: the hook's key line, chapter titles, a headline number - roughly one graphic in five, never two in a row.
- Only keyline, counter, list, card, compare and chapter can go behind; false for every other type.

Timing:
- "from_word" is the first word that triggers the graphic; "to_word" the last word it stays up for (usually the end of the phrase or sentence, 1.5-8 seconds of speech). A list stays until its last item is said.
- One main graphic at a time: keyline, counter, list, card, compare, story, cartoon, steps, loop, coins, stream, profile, chapter and cta never overlap each other. Zooms don't overlap other zooms; labels don't overlap other labels.
- Pace: the opening (hook) is the densest - a visual every 3-4 seconds. Later, a graphic or a zoom roughly every 5-10 seconds. Leave the speaker on screen for personal, emotional moments.

Writing:
- Use the speaker's own words and language. Keep on-screen text short: titles under 6 words, items under 5 words, key lines under 12 words.
- Never invent facts, numbers, names or claims that weren't said. If the script differs from what was said, follow what was said.
- "reason" is a few words on why this graphic fits here (e.g. "number said", "three benefits listed", "new tip starts").
- "swap" is null on every type but loop (and on most loops); "profile" is null on every type but profile.
- Use null for fields a type doesn't use, and [] for unused items and for "scenes" on every type but story and cartoon.
- "language" is the transcript's language as a short code (e.g. "en").`;

export type PlanRequest = {
  title: string;
  script: string | null;
  numberedWords: string;
  wordCount: number;
};

export type PlanResult = {
  draft: DraftPlan;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** A problem the user can act on; its message is shown as is. */
export class PlanError extends Error {}

function userMessage(req: PlanRequest): string {
  const parts = [
    `Video title: ${req.title || "(untitled)"}`,
    req.script?.trim()
      ? `The creator's script (for context; follow what was actually said):\n<script>\n${req.script.trim().slice(0, 60_000)}\n</script>`
      : "No script was given.",
    `The spoken words (${req.wordCount}), numbered:\n<words>\n${req.numberedWords}\n</words>`,
    "Plan the graphics for this video.",
  ];
  return parts.join("\n\n");
}

/** The client; tests pass their own. */
export function plannerClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new PlanError(
      "AI planning isn't set up yet (ANTHROPIC_API_KEY is missing on the server).",
    );
  }
  // The key is passed in so no other credential on the server is picked up.
  // One retry on a dropped connection or overload; each try may take a while
  // on a long video.
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 240_000 });
}

export async function requestPlan(
  req: PlanRequest,
  client: Anthropic = plannerClient(),
): Promise<PlanResult> {
  let message;
  try {
    // create(), not parse(): parse() throws on an answer that doesn't fit the
    // format before the stop reason (a refusal, a cut-off) can be checked.
    message = await client.beta.messages.create({
      model: PLAN_MODEL,
      max_tokens: 16_000,
      // If Claude declines on a safety rule, the API retries on a model
      // suited to that kind of request instead of failing outright.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(DraftPlan) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage(req) }],
    });
  } catch (e) {
    if (
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError
    ) {
      console.error("[motion-plan] Claude rejected the API key:", e.message);
      throw new PlanError(
        "AI planning isn't available right now (the server's API key was rejected).",
      );
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new PlanError("The AI is busy right now. Please try again in a minute.");
    }
    if (e instanceof Anthropic.BadRequestError) {
      console.error("[motion-plan] Claude rejected the request:", e.message);
      throw new PlanError("The AI couldn't take this video's transcript. Please try again.");
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      throw new PlanError("The AI took too long to answer. Please try again.");
    }
    if (e instanceof Anthropic.APIError) {
      console.error("[motion-plan] Claude API error:", e.status, e.message);
      throw new PlanError("The AI service had a problem. Please try again in a minute.");
    }
    throw e;
  }

  if (message.stop_reason === "refusal") {
    throw new PlanError("The AI declined to plan graphics for this video.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new PlanError(
      "This video is too long to plan in one go. Try splitting it into shorter projects.",
    );
  }
  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  let draft: DraftPlan | null = null;
  try {
    const parsed = DraftPlan.safeParse(JSON.parse(text));
    if (parsed.success) draft = parsed.data;
  } catch {
    // not JSON
  }
  if (!draft) {
    console.error(
      "[motion-plan] Claude's answer didn't match the plan format; stop:",
      message.stop_reason,
    );
    throw new PlanError("The AI's answer didn't come through properly. Please try again.");
  }
  return {
    draft,
    model: message.model,
    inputTokens:
      message.usage.input_tokens +
      (message.usage.cache_read_input_tokens ?? 0) +
      (message.usage.cache_creation_input_tokens ?? 0),
    outputTokens: message.usage.output_tokens,
  };
}
