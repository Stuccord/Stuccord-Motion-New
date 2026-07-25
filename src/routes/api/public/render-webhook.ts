import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Render worker callback. The external worker POSTs progress updates and
 * the final result here. Signed with HMAC-SHA256(body, RENDER_WORKER_SECRET)
 * in the `x-stuccord-signature` header.
 *
 * Body shape:
 *  { job_id, status, progress?, stage_message?, output_path?, edit_plan?, error? }
 */
export const Route = createFileRoute("/api/public/render-webhook")({
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
          job_id: string;
          status: "queued" | "transcribing" | "planning" | "rendering" | "completed" | "failed";
          progress?: number;
          stage_message?: string;
          output_path?: string;
          edit_plan?: unknown;
          error?: string;
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
          .select("project_id")
          .single();
        if (jErr) return new Response(jErr.message, { status: 500 });

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
