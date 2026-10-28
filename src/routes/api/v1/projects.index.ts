import { createFileRoute } from "@tanstack/react-router";
import { createProject, endpoint, listProjects } from "@/lib/api/v1.server";

// GET: your projects. POST { title, aspect_ratio? }: a new project.
export const Route = createFileRoute("/api/v1/projects/")({
  server: {
    handlers: {
      GET: endpoint("read", listProjects),
      POST: endpoint("full", createProject, 201),
    },
  },
});
