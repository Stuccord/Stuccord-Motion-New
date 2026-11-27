// The editor's cleaned voice (see noise-removal.ts): which recordings have
// theirs saved for a setting, and asking the render worker (/clean-voice)
// for the missing ones, in the background, once per file and setting per
// server every ASK_AGAIN_MS (another tab or a refresh doesn't ask again).

import { cleanVoicePath, isolatedVoicePath, type NoiseMode } from "@/lib/noise-removal";

/** Asked again while it's still missing (one the worker lost to a restart). */
const ASK_AGAIN_MS = 4 * 60 * 1000;
/** After an ask that didn't get through (the worker asleep or restarting). */
const RETRY_SOON_MS = 30 * 1000;
/** An older worker without /clean-voice: not asked again for this long. */
const REFUSED_MS = 60 * 60 * 1000;
const asked = new Map<string, number>();
const refused = new Map<string, number>();

async function storage() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin.storage.from("raw-clips");
}

/**
 * Starts making one recording's cleaned voice; never throws. Studio voice
 * also needs the isolated voice: a link to it when it's been made, else
 * where the worker saves it once it has.
 */
async function requestCleanVoice(
  path: string,
  mode: Exclude<NoiseMode, "off">,
  isolated?: { url: string | null; upload: string | null },
): Promise<void> {
  const key = cleanVoicePath(path, mode);
  if (Date.now() - (asked.get(key) ?? 0) < ASK_AGAIN_MS) return;
  asked.set(key, Date.now());
  try {
    const { workerSecret } = await import("@/lib/worker-secret");
    const secret = workerSecret();
    if (!secret || !process.env.RENDER_WORKER_URL?.trim()) {
      refused.set(key, Date.now() + REFUSED_MS);
      return;
    }
    const { hmacHex, workerEndpoint } = await import("@/lib/motion-plan.functions");
    const s = await storage();
    const [{ data: source }, { data: upload }] = await Promise.all([
      s.createSignedUrl(path, 60 * 60 * 2),
      s.createSignedUploadUrl(key, { upsert: true }),
    ]);
    if (!source?.signedUrl || !upload?.signedUrl) return;
    const body = JSON.stringify({
      path,
      mode,
      source_url: source.signedUrl,
      upload_url: upload.signedUrl,
      ...(isolated?.url ? { isolated_url: isolated.url } : {}),
      ...(isolated?.upload && !isolated.url ? { isolate_upload_url: isolated.upload } : {}),
    });
    const res = await fetch(workerEndpoint("clean-voice").toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stuccord-signature": await hmacHex(secret, body),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 202) {
      console.warn(`[clean-voice] The worker didn't take ${key}: HTTP ${res.status}`);
      // An older worker (404): the editor plays the sound as recorded.
      if (res.status === 404) refused.set(key, Date.now() + REFUSED_MS);
      else asked.set(key, Date.now() - ASK_AGAIN_MS + RETRY_SOON_MS);
    }
  } catch (e) {
    asked.set(key, Date.now() - ASK_AGAIN_MS + RETRY_SOON_MS);
    console.warn(`[clean-voice] Couldn't ask for ${key}:`, e);
  }
}

/**
 * The saved cleaned voices for the recordings at a setting (links by
 * recording path), and how many are still being made (asked for now).
 */
export async function cleanVoices(
  paths: string[],
  mode: Exclude<NoiseMode, "off">,
  studio?: { userId: string; projectId: string; seconds: Record<string, number> },
): Promise<{
  urls: Record<string, string>;
  waiting: number;
  unavailable: number;
  /** Studio voice: recordings left out because the month's minutes ran out. */
  overAllowance: number;
}> {
  const s = await storage();
  const urls: Record<string, string> = {};
  let waiting = 0;
  let unavailable = 0;
  const missing: string[] = [];
  for (const path of paths) {
    const key = cleanVoicePath(path, mode);
    const { data } = await s.createSignedUrl(key, 3600);
    if (data?.signedUrl) urls[path] = data.signedUrl;
    else if ((refused.get(key) ?? 0) > Date.now()) unavailable++;
    else missing.push(path);
  }
  if (mode !== "studio") {
    for (const path of missing) void requestCleanVoice(path, mode);
    return { urls, waiting: missing.length, unavailable, overAllowance: 0 };
  }
  // Studio voice: only within the month's allowance (counted once per recording).
  if (!studio || !missing.length) {
    return { urls, waiting: 0, unavailable: unavailable + missing.length, overAllowance: 0 };
  }
  const { claimIsolation, isolatedVoiceLink, isolatedVoiceUpload } =
    await import("@/lib/studio-voice.server");
  const { allowed, over } = await claimIsolation(
    studio.userId,
    studio.projectId,
    missing.map((p) => ({ path: p, seconds: studio.seconds[p] ?? 60 })),
  );
  for (const path of missing) {
    if (!allowed.has(path)) continue;
    waiting++;
    const url = await isolatedVoiceLink(path, 60 * 60 * 2);
    void requestCleanVoice(path, mode, {
      url,
      upload: url ? null : await isolatedVoiceUpload(path),
    });
  }
  return { urls, waiting, unavailable, overAllowance: over.length };
}

/** Removes the recordings' saved cleaned voices (their files are going); never throws. */
export async function removeCleanVoices(paths: string[]): Promise<void> {
  try {
    const s = await storage();
    const all = paths.flatMap((p) => [
      ...(["auto", "light", "strong", "studio"] as const).map((m) => cleanVoicePath(p, m)),
      isolatedVoicePath(p),
    ]);
    if (all.length) await s.remove(all);
  } catch (e) {
    console.warn("[clean-voice] Couldn't remove cleaned voices:", e);
  }
}
