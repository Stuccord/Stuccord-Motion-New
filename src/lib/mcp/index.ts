import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjectsTool from "./tools/list-projects";
import getProjectTool from "./tools/get-project";
import createProjectTool from "./tools/create-project";
import listRendersTool from "./tools/list-renders";

// The OAuth issuer MUST be the direct Supabase host. On publish, SUPABASE_URL is
// rewritten to the `.lovable.cloud` proxy, which mcp-js rejects (RFC 8414 issuer
// mismatch). The project ref survives publish unchanged via VITE_SUPABASE_PROJECT_ID,
// inlined at build time by Vite. The fallback keeps the issuer well-formed during
// the throwaway manifest-extract eval; the published build inlines the real ref.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "stuccord-motion-mcp",
  title: "Stuccord Motion",
  version: "0.1.0",
  instructions:
    "Tools for the signed-in Stuccord Motion user's video projects. Use list_projects to browse, get_project for details (clips + render jobs), create_project to start a new one, and list_renders to check render status.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjectsTool, getProjectTool, createProjectTool, listRendersTool],
});
