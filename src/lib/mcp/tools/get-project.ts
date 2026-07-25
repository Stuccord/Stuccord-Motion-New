import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_project",
  title: "Get project",
  description:
    "Fetch a single Stuccord project by id, including its clips and latest render jobs. Only returns rows the signed-in user owns.",
  inputSchema: {
    project_id: z.string().uuid().describe("Project UUID."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    const [{ data: project, error: pErr }, { data: clips }, { data: jobs }] = await Promise.all([
      sb.from("projects").select("*").eq("id", project_id).maybeSingle(),
      sb.from("clips").select("*").eq("project_id", project_id).order("ordinal"),
      sb
        .from("render_jobs")
        .select("id, status, created_at, updated_at, output_url")
        .eq("project_id", project_id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    if (pErr) return { content: [{ type: "text", text: pErr.message }], isError: true };
    if (!project)
      return { content: [{ type: "text", text: "Project not found" }], isError: true };
    const payload = { project, clips: clips ?? [], render_jobs: jobs ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
