import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

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

type TranscriptWord = { text: string; start_ms: number; end_ms: number };
type IncomingTranscript = {
  storage_path?: unknown;
  provider?: unknown;
  model?: unknown;
  language?: unknown;
  words?: unknown;
};

const optionalString = (v: unknown) => (typeof v === "string" ? v.slice(0, 64) : null);

function cleanWords(words: unknown): TranscriptWord[] {
  if (!Array.isArray(words)) return [];
  return words
    .filter(
      (w): w is TranscriptWord =>
        !!w &&
        typeof w.text === "string" &&
        Number.isFinite(w.start_ms) &&
        Number.isFinite(w.end_ms),
    )
    .slice(0, 50_000)
    .map((w) => ({
      text: w.text.slice(0, 100),
      start_ms: Math.round(w.start_ms),
      end_ms: Math.round(w.end_ms),
    }));
}

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
          transcripts?: IncomingTranscript[];
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

        // Save newly transcribed source files. Only paths inside the job
        // owner's storage folder are accepted, and an existing transcript is
        // never overwritten, so the user's corrections are kept.
        if (Array.isArray(payload.transcripts) && job) {
          const rows = payload.transcripts
            .filter(
              (t) =>
                typeof t?.storage_path === "string" && t.storage_path.startsWith(`${job.user_id}/`),
            )
            .map((t) => ({
              user_id: job.user_id,
              storage_path: t.storage_path as string,
              provider: optionalString(t.provider),
              model: optionalString(t.model),
              language: optionalString(t.language),
              words: cleanWords(t.words),
            }));
          if (rows.length) {
            const { error: tErr } = await supabaseAdmin
              .from("transcripts")
              .upsert(rows, { onConflict: "user_id,storage_path", ignoreDuplicates: true });
            if (tErr) console.error("[render-webhook] Saving transcripts failed:", tErr.message);
          }
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
