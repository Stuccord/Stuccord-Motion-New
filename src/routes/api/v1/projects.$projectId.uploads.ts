import { createFileRoute } from "@tanstack/react-router";
import { createUpload, endpoint } from "@/lib/api/v1.server";

// POST { filename, content_type, size }: a link to upload a file to.
export const Route = createFileRoute("/api/v1/projects/$projectId/uploads")({
  server: {
    handlers: {
      POST: endpoint("full", createUpload, 201),
    },
  },
});
