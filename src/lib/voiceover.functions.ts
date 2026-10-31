// AI voiceovers: the voices to pick from, the free plan's monthly allowance,
// and making one. The speech itself is made by the render worker (it holds
// the ElevenLabs key); the app checks the allowance, logs the use and saves
// the MP3 in the user's folder. The editor then puts it on the VO track.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { AI_VOICE_MONTHLY_CHARS } from "@/lib/ai-voice";
export { AI_VOICE_MONTHLY_CHARS };
/** Longest script in one go. */
export const AI_VOICE_MAX_CHARS = 2500;

export type AiVoice = {
  voice_id: string;
  name: string;
  category: string | null;
  labels: Record<string, string>;
  preview_url: string | null;
};

function monthStartUtc() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** The worker's address for one of its endpoints (RENDER_WORKER_URL may end in /jobs). */
function workerUrl(endpoint: "voices" | "tts"): URL {
  const raw = process.env.RENDER_WORKER_URL?.trim();
  if (!raw) throw new Error("AI voices aren't set up yet");
  const url = new URL(raw);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] === "jobs") segments.pop();
  url.pathname = `/${[...segments, endpoint].join("/")}`;
  return url;
}

/** Sends a signed request to the worker (signed like render jobs). */
async function callWorker(endpoint: "voices" | "tts", payload: unknown, timeoutMs: number) {
  const secret = process.env.RENDER_WORKER_SECRET?.trim();
  if (!secret) throw new Error("AI voices aren't set up yet");
  const body = JSON.stringify(payload);
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
    res = await fetch(workerUrl(endpoint).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-stuccord-signature": sig },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Couldn't reach the voice service; try again in a moment");
  }
  if (res.status === 404) {
    // A worker deployed before voiceovers.
    throw new Error("AI voices aren't available yet: the render worker needs updating");
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || "The voice service couldn't do that");
  }
  return res;
}

let voicesCache: { at: number; voices: AiVoice[] } | null = null;

export const listAiVoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    if (!voicesCache || Date.now() - voicesCache.at > 60 * 60 * 1000) {
      const res = await callWorker("voices", {}, 25_000);
      const j = (await res.json()) as { voices?: AiVoice[] };
      voicesCache = { at: Date.now(), voices: Array.isArray(j.voices) ? j.voices : [] };
    }
    return { voices: voicesCache.voices };
  });

/** Characters used this month and the allowance. */
export const getAiVoiceUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const start = monthStartUtc();
    const { data, error } = await context.supabase
      .from("tts_usage")
      .select("characters")
      .eq("user_id", context.userId)
      .gte("created_at", start.toISOString());
    if (error) throw new Error(error.message);
    const used = (data ?? []).reduce((n, r) => n + (r.characters ?? 0), 0);
    const resets = new Date(start);
    resets.setUTCMonth(resets.getUTCMonth() + 1);
    return { used, limit: AI_VOICE_MONTHLY_CHARS, resets_at: resets.toISOString() };
  });

/**
 * Makes an AI voiceover from a script and saves it in the user's folder.
 * Returns where it was saved; the editor adds it to the VO track.
 */
export const makeAiVoiceover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        text: z.string().trim().min(1).max(AI_VOICE_MAX_CHARS),
        voice_id: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
        voice_name: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Editors and up only; the file goes in the project's folder.
    const { projectForEdit } = await import("@/lib/projects.functions");
    const { folder } = await projectForEdit(context.supabase, data.project_id, context.userId);

    // The monthly allowance (counted in characters, like the voice service).
    const chars = data.text.length;
    const { data: rows, error: uErr } = await context.supabase
      .from("tts_usage")
      .select("characters")
      .eq("user_id", context.userId)
      .gte("created_at", monthStartUtc().toISOString());
    if (uErr) throw new Error(uErr.message);
    const used = (rows ?? []).reduce((n, r) => n + (r.characters ?? 0), 0);
    const left = Math.max(0, AI_VOICE_MONTHLY_CHARS - used);
    if (chars > left) {
      throw new Error(
        left === 0
          ? "You've used this month's AI voice. It resets on the 1st; recording your own voice is unlimited."
          : `That's ${chars} characters, and ${left} are left this month. Shorten the script, or record it yourself.`,
      );
    }

    // Counted before it's made (so two at once can't both pass); given back
    // if it fails. Users can only read this table, so the server writes it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: usage, error: iErr } = await supabaseAdmin
      .from("tts_usage")
      .insert({
        user_id: context.userId,
        project_id: data.project_id,
        characters: chars,
        voice_id: data.voice_id,
      })
      .select("id")
      .single();
    if (iErr) throw new Error(iErr.message);
    const giveBack = async () => {
      const { error } = await supabaseAdmin.from("tts_usage").delete().eq("id", usage.id);
      if (error) console.error("[makeAiVoiceover] Couldn't give back the use:", error.message);
    };

    try {
      const res = await callWorker("tts", { text: data.text, voice_id: data.voice_id }, 150_000);
      const audio = await res.arrayBuffer();
      if (audio.byteLength < 100) throw new Error("The voice service sent back no sound");
      const slug =
        (data.voice_name ?? "ai")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 24) || "ai";
      const filename = `Voiceover (${data.voice_name?.trim() || "AI"}).mp3`;
      const path = `${folder}/${data.project_id}/${Date.now()}_vo_${slug}.mp3`;
      const { error: upErr } = await context.supabase.storage
        .from("raw-clips")
        .upload(path, audio, { contentType: "audio/mpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);
      return { path, filename, size_bytes: audio.byteLength, characters: chars };
    } catch (e) {
      await giveBack();
      throw e;
    }
  });
