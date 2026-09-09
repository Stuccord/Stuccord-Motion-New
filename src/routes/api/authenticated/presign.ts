import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * GET /api/authenticated/presign
 * Generates signed upload and download URLs for Supabase Storage objects.
 *
 * Query params:
 *   - bucket   : storage bucket name (required, e.g. "raw-clips" or "renders")
 *   - filename : object key/path inside the bucket (required)
 *   - type     : "upload" | "download" (optional, default = "upload")
 */
export const Route = createFileRoute("/api/authenticated/presign")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // 1. Verify user authentication via Supabase session
        const {
          data: { user },
        } = await supabaseAdmin.auth.getUser();
        if (!user) {
          return new Response("Unauthenticated", { status: 401 });
        }

        // 2. Extract and validate query parameters
        const url = new URL(request.url);
        const bucket = url.searchParams.get("bucket");
        const filename = url.searchParams.get("filename");
        const type = (url.searchParams.get("type") ?? "upload") as
          | "upload"
          | "download";

        if (!bucket || !filename) {
          return new Response("Missing bucket or filename parameter", {
            status: 400,
          });
        }

        // 3. Generate signed URLs
        const responsePayload: { uploadUrl?: string; downloadUrl?: string } = {};

        if (type === "upload") {
          const { data: uploadData, error: uploadErr } =
            await supabaseAdmin.storage
              .from(bucket)
              .createSignedUploadUrl(filename);

          if (uploadErr) {
            return new Response(uploadErr.message, { status: 500 });
          }
          if (uploadData?.signedUrl) {
            responsePayload.uploadUrl = uploadData.signedUrl;
          }
        }

        // Always provide a signed download URL (1 hour expiry / 3600 seconds)
        const { data: downloadData, error: downloadErr } =
          await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrl(filename, 3600);

        if (downloadErr && type === "download") {
          return new Response(downloadErr.message, { status: 500 });
        }
        if (downloadData?.signedUrl) {
          responsePayload.downloadUrl = downloadData.signedUrl;
        }

        // 4. Return signed URLs
        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

