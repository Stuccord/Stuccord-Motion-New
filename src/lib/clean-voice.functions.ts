// The editor's cleaned voice (clean-voice.server.ts), for the project's own
// recordings that the user can see.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  project_id: z.string().uuid(),
  mode: z.enum(["auto", "light", "strong", "studio"]),
  paths: z.array(z.string().min(1).max(400)).min(1).max(40),
});

export const getCleanVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const paths = [...new Set(data.paths)];
    const { data: rows, error } = await context.supabase
      .from("clips")
      .select("storage_path, duration_ms")
      .eq("project_id", data.project_id)
      .in("storage_path", paths);
    if (error) throw new Error(error.message);
    const ok = [
      ...new Set((rows ?? []).map((r) => r.storage_path).filter((p): p is string => !!p)),
    ];
    if (!ok.length) return { urls: {}, waiting: 0, unavailable: 0, overAllowance: 0 };
    // Each recording's length, for Studio voice's minutes.
    const seconds: Record<string, number> = {};
    for (const r of rows ?? []) {
      if (r.duration_ms)
        seconds[r.storage_path] = Math.max(seconds[r.storage_path] ?? 0, r.duration_ms / 1000);
    }
    const { cleanVoices } = await import("@/lib/clean-voice.server");
    return cleanVoices(ok, data.mode, {
      userId: context.userId,
      projectId: data.project_id,
      seconds,
    });
  });

/** Studio voice minutes used this month, and the allowance (null: no limit). */
export const getStudioVoiceUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { studioVoiceUsage } = await import("@/lib/studio-voice.server");
    try {
      return await studioVoiceUsage(context.userId);
    } catch {
      // The table isn't there yet (the database update not run): no minutes to show.
      return { usedSeconds: 0, limitSeconds: null as number | null, unknown: true };
    }
  });
