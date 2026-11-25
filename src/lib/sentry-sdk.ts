// The only parts of Sentry the browser uses, imported by name so the bundle
// leaves out the rest (session replay, the feedback widget, tracing).
// Loaded on demand by src/lib/sentry-browser.ts.
export { init, captureException, withScope, setUser } from "@sentry/react";
