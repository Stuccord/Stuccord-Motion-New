// Error monitoring (Sentry). On only when SENTRY_DSN is set; without it every
// call here does nothing, so the worker runs exactly as before.
//
// Sends errors only: no performance tracing, no request bodies, no personal
// details (dataCollection below). Failures are tagged with what was running
// (render, transcribe, auto edit) and its job or project id.
import * as Sentry from "@sentry/node";

const dsn = (process.env.SENTRY_DSN ?? "").trim();

export const sentryOn = Boolean(dsn);

if (sentryOn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    // Render sets this to the deployed commit.
    release: process.env.RENDER_GIT_COMMIT || undefined,
    serverName: "render-worker",
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
    initialScope: { tags: { service: "worker" } },
  });
  console.log("[Worker] Error monitoring on (Sentry)");
}

/**
 * Report a failure. `task` names what was running ("render", "transcribe",
 * "auto-edit"); `extra` holds ids that help find it (job_id, project_id).
 */
export function reportError(err, task, extra = {}) {
  if (!sentryOn) return;
  Sentry.withScope((scope) => {
    scope.setTag("task", task);
    for (const [k, v] of Object.entries(extra)) if (v != null) scope.setTag(k, String(v));
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/** Wait (briefly) for queued reports to go out, e.g. before the process exits. */
export async function flushErrors(ms = 2000) {
  if (sentryOn) await Sentry.flush(ms).catch(() => {});
}
