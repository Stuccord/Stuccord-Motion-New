import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { workerSecret } from "@/lib/worker-secret";

/**
 * The render worker drives the automatic edit (src/lib/auto-edit-run.server.ts)
 * by calling this again and again, for the main steps and for the music.
 * Signed with HMAC-SHA256(body, RENDER_WORKER_SECRET) in the
 * `x-stuccord-signature` header, like the other worker callbacks.
 *
 * Body: { project_id, run, lane: "main" | "music" }
 * Answer: { wait_ms } (call again after that long) or { done: true } (stop).
 * An error (5xx) means: try again shortly.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/auto-edit-step")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = workerSecret();
        if (!secret) return new Response("Worker not configured", { status: 503 });

        const signature = request.headers.get("x-stuccord-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let p: { project_id?: unknown; run?: unknown; lane?: unknown };
        try {
          p = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const projectId = typeof p.project_id === "string" ? p.project_id : "";
        const run = typeof p.run === "string" ? p.run : "";
        if (!UUID.test(projectId) || !UUID.test(run) || (p.lane !== "main" && p.lane !== "music")) {
          return new Response("Missing fields", { status: 400 });
        }

        const { autoEditTick } = await import("@/lib/auto-edit-run.server");
        try {
          const result = await autoEditTick(projectId, run, p.lane);
          return Response.json(result);
        } catch (e) {
          console.error(
            `[auto-edit] Step failed (project=${projectId}, ${p.lane}):`,
            e instanceof Error ? e.message : e,
          );
          return Response.json({ error: "step failed" }, { status: 500 });
        }
      },
    },
  },
});
