// Error monitoring in the browser (Sentry). On only when VITE_SENTRY_DSN is
// set at build time; without it Sentry's code is never even downloaded.
//
// Loaded after the page shows, so it costs nothing on first paint. Errors
// that happen before it's ready are queued and sent once it is. Errors only:
// no performance tracing, no session replays, no personal details.
type SentryModule = typeof import("./sentry-sdk");

const dsn = (import.meta.env.VITE_SENTRY_DSN ?? "").trim();
let sentry: SentryModule | null = null;
let loading = false;
const queued: { error: unknown; context: Record<string, unknown> }[] = [];
let userId: string | null = null;

/** Start Sentry once, in the browser (src/routes/__root.tsx). */
export function initClientSentry(): void {
  if (!dsn || loading || typeof window === "undefined") return;
  loading = true;
  void import("./sentry-sdk")
    .then((S) => {
      S.init({
        dsn,
        environment: import.meta.env.MODE,
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
        initialScope: { tags: { service: "browser" } },
        // Noise from browser extensions and dropped connections, not the app.
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications",
          "Failed to fetch",
          "NetworkError when attempting to fetch resource",
          "Load failed",
        ],
        denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//],
      });
      sentry = S;
      if (userId) S.setUser({ id: userId });
      for (const q of queued.splice(0)) send(q.error, q.context);
    })
    .catch(() => {
      // Blocked by an ad blocker or offline: the app runs on without it.
    });
}

function send(error: unknown, context: Record<string, unknown>) {
  sentry?.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
    sentry?.captureException(error);
  });
}

/** Report an error a page caught itself (error screens). */
export function reportClientError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!dsn || typeof window === "undefined") return;
  if (sentry) send(error, context);
  else if (queued.length < 20) queued.push({ error, context });
}

/** Tie later errors to a signed-in account by its id only (never the email). */
export function setSentryUser(id: string | null): void {
  userId = id;
  sentry?.setUser(id ? { id } : null);
}
