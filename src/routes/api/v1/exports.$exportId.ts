import { createFileRoute } from "@tanstack/react-router";
import { endpoint, getExport } from "@/lib/api/v1.server";

// GET: an export's progress, and its download link once it's done.
export const Route = createFileRoute("/api/v1/exports/$exportId")({
  server: {
    handlers: {
      GET: endpoint("read", getExport),
    },
  },
});
