// The editor's cleaned voice (clean-voice.server.ts), for the project's own
// recordings that the user can see.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  project_id: z.string().uuid(),
  mode: z.enum(["auto", "light", "strong"]),
  paths: z.array(z.string().min(1).max(400)).min(1).max(40),
});

export const getCleanVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const paths = [...new Set(data.paths)];
    const { data: rows, error } = await context.supabase
      .from("clips")
      .select("storage_path")
      .eq("project_id", data.project_id)
      .in("storage_path", paths);
    if (error) throw new Error(error.message);
    const ok = (rows ?? []).map((r) => r.storage_path).filter((p): p is string => !!p);
    if (!ok.length) return { urls: {}, waiting: 0, unavailable: 0 };
    const { cleanVoices } = await import("@/lib/clean-voice.server");
    return cleanVoices(ok, data.mode);
  });
