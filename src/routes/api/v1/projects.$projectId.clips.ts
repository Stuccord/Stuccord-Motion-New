import { createFileRoute } from "@tanstack/react-router";
import { addClip, endpoint } from "@/lib/api/v1.server";

// POST { path, filename?, track?, duration_ms?, start_ms? }: an uploaded file onto the timeline.
export const Route = createFileRoute("/api/v1/projects/$projectId/clips")({
  server: {
    handlers: {
      POST: endpoint("full", addClip, 201),
    },
  },
});
