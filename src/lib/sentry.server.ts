// Error monitoring on the app's server (Sentry). On only when SENTRY_DSN is
// set; without it everything here does nothing.
//
// Errors only: no performance tracing, no request bodies, no personal
// details (dataCollection below). The browser side is src/lib/sentry-browser.ts;
// the render worker has its own (render-worker/sentry.js).
import * as Sentry from "@sentry/node";

const dsn = (process.env.SENTRY_DSN ?? "").trim();
let started = false;

/** Start Sentry once, at server start (src/server.ts). */
export function initServerSentry(): void {
  if (started || !dsn) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    // Render sets this to the deployed commit.
    release: process.env.RENDER_GIT_COMMIT || undefined,
    // Collect the error and where it happened, nothing else: no cookies,
    // headers, request bodies, query strings, local variables, database queries
    // or AI prompts (transcripts), and no automatic user details.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    initialScope: { tags: { service: "app-server" } },
  });
}

/**
 * Errors that are part of normal use, not problems: not signed in, a form
 * that failed validation, and TanStack's redirects / not-found (not Errors).
 */
function isExpected(e: unknown): boolean {
  if (!(e instanceof Error)) return true;
  if (e.name === "ZodError") return true;
  return /^Unauthorized\b/.test(e.message);
}

/** Report a server error. `where` says which layer caught it. */
export function reportServerError(e: unknown, where: string, extra: Record<string, string> = {}) {
  if (!started || isExpected(e)) return;
  Sentry.withScope((scope) => {
    scope.setTag("where", where);
    for (const [k, v] of Object.entries(extra)) scope.setTag(k, v);
    Sentry.captureException(e);
  });
}
