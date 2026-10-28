import { createFileRoute } from "@tanstack/react-router";

/**
 * The render worker reports each upload here, signed like the render webhook.
 * Body: { post_id, status: "uploading" | "published" | "failed",
 *         external_id?, external_url?, error? }
 */
export const Route = createFileRoute("/api/public/publish-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const { verifyWorkerSignature, recordPublishResult } =
          await import("@/lib/publishing/dispatch.server");
        if (
          !(await verifyWorkerSignature(body, request.headers.get("x-stuccord-signature") ?? ""))
        ) {
          return new Response("Invalid signature", { status: 401 });
        }
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          await recordPublishResult(supabaseAdmin, payload);
        } catch (e) {
          return new Response(e instanceof Error ? e.message : "Failed", { status: 400 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
