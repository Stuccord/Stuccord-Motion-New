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
  name: "create_project",
  title: "Create project",
  description:
    "Create a new Stuccord video project for the signed-in user. Returns the new project id and title.",
  inputSchema: {
    title: z.string().trim().min(1).max(120).describe("Project title."),
    brief: z
      .string()
      .max(4000)
      .optional()
      .describe("Optional edit brief describing the desired cut, pacing, and vibe."),
    style_preset: z
      .string()
      .max(64)
      .default("gadzhi")
      .describe("Style preset id (e.g. gadzhi, cinematic, punchy)."),
    aspect_ratio: z
      .enum(["9:16", "16:9", "1:1"])
      .default("9:16")
      .describe("Output aspect ratio."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, brief, style_preset, aspect_ratio }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("projects")
      .insert({
        user_id: ctx.getUserId(),
        title,
        brief: brief ?? null,
        style_preset,
        aspect_ratio,
      })
      .select("id, title, status, aspect_ratio, style_preset, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Created project ${data.id} — "${data.title}"` }],
      structuredContent: { project: data },
    };
  },
});
