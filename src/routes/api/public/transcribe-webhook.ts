import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { saveIncomingTranscripts } from "@/lib/transcripts.server";

/**
 * Render worker callback for a Transcribe run (planning graphics before an
 * export; see transcribeForPlan in src/lib/motion-plan.functions.ts).
 * Signed with HMAC-SHA256(body, RENDER_WORKER_SECRET) in the
 * `x-stuccord-signature` header, like the render webhook.
 *
 * Body shape:
 *  { project_id, user_id, status: "done" | "failed", error?, transcripts? }
 *
 * transcripts: [{ storage_path, provider?, model?, language?, words: [{ text, start_ms, end_ms }] }]
 * Some files can be saved even when the run failed part-way.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/transcribe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
        if (!secret) return new Response("Worker not configured", { status: 503 });

        const signature = request.headers.get("x-stuccord-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: {
          project_id?: unknown;
          user_id?: unknown;
          status?: unknown;
          error?: unknown;
          transcripts?: unknown;
        };
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const projectId = typeof payload.project_id === "string" ? payload.project_id : "";
        const userId = typeof payload.user_id === "string" ? payload.user_id : "";
        if (!UUID.test(projectId) || !UUID.test(userId)) {
          return new Response("Missing fields", { status: 400 });
        }
        if (payload.status !== "done" && payload.status !== "failed") {
          return new Response("Unknown status", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await saveIncomingTranscripts(supabaseAdmin, projectId, userId, payload.transcripts);

        const error =
          payload.status === "failed"
            ? typeof payload.error === "string" && payload.error.trim()
              ? payload.error.slice(0, 500)
              : "Transcribing failed."
            : null;
        const { error: pErr } = await supabaseAdmin
          .from("projects")
          .update({ transcribe_status: payload.status, transcribe_error: error })
          .eq("id", projectId);
        if (pErr) return new Response(pErr.message, { status: 500 });

        return Response.json({ ok: true });
      },
    },
  },
});
