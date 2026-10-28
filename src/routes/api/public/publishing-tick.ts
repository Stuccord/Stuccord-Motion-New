import { createFileRoute } from "@tanstack/react-router";

/**
 * Called by the render worker once a minute, signed with
 * HMAC-SHA256(body, RENDER_WORKER_SECRET) in `x-stuccord-signature`.
 * Body: { at: ISO time }. Sends scheduled posts that are due to the worker,
 * finds finished TikTok posts, and updates view counts that are due.
 */
export const Route = createFileRoute("/api/public/publishing-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const { verifyWorkerSignature, dispatchDuePosts, resolvePendingPosts, syncPostStats } =
          await import("@/lib/publishing/dispatch.server");
        if (
          !(await verifyWorkerSignature(body, request.headers.get("x-stuccord-signature") ?? ""))
        ) {
          return new Response("Invalid signature", { status: 401 });
        }
        // Old ticks can't be sent again.
        let at = NaN;
        try {
          at = Date.parse((JSON.parse(body) as { at?: string }).at ?? "");
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!(Math.abs(Date.now() - at) < 5 * 60 * 1000)) {
          return new Response("Stale tick", { status: 400 });
        }
        if (!process.env.PUBLISHING_TOKEN_KEY?.trim())
          return Response.json({ ok: true, sent: 0, stats: 0 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let sent = 0;
        let stats = 0;
        try {
          sent = await dispatchDuePosts(supabaseAdmin);
        } catch (e) {
          console.error(
            "[publishing-tick] Sending posts failed:",
            e instanceof Error ? e.message : e,
          );
        }
        try {
          await resolvePendingPosts(supabaseAdmin);
        } catch (e) {
          console.error(
            "[publishing-tick] TikTok checks failed:",
            e instanceof Error ? e.message : e,
          );
        }
        try {
          stats = await syncPostStats(supabaseAdmin);
        } catch (e) {
          console.error("[publishing-tick] Stats failed:", e instanceof Error ? e.message : e);
        }
        return Response.json({ ok: true, sent, stats });
      },
    },
  },
});
