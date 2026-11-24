// Problems on the app's side, not the customer's: an AI service out of
// credit, a key it rejected, a setting missing on the server, the render
// worker out of date. The app's own messages for these name the service and
// the setting (useful to the owner); customers see a calm, friendly line
// instead, and the owner gets an alert (service_alerts, shown in their
// notifications bell) with the real reason.
//
// Applied in one place for every server function (src/start.ts), and to the
// notes the automatic edit keeps and the errors the worker reports back.

export type ServiceProblem = {
  /** The service, as the owner knows it. */
  service: string;
  /** Which problem (one alert row per service and problem). */
  problem: "credit" | "key" | "setup" | "outdated";
  /** What the customer sees. */
  customer: string;
};

const BREAK = "is taking a short break. Please try again later.";

type Rule = { test: RegExp; service: string; problem: ServiceProblem["problem"]; customer: string };

// Most specific first; the first that matches wins.
const RULES: Rule[] = [
  // Higgsfield (story pictures and clips)
  {
    test: /higgsfield.*(balance|credit)|(balance|credit).*higgsfield/i,
    service: "Higgsfield",
    problem: "credit",
    customer: `Our AI picture service ${BREAK}`,
  },
  {
    test: /higgsfield.*(api key|key is missing|HF_API_KEY)|HF_API_KEY/i,
    service: "Higgsfield",
    problem: "key",
    customer: `Our AI picture service ${BREAK}`,
  },
  // Gemini (story pictures, the fallback)
  {
    test: /GEMINI_API_KEY|Gemini key|image service is out of credit|image service didn't accept/i,
    service: "Gemini",
    problem: "key",
    customer: `Our AI picture service ${BREAK}`,
  },
  // Claude (planning, the speaker's look)
  {
    test: /AI account is out of credit/i,
    service: "Claude (Anthropic)",
    problem: "credit",
    customer: `AI planning ${BREAK}`,
  },
  {
    test: /ANTHROPIC_API_KEY|server's API key was rejected/i,
    service: "Claude (Anthropic)",
    problem: "key",
    customer: `AI planning ${BREAK}`,
  },
  // ElevenLabs (transcribing, music, voices: the worker's words)
  {
    test: /ElevenLabs account is out of credit/i,
    service: "ElevenLabs",
    problem: "credit",
    customer: `Our audio service ${BREAK}`,
  },
  {
    test: /ElevenLabs key was rejected|ELEVENLABS_API_KEY/i,
    service: "ElevenLabs",
    problem: "key",
    customer: `Our audio service ${BREAK}`,
  },
  // Publishing
  {
    test: /PUBLISHING_TOKEN_KEY/i,
    service: "Publishing",
    problem: "setup",
    customer: "Posting isn't available right now. Please try again later.",
  },
  // The render worker and the app's own settings
  {
    test: /RENDER_WORKER_SECRET values|different RENDER_WORKER_SECRET/i,
    service: "Render worker",
    problem: "key",
    customer: "Stuccord is being updated. Please try again in a few minutes.",
  },
  {
    test: /worker needs updating/i,
    service: "Render worker",
    problem: "outdated",
    customer: "Stuccord is being updated. Please try again in a few minutes.",
  },
  {
    test: /RENDER_WORKER_(SECRET|URL)|PUBLIC_APP_URL|SUPABASE_SERVICE_ROLE_KEY|is not configured|missing on the server|isn't set up/i,
    service: "App settings",
    problem: "setup",
    customer: "Stuccord is being updated. Please try again in a few minutes.",
  },
];

/** The owner-side problem in a message, or null when it's one for the customer. */
export function classifyProblem(text: string): ServiceProblem | null {
  for (const r of RULES) {
    if (r.test.test(text)) return { service: r.service, problem: r.problem, customer: r.customer };
  }
  return null;
}

// The same problem is recorded at most once a minute from one server.
const recent = new Map<string, number>();

/** Records the problem for the owner (best effort, never throws). */
export function reportProblem(p: ServiceProblem, message: string): void {
  console.error(`[service-alert] ${p.service} (${p.problem}): ${message}`);
  const key = `${p.service}:${p.problem}`;
  const now = Date.now();
  if (now - (recent.get(key) ?? 0) < 60_000) return;
  recent.set(key, now);
  void import("@/integrations/supabase/client.server")
    .then(({ supabaseAdmin }) =>
      supabaseAdmin.rpc("report_service_alert", {
        p_service: p.service,
        p_problem: p.problem,
        p_message: message,
      }),
    )
    .then((r) => {
      if (r?.error) console.warn("[service-alert] Couldn't record it:", r.error.message);
    })
    .catch((e) => console.warn("[service-alert] Couldn't record it:", e));
}

/** The words a customer sees for `text`: the friendly line (and the owner told) when it's on the app's side. */
export function friendlyText(text: string): string {
  const p = classifyProblem(text);
  if (!p) return text;
  reportProblem(p, text);
  return p.customer;
}

/** The same error, or a friendly one in its place when it's on the app's side. */
export function friendlyError(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  const p = classifyProblem(e.message);
  if (!p) return e;
  reportProblem(p, e.message);
  return new Error(p.customer);
}
