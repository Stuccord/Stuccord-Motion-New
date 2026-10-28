import { createFileRoute } from "@tanstack/react-router";
import { endpoint, startExport } from "@/lib/api/v1.server";

// POST { captions?, music?, music_volume? }: start a cloud export.
export const Route = createFileRoute("/api/v1/projects/$projectId/exports")({
  server: {
    handlers: {
      POST: endpoint("full", startExport, 202),
    },
  },
});
