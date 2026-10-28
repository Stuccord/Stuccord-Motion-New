// Saving transcripts the render worker sends back (after an export, or a
// Transcribe run for planning). Server only: writes with the admin client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { inFolder, projectFolder } from "@/lib/workspace";

type TranscriptWord = { text: string; start_ms: number; end_ms: number };

/** One transcribed source file, as the worker reports it. */
export type IncomingTranscript = {
  storage_path?: unknown;
  provider?: unknown;
  model?: unknown;
  language?: unknown;
  words?: unknown;
};

const optionalString = (v: unknown) => (typeof v === "string" ? v.slice(0, 64) : null);

function cleanWords(words: unknown): TranscriptWord[] {
  if (!Array.isArray(words)) return [];
  return words
    .filter(
      (w): w is TranscriptWord =>
        !!w &&
        typeof w.text === "string" &&
        Number.isFinite(w.start_ms) &&
        Number.isFinite(w.end_ms),
    )
    .slice(0, 50_000)
    .map((w) => ({
      text: w.text.slice(0, 100),
      start_ms: Math.round(w.start_ms),
      end_ms: Math.round(w.end_ms),
    }));
}

/**
 * Saves newly transcribed source files for a project. Only paths inside the
 * project's storage folder are accepted (the owner's, or the team's), and an
 * existing transcript is never overwritten, so the user's corrections are
 * kept. Returns how many were saved; errors are logged, not thrown.
 */
export async function saveIncomingTranscripts(
  admin: SupabaseClient<Database>,
  projectId: string,
  userId: string,
  incoming: unknown,
): Promise<number> {
  if (!Array.isArray(incoming)) return 0;
  const { data: proj } = await admin
    .from("projects")
    .select("user_id, team_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!proj) return 0;
  const folder = projectFolder(proj);
  const rows = (incoming as IncomingTranscript[])
    .filter((t) => typeof t?.storage_path === "string" && inFolder(t.storage_path, folder))
    .map((t) => ({
      user_id: userId,
      storage_path: t.storage_path as string,
      provider: optionalString(t.provider),
      model: optionalString(t.model),
      language: optionalString(t.language),
      words: cleanWords(t.words),
    }));
  if (!rows.length) return 0;
  const { error } = await admin
    .from("transcripts")
    .upsert(rows, { onConflict: "user_id,storage_path", ignoreDuplicates: true });
  if (error) {
    console.error("[transcripts] Saving transcripts failed:", error.message);
    return 0;
  }
  return rows.length;
}
