import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { IMAGE_MIME_TYPES } from "@/lib/media-kind";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  // Audio for the music / SFX tracks. Browsers report several names for the
  // same formats (e.g. MP3 as audio/mpeg or audio/mp3, WAV as audio/wav,
  // audio/x-wav or audio/wave), so accept each of them.
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  // Images (photos, screenshots) for the video tracks.
  ...IMAGE_MIME_TYPES,
]);

/**
 * POST /api/authenticated/uploads/presign
 * Generates a signed upload credential for uploading video, audio or image files
 * directly from the browser to private Supabase Storage ("raw-clips").
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
        const headerToken =
          authHeader && authHeader.startsWith("Bearer ")
            ? authHeader.replace("Bearer ", "").trim()
            : null;
        const hasHeaderToken =
          !!headerToken && headerToken !== "undefined" && headerToken !== "null";

        // Without a Bearer token, local dev may sign in as the real dev user
        // (see dev-mock-auth.server.ts); otherwise this is a strict 401.
        let token: string | null = hasHeaderToken ? headerToken : null;
        if (!token) {
          const { getDevMockAccessToken } = await import(
            "@/integrations/supabase/dev-mock-auth.server"
          );
          token = await getDevMockAccessToken();
        }

        let userId: string | null = null;
        if (token) {
          const { data, error } = await supabaseAdmin.auth.getUser(token);
          if (!error && data?.user) {
            userId = data.user.id;
          }
        }

        if (!userId) {
          return new Response("Unauthorized: Missing or invalid authorization token", {
            status: 401,
          });
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
            `Unsupported file type '${contentType}'. Upload MP4, MOV or WebM video, MP3, WAV, M4A, AAC or OGG audio, or JPG, PNG, WebP or GIF images.`,
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
