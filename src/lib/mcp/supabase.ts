import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Supabase client acting as the MCP caller, so Row Level Security limits every
 * query to their own rows. Typed against the generated schema so a wrong
 * column or status value fails the build instead of the tool call. Falls back
 * to the VITE_ variables, which are the ones set in production (render.yaml).
 */
export function supabaseForUser(ctx: ToolContext): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Server configuration error: missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  }
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const RENDER_JOB_COLUMNS =
  "id, project_id, status, progress, stage_message, error, output_path, created_at, updated_at";

const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * Adds a short-lived `download_url` to each completed render with an output
 * file (null otherwise). Signed as the caller, so storage policies apply.
 */
export async function withDownloadUrls<T extends { status: string; output_path: string | null }>(
  sb: SupabaseClient<Database>,
  jobs: T[],
): Promise<(T & { download_url: string | null })[]> {
  return Promise.all(
    jobs.map(async (job) => {
      if (job.status !== "completed" || !job.output_path) return { ...job, download_url: null };
      const { data } = await sb.storage
        .from("renders")
        .createSignedUrl(job.output_path, DOWNLOAD_URL_TTL_SECONDS);
      return { ...job, download_url: data?.signedUrl ?? null };
    }),
  );
}
