// The editor preview's grade (see lib/grade-gl.ts): the render worker
// measures the main track's videos as the export does and bakes the
// export's whole grade (correction, then the look's or the ready-made LUT
// at the strength skin allows) into one table (worker /grade-table).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { footagePreviewPath } from "@/lib/footage-preview";

const Input = z.object({
  project_id: z.string().uuid(),
  aspect: z.string().max(10),
  look: z.string().max(40).nullable(),
  lut: z.object({ id: z.string().max(80), strength: z.number().min(0).max(1) }).nullable(),
  center: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  clips: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        in_ms: z.number().int().nonnegative(),
        out_ms: z.number().int().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(8),
});

/** What the preview grade is made from (the editor's request). */
export type PreviewGradeRequest = z.infer<typeof Input>;

export type PreviewGrade = {
  size: number;
  table: string;
  /** The ready-made LUT as it's used (its strength lowered for skin), if one is. */
  lut: { id: string; strength: number } | null;
};

/** Answers kept a while per request (the worker measures each clip: a few seconds). */
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; grade: Promise<PreviewGrade | null> }>();

/** The preview grade for the editor; null when the worker can't make it (the CSS look shows). */
export const getPreviewGrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<PreviewGrade | null> => {
    // Only this project's own files, that the user can see.
    const paths = [...new Set(data.clips.map((c) => c.path))];
    const { data: rows, error } = await context.supabase
      .from("clips")
      .select("storage_path")
      .eq("project_id", data.project_id)
      .in("storage_path", paths);
    if (error) throw new Error(error.message);
    const ok = new Set((rows ?? []).map((r) => r.storage_path));
    const clips = data.clips.filter((c) => ok.has(c.path));
    if (!clips.length) return null;
    const key = JSON.stringify({ ...data, clips });
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.grade;
    const grade = askWorker(context.supabase, data, clips);
    cache.set(key, { at: Date.now(), grade });
    grade.then((g) => g ?? cache.delete(key)).catch(() => cache.delete(key));
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return grade;
  });

async function askWorker(
  supabase: {
    storage: {
      from: (b: string) => {
        createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl: string } | null }>;
      };
    };
  },
  data: z.infer<typeof Input>,
  clips: z.infer<typeof Input>["clips"],
): Promise<PreviewGrade | null> {
  try {
    const { workerSecret } = await import("@/lib/worker-secret");
    const secret = workerSecret();
    if (!secret || !process.env.RENDER_WORKER_URL?.trim()) return null;
    const { hmacHex, workerEndpoint } = await import("@/lib/motion-plan.functions");
    const storage = supabase.storage.from("raw-clips");
    // Each clip's small preview copy when it has one (normal video, quick
    // to read), else the original (the worker makes HDR normal).
    const sources = await Promise.all(
      clips.map(async (c) => {
        const copy = await storage.createSignedUrl(footagePreviewPath(c.path), 3600);
        const url =
          copy.data?.signedUrl ?? (await storage.createSignedUrl(c.path, 3600)).data?.signedUrl;
        return url ? { url, in_ms: c.in_ms, out_ms: c.out_ms } : null;
      }),
    );
    const usable = sources.filter((s): s is NonNullable<typeof s> => !!s);
    if (!usable.length) return null;
    const body = JSON.stringify({
      sources: usable,
      aspect: data.aspect,
      center: data.center,
      look: data.look,
      lut: data.lut,
    });
    const res = await fetch(workerEndpoint("grade-table").toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stuccord-signature": await hmacHex(secret, body),
      },
      body,
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      console.warn(`[preview-grade] The worker didn't make it: HTTP ${res.status}`);
      return null;
    }
    const j = (await res.json()) as { size?: number; table?: string; lut?: PreviewGrade["lut"] };
    return typeof j.size === "number" && typeof j.table === "string"
      ? { size: j.size, table: j.table, lut: j.lut ?? null }
      : null;
  } catch (e) {
    console.warn("[preview-grade] Couldn't get the preview grade:", e);
    return null;
  }
}
