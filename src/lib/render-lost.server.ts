// An export the render worker lost: the worker restarted partway through
// (most often it ran out of memory on the final pass), so nothing will
// ever report the job finished or failed, and it would show "rendering"
// for good. While a render runs, the worker reports at least once a minute
// (a heartbeat to /api/public/render-webhook when there's no other news),
// so a running export that has been quiet for RENDER_LOST_MS has stopped.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;
type JobStatus = Database["public"]["Enums"]["job_status"];

export const RUNNING_JOB_STATUSES: JobStatus[] = [
  "queued",
  "transcribing",
  "planning",
  "rendering",
];

/** Quiet this long while running (heartbeats are a minute apart): lost. */
export const RENDER_LOST_MS = 5 * 60 * 1000;

export const RENDER_LOST_TEXT =
  "The renderer restarted partway through the export, so it stopped. Try exporting again.";

/** Running, but the worker hasn't reported for RENDER_LOST_MS. */
export function isRenderLost(
  job: { status: string; updated_at: string } | null | undefined,
  now = Date.now(),
): boolean {
  if (!job || !RUNNING_JOB_STATUSES.includes(job.status as JobStatus)) return false;
  const t = Date.parse(job.updated_at);
  return Number.isFinite(t) && now - t > RENDER_LOST_MS;
}

/**
 * Marks a lost export failed (and its project), so the pages say so instead
 * of waiting for ever. Only while it's still running and quiet: a report
 * that arrived in the meantime wins. Returns whether it was marked.
 */
export async function failLostRender(db: Db, jobId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - RENDER_LOST_MS).toISOString();
  const { data, error } = await db
    .from("render_jobs")
    .update({ status: "failed", error: RENDER_LOST_TEXT })
    .eq("id", jobId)
    .in("status", RUNNING_JOB_STATUSES)
    .lt("updated_at", cutoff)
    .select("project_id");
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return false;
  console.warn(`[render] Job ${jobId} went quiet while running: marked failed (worker restarted?)`);
  await db
    .from("projects")
    .update({ status: "failed" })
    .eq("id", row.project_id)
    .eq("status", "processing");
  return true;
}
