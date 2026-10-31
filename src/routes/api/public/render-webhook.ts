import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { saveIncomingTranscripts } from "@/lib/transcripts.server";

import { workerSecret } from "@/lib/worker-secret";
/**
 * Render worker callback. The external worker POSTs progress updates and
 * the final result here. Signed with HMAC-SHA256(body, RENDER_WORKER_SECRET)
 * in the `x-stuccord-signature` header.
 *
 * Body shape:
 *  { job_id, status, progress?, stage_message?, output_path?, edit_plan?, error?,
 *    transcripts? }
 *
 * transcripts: newly transcribed source files,
 *  [{ storage_path, provider?, model?, language?, words: [{ text, start_ms, end_ms }] }]
 */

export const Route = createFileRoute("/api/public/render-webhook")({
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

        let payload: {
          job_id: string;
          status: "queued" | "transcribing" | "planning" | "rendering" | "completed" | "failed";
          progress?: number;
          stage_message?: string;
          output_path?: string;
          edit_plan?: unknown;
          error?: string;
          transcripts?: unknown;
        };
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!payload.job_id || !payload.status) {
          return new Response("Missing fields", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const jobPatch = {
          status: payload.status,
          ...(typeof payload.progress === "number" ? { progress: payload.progress } : {}),
          ...(payload.stage_message !== undefined ? { stage_message: payload.stage_message } : {}),
          ...(payload.error !== undefined ? { error: payload.error } : {}),
          ...(payload.edit_plan !== undefined ? { edit_plan: payload.edit_plan as never } : {}),
          ...(payload.output_path ? { output_path: payload.output_path } : {}),
        };

        const { data: job, error: jErr } = await supabaseAdmin
          .from("render_jobs")
          .update(jobPatch)
          .eq("id", payload.job_id)
          .select("project_id, user_id")
          .single();
        if (jErr) return new Response(jErr.message, { status: 500 });

        // Save newly transcribed source files (kept even if the render
        // fails later; never overwriting the user's corrections).
        if (payload.transcripts !== undefined && job) {
          await saveIncomingTranscripts(
            supabaseAdmin,
            job.project_id,
            job.user_id,
            payload.transcripts,
          );
        }

        // Map to project status
        let projectPatch:
          | { status: "ready"; output_path?: string }
          | { status: "failed" }
          | { status: "processing" }
          | null = null;
        if (payload.status === "completed") {
          projectPatch = { status: "ready", ...(payload.output_path ? { output_path: payload.output_path } : {}) };
        } else if (payload.status === "failed") {
          projectPatch = { status: "failed" };
        } else if (["transcribing", "planning", "rendering"].includes(payload.status)) {
          projectPatch = { status: "processing" };
        }
        if (projectPatch && job) {
          await supabaseAdmin.from("projects").update(projectPatch).eq("id", job.project_id);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
