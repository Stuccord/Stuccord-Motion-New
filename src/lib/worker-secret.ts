// The secret the app and the render worker sign their requests with
// (RENDER_WORKER_SECRET). Read the same way on both sides (render-worker/
// server.js): surrounding spaces and quotes, easy to paste by accident into
// a host's settings, are ignored.

/** The shared secret; "" when it isn't set. */
export function workerSecret(): string {
  return (process.env.RENDER_WORKER_SECRET ?? "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();
}

/** What to tell people when the worker refuses a request's signature (HTTP 401). */
export const WORKER_SECRET_MISMATCH =
  "The app and the render worker have different RENDER_WORKER_SECRET values. Set exactly the same value on both services, then redeploy both.";
