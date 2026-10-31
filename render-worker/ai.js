// The worker's AI helpers: Claude's hook line, and plain messages for
// ElevenLabs errors. Kept apart from server.js so they can be tested without
// starting the worker.

import Anthropic from "@anthropic-ai/sdk";

// ---------- AI hook line ----------

// For videos without Motion Explainer graphics: a short on-screen hook for
// the first seconds, written by Claude from the title, script and brief.
// Optional - no key, no credit or any error just means no hook line.
const HOOK_MODEL = "claude-opus-5-5";
let anthropicClient = null;

export async function generateEditPlan(job, client = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!client && !apiKey) return null;
  client ??= anthropicClient ??= new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  const brief = [
    `Title: ${String(job.title ?? "").slice(0, 200)}`,
    `Script:\n${String(job.script || "(none)").slice(0, 6000)}`,
    `Brief:\n${String(job.brief || "(none)").slice(0, 2000)}`,
  ].join("\n\n");
  try {
    const message = await client.beta.messages.create({
      model: HOOK_MODEL,
      max_tokens: 2000,
      // A declined request is retried on a suitable model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system:
        "You write the on-screen hook caption shown over the first three seconds of a short talking-head video. " +
        "Reply with the caption only: 3 to 7 punchy words in the video's language, taken from or true to what the video is about. " +
        "No quotes, hashtags, emojis or trailing full stop.",
      messages: [{ role: "user", content: brief }],
    });
    if (message.stop_reason === "refusal") return null;
    const hook = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .replace(/^["'“”]+|["'“”.]+$/g, "")
      .split(/\s+/)
      .slice(0, 9)
      .join(" ");
    return hook ? { hook } : null;
  } catch (e) {
    if (e instanceof Anthropic.APIError && (e.status === 402 || e.type === "billing_error")) {
      console.warn("[Worker] Hook line skipped: the Anthropic account is out of credit.");
    } else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.warn("[Worker] Hook line skipped: ANTHROPIC_API_KEY was rejected.");
    } else {
      console.warn("[Worker] Hook line skipped:", e?.message || e);
    }
    return null;
  }
}

/**
 * A message people can act on for an ElevenLabs error: out of credit, a
 * rejected key, busy, or a plain failure ("what" says which feature).
 */
export function elevenLabsError(status, detail, what) {
  const d = String(detail ?? "");
  if (status === 402 || /quota_exceeded|insufficient|credits?/i.test(d)) {
    return `${what} is paused: the ElevenLabs account is out of credit.`;
  }
  if (status === 401 || status === 403) return `${what} isn't available: the worker's ElevenLabs key was rejected.`;
  if (status === 429) return `${what} is busy right now. Please try again in a minute.`;
  return `${what} failed (ElevenLabs ${status}). Please try again.`;
}
