import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

/**
 * POST /api/authenticated/uploads/presign
 * Generates a signed upload credential for uploading video files directly
 * from the browser to private Supabase Storage ("raw-clips").
 *
 * Expected Request Body:
 *   {
 *     "projectId": "uuid",
 *     "filename": "my-video.mp4",
 *     "contentType": "video/mp4",
 *     "size": 123456
 *   }
 *
 * Expected Response:
 *   {
 *     "bucket": "raw-clips",
 *     "path": "<user-id>/projects/<project-id>/clips/<unique-id>-my-video.mp4",
 *     "token": "<short-lived-upload-token>"
 *   }
 */
export const Route = createFileRoute("/api/authenticated/uploads/presign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Verify user authentication from Bearer token
        const authHeader = request.headers.get("authorization");
        const token =
          authHeader && authHeader.startsWith("Bearer ")
            ? authHeader.replace("Bearer ", "").trim()
            : null;

        let userId: string | null = null;

        if (token && token !== "undefined" && token !== "null") {
          const { data, error } = await supabaseAdmin.auth.getUser(token);
          if (!error && data?.user) {
            userId = data.user.id;
          }
        }

        const isDev = process.env.NODE_ENV !== "production";
        const isDevMockAuthEnabled = isDev && process.env.ENABLE_DEV_MOCK_AUTH === "true";

        if (!userId) {
          if (isDevMockAuthEnabled) {
            userId = process.env.DEV_MOCK_USER_ID || "623eb6d8-49c5-4f69-8abe-779d3b71811e";
          } else {
            return new Response("Unauthorized: Missing or invalid authorization token", {
              status: 401,
            });
          }
        }

        // 2. Parse request body
        let body: {
          projectId?: string;
          filename?: string;
          contentType?: string;
          size?: number;
        };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON payload", { status: 400 });
        }

        const { projectId, filename, contentType, size } = body;

        if (!projectId || !filename || !contentType || typeof size !== "number") {
          return new Response(
            "Missing required fields: projectId, filename, contentType, size",
            { status: 400 }
          );
        }

        // 3. Validate MIME type & file size
        if (!ALLOWED_MIME_TYPES.has(contentType)) {
          return new Response(
            `Unsupported file type '${contentType}'. Only MP4, MOV, and WebM videos are allowed.`,
            { status: 400 }
          );
        }

        if (size > MAX_FILE_SIZE) {
          return new Response("File size exceeds 500 MB limit", { status: 400 });
        }

        // 4. Verify project ownership
        const { data: project, error: pErr } = await supabaseAdmin
          .from("projects")
          .select("id")
          .eq("id", projectId)
          .eq("user_id", userId)
          .maybeSingle();

        if (pErr || !project) {
          return new Response("Project not found or access denied", {
            status: 404,
          });
        }

        // 5. Generate secure server-controlled storage path
        // Starts with userId to satisfy Supabase storage RLS policy:
        // auth.uid()::text = (storage.foldername(name))[1]
        const safeFilename = filename.replace(/[^\w.\-]+/g, "_");
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const storagePath = `${userId}/projects/${projectId}/clips/${uniqueId}-${safeFilename}`;

        // 6. Generate signed upload credential
        const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
          .from("raw-clips")
          .createSignedUploadUrl(storagePath);

        if (uploadErr || !uploadData) {
          return new Response(
            uploadErr?.message ?? "Failed to create signed upload URL",
            { status: 500 }
          );
        }

        // 7. Return safe credential payload
        return new Response(
          JSON.stringify({
            bucket: "raw-clips",
            path: storagePath,
            token: uploadData.token,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      },
    },
  },
});
