// Studio voice (AI voice isolation, see noise-removal.ts): the monthly
// allowance, and the isolated voices already made. A recording is isolated
// once (the render worker saves the answer next to it, isolatedVoicePath)
// and reused by every export and preview after that, so it's counted once:
// one voice_isolation_usage row per recording, written when it's first
// asked for.

import { isAppOwner } from "@/lib/owner.server";
import { STUDIO_VOICE_MONTHLY_SECONDS, isolatedVoicePath } from "@/lib/noise-removal";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function monthStartIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Seconds of Studio voice used this month, and the allowance (null: no limit, the app's owner). */
export async function studioVoiceUsage(
  userId: string,
): Promise<{ usedSeconds: number; limitSeconds: number | null }> {
  const db = await admin();
  const { data, error } = await db
    .from("voice_isolation_usage")
    .select("seconds")
    .eq("user_id", userId)
    .gte("created_at", monthStartIso());
  if (error) throw new Error(error.message);
  const usedSeconds = (data ?? []).reduce((s, r) => s + (r.seconds ?? 0), 0);
  return { usedSeconds, limitSeconds: isAppOwner(userId) ? null : STUDIO_VOICE_MONTHLY_SECONDS };
}

/** A recording's isolated voice, if it's been made: a link to it (good for `seconds`). */
export async function isolatedVoiceLink(path: string, seconds: number): Promise<string | null> {
  const db = await admin();
  const { data } = await db.storage
    .from("raw-clips")
    .createSignedUrl(isolatedVoicePath(path), seconds);
  return data?.signedUrl ?? null;
}

/** Where the worker saves a recording's isolated voice. */
export async function isolatedVoiceUpload(path: string): Promise<string | null> {
  const db = await admin();
  const { data } = await db.storage
    .from("raw-clips")
    .createSignedUploadUrl(isolatedVoicePath(path), { upsert: true });
  return data?.signedUrl ?? null;
}

/**
 * Which of these recordings may be isolated for this person: ones already
 * paid for (by anyone: the answer is shared) cost nothing more; new ones
 * are counted now, while the month's allowance lasts. Returns the
 * recordings allowed, and the ones left out because the minutes ran out.
 */
export async function claimIsolation(
  userId: string,
  projectId: string,
  recordings: { path: string; seconds: number }[],
): Promise<{ allowed: Set<string>; over: string[] }> {
  const allowed = new Set<string>();
  const over: string[] = [];
  if (!recordings.length) return { allowed, over };
  const db = await admin();
  const { data: paid, error } = await db
    .from("voice_isolation_usage")
    .select("storage_path")
    .in(
      "storage_path",
      recordings.map((r) => r.path),
    );
  if (error) throw new Error(error.message);
  const already = new Set((paid ?? []).map((r) => r.storage_path));
  const usage = await studioVoiceUsage(userId);
  const limitSeconds = usage.limitSeconds;
  let usedSeconds = usage.usedSeconds;
  for (const r of recordings) {
    if (already.has(r.path)) {
      allowed.add(r.path);
      continue;
    }
    const seconds = Math.max(1, Math.ceil(r.seconds));
    if (limitSeconds != null && usedSeconds + seconds > limitSeconds) {
      over.push(r.path);
      continue;
    }
    const { error: iErr } = await db.from("voice_isolation_usage").insert({
      user_id: userId,
      project_id: projectId,
      storage_path: r.path,
      seconds,
    });
    if (iErr) throw new Error(iErr.message);
    usedSeconds += seconds;
    already.add(r.path);
    allowed.add(r.path);
  }
  return { allowed, over };
}
