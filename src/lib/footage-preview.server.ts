// Asks the render worker for a video's preview copy (see footage-preview.ts),
// in the background: once per file per server every PREVIEW_ASK_AGAIN_MS
// (another tab or a refresh doesn't ask again while it's being made).

import { footagePreviewPath, wantsFootagePreview } from "@/lib/footage-preview";

const PREVIEW_ASK_AGAIN_MS = 10 * 60 * 1000;
const asked = new Map<string, number>();

/** Starts making `path`'s preview copy if it's a video without one; never throws. */
export async function requestFootagePreview(path: string): Promise<void> {
  if (!wantsFootagePreview(path)) return;
  const last = asked.get(path) ?? 0;
  if (Date.now() - last < PREVIEW_ASK_AGAIN_MS) return;
  asked.set(path, Date.now());
  try {
    const { workerSecret } = await import("@/lib/worker-secret");
    const secret = workerSecret();
    if (!secret || !process.env.RENDER_WORKER_URL?.trim()) return;
    const { hmacHex, workerEndpoint } = await import("@/lib/motion-plan.functions");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const storage = admin.storage.from("raw-clips");
    const [{ data: source }, { data: upload }] = await Promise.all([
      storage.createSignedUrl(path, 60 * 60 * 2),
      storage.createSignedUploadUrl(footagePreviewPath(path), { upsert: true }),
    ]);
    if (!source?.signedUrl || !upload?.signedUrl) return;
    const body = JSON.stringify({
      path,
      source_url: source.signedUrl,
      upload_url: upload.signedUrl,
    });
    const res = await fetch(workerEndpoint("preview").toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stuccord-signature": await hmacHex(secret, body),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    // An older worker without /preview (404): the editor keeps the original.
    if (res.status !== 202) {
      console.warn(`[footage-preview] The worker didn't take ${path}: HTTP ${res.status}`);
      asked.set(path, Date.now() + PREVIEW_ASK_AGAIN_MS * 5);
    }
  } catch (e) {
    console.warn(`[footage-preview] Couldn't ask for ${path}'s preview copy:`, e);
  }
}
