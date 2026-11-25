// Starting the automatic edit on the server (src/lib/auto-edit-run.server.ts).
// The make page calls this; the progress is then read from the project
// (getProject: project.auto_edit).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { projectForEdit } from "@/lib/projects.functions";
import { isAutoEditLive, parseAutoEdit, type AutoEdit } from "@/lib/auto-edit-state";

/**
 * Starts the automatic edit (or carries on with one that stopped). A run
 * that's going is left alone, unless `redo` (plan the graphics again).
 */
export const startAutoEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ project_id: z.string().uuid(), redo: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<AutoEdit> => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const current = parseAutoEdit(project.auto_edit);
    if (current && isAutoEditLive(current) && !data.redo) return current;
    // Made already: only "Redo the graphics" makes it again (so a stray start never re-renders).
    if (current?.status === "done" && !data.redo) return current;
    if (current && isAutoEditLive(current) && data.redo) {
      throw new Error("The video is still being made. Wait for it to finish first.");
    }
    const { autoEditStepUrl, startAutoEditRun } = await import("@/lib/auto-edit-run.server");
    return startAutoEditRun(context.userId, project.id, {
      redo: data.redo,
      stepUrl: autoEditStepUrl(),
    });
  });
