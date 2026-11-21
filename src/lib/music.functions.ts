// AI music for a project: checks the monthly allowance (the app's owner has
// none), asks the render worker for a track matched to the video's look and
// length (ElevenLabs Music), saves it in the project's folder and puts it on
// the music track. Used by the automatic edit and the editor's music panel.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { WORKER_SECRET_MISMATCH, workerSecret } from "@/lib/worker-secret";
import { AI_MUSIC_MONTHLY_TRACKS, musicLengthMs, musicPrompt } from "@/lib/ai-music";
import { MOTION_LOOK_IDS } from "@/motion/looks";

function monthStartUtc() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** The worker's /music address (RENDER_WORKER_URL may end in /jobs). */
function workerMusicUrl(): URL {
  const raw = process.env.RENDER_WORKER_URL?.trim();
  if (!raw) throw new Error("AI music isn't set up yet");
  const url = new URL(raw);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] === "jobs") segments.pop();
  url.pathname = `/${[...segments, "music"].join("/")}`;
  return url;
}

/** Asks the worker for a track (signed like render jobs); returns the MP3's bytes. */
async function composeOnWorker(prompt: string, lengthMs: number): Promise<ArrayBuffer> {
  const secret = workerSecret();
  if (!secret) throw new Error("AI music isn't set up yet");
  const body = JSON.stringify({ prompt, length_ms: lengthMs });
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let res: Response;
  try {
    res = await fetch(workerMusicUrl().toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-stuccord-signature": sig },
      body,
      signal: AbortSignal.timeout(6 * 60 * 1000),
    });
  } catch {
    throw new Error("Couldn't reach the music service; try again in a moment");
  }
  if (res.status === 401) throw new Error(WORKER_SECRET_MISMATCH);
  if (res.status === 404) throw new Error("AI music isn't available yet: the render worker needs updating");
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || "The music service couldn't do that");
  }
  const audio = await res.arrayBuffer();
  if (audio.byteLength < 1000) throw new Error("The music service sent back no sound");
  return audio;
}

/** Tracks made this month and the allowance (null: no limit, the app's owner). */
export const getAiMusicUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isAppOwner } = await import("@/lib/owner.server");
    const { count, error } = await context.supabase
      .from("music_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gte("created_at", monthStartUtc().toISOString());
    if (error) throw new Error(error.message);
    return { used: count ?? 0, limit: isAppOwner(context.userId) ? null : AI_MUSIC_MONTHLY_TRACKS };
  });

/**
 * Makes an AI track for the project and puts it on the music track (from
 * 0:00, under the whole video). `skip_if_music`: do nothing when the project
 * already has music (the automatic edit: the user's own song wins).
 */
export const makeAiMusic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        /** The video's look, which picks the style (the plan's look). */
        look: z.enum(MOTION_LOOK_IDS).nullable().optional(),
        /** Extra words from the user ("more upbeat", "add guitar"). */
        note: z.string().trim().max(300).optional(),
        skip_if_music: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { projectForEdit } = await import("@/lib/projects.functions");
    const { folder } = await projectForEdit(context.supabase, data.project_id, context.userId);

    const { data: clips, error: cErr } = await context.supabase
      .from("clips")
      .select("role, duration_ms, trim_in_ms, trim_out_ms")
      .eq("project_id", data.project_id);
    if (cErr) throw new Error(cErr.message);
    const musicCount = (clips ?? []).filter((c) => c.role === "music").length;
    if (data.skip_if_music && musicCount > 0) {
      return { made: false as const, reason: "has_music" as const };
    }

    // The video's length: its main clips one after another, as trimmed.
    const videoMs = (clips ?? [])
      .filter((c) => c.role === "auto" || c.role === "aroll")
      .reduce((n, c) => {
        const end = c.trim_out_ms ?? c.duration_ms ?? 0;
        return n + Math.max(0, end - (c.trim_in_ms ?? 0));
      }, 0);
    if (videoMs <= 0) throw new Error("Add your footage first: the music is made to its length.");
    const lengthMs = musicLengthMs(videoMs);

    // The monthly allowance (the app's owner has none).
    const { isAppOwner } = await import("@/lib/owner.server");
    const owner = isAppOwner(context.userId);
    const { count, error: uErr } = await context.supabase
      .from("music_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gte("created_at", monthStartUtc().toISOString());
    if (uErr) throw new Error(uErr.message);
    if (!owner && (count ?? 0) >= AI_MUSIC_MONTHLY_TRACKS) {
      throw new Error(
        `You've made all ${AI_MUSIC_MONTHLY_TRACKS} AI music tracks this month. It resets on the 1st; the built-in music and your own songs are unlimited.`,
      );
    }

    const prompt = [musicPrompt(data.look), data.note ? `Also: ${data.note}.` : ""]
      .filter(Boolean)
      .join(" ");

    // Counted before it's made (so two at once can't both pass); given back
    // if it fails. Users can only read this table, so the server writes it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: usage, error: iErr } = await supabaseAdmin
      .from("music_usage")
      .insert({ user_id: context.userId, project_id: data.project_id, length_ms: lengthMs, prompt })
      .select("id")
      .single();
    if (iErr) throw new Error(iErr.message);
    const giveBack = async () => {
      const { error } = await supabaseAdmin.from("music_usage").delete().eq("id", usage.id);
      if (error) console.error("[makeAiMusic] Couldn't give back the use:", error.message);
    };

    try {
      const audio = await composeOnWorker(prompt, lengthMs);
      const filename = "Music (AI).mp3";
      const path = `${folder}/${data.project_id}/${Date.now()}_music_ai.mp3`;
      const { error: upErr } = await context.supabase.storage
        .from("raw-clips")
        .upload(path, audio, { contentType: "audio/mpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);
      // On the music track from 0:00 (no start: it plays under the whole video).
      const { data: row, error: aErr } = await context.supabase
        .from("clips")
        .insert({
          project_id: data.project_id,
          user_id: context.userId,
          storage_path: path,
          filename,
          size_bytes: audio.byteLength,
          role: "music",
          ordinal: (clips ?? []).length,
          trim_in_ms: 0,
          duration_ms: lengthMs,
        })
        .select("id")
        .single();
      if (aErr) throw new Error(aErr.message);
      return { made: true as const, clip_id: row.id, length_ms: lengthMs };
    } catch (e) {
      await giveBack();
      throw e;
    }
  });
