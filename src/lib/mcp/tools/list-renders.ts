import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { RENDER_JOB_COLUMNS, supabaseForUser, withDownloadUrls } from "../supabase";

export default defineTool({
  name: "list_renders",
  title: "List renders",
  description:
    "List the signed-in user's recent render jobs across all projects, most recent first. Returns id, project_id, status, progress, stage_message, error, output_path, timestamps, and a 1-hour download_url for completed renders.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Max render jobs to return."),
    status: z
      .enum(["queued", "transcribing", "planning", "rendering", "completed", "failed"])
      .optional()
      .describe(
        "Optional status filter. queued/transcribing/planning/rendering are in progress; completed and failed are final.",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("render_jobs")
      .select(RENDER_JOB_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const renders = await withDownloadUrls(sb, data ?? []);
    return {
      content: [{ type: "text", text: JSON.stringify(renders) }],
      structuredContent: { renders },
    };
  },
});
