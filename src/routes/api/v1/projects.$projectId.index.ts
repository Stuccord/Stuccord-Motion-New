import { createFileRoute } from "@tanstack/react-router";
import { endpoint, getProject } from "@/lib/api/v1.server";

// GET: a project, its clips and its latest export.
export const Route = createFileRoute("/api/v1/projects/$projectId/")({
  server: {
    handlers: {
      GET: endpoint("read", getProject),
    },
  },
});
