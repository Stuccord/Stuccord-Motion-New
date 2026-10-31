// Account actions that need the server: deleting an account and everything
// in it.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Every file path under `prefix` in a bucket (folders walked). */
async function listAllFiles(
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        options: { limit: number; offset: number },
      ) => Promise<{
        data: { name: string; id: string | null }[] | null;
        error: { message: string } | null;
      }>;
    };
  },
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const files: string[] = [];
  const folders = [prefix];
  while (folders.length) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.from(bucket).list(folder, { limit: 1000, offset });
      if (error) throw new Error(`${bucket}: ${error.message}`);
      const entries = data ?? [];
      for (const e of entries) {
        const path = `${folder}/${e.name}`;
        // Folders have no id; files do.
        if (e.id) files.push(path);
        else folders.push(path);
      }
      if (entries.length < 1000) break;
    }
  }
  return files;
}

/**
 * Deletes the signed-in account: every uploaded file, thumbnail and export
 * in storage, then the account itself (its projects, clips, render jobs,
 * transcripts and profile go with it: they cascade from the user). Needs the
 * account's email typed to confirm, and the two-factor code when that's on.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ confirmEmail: z.string().min(3).max(320) }).parse(d))
  .handler(async ({ data, context }) => {
    // Only for a real signed-in request (never the local dev fallback user).
    const auth = getRequest()?.headers.get("authorization") ?? "";
    if (!/^Bearer\s+\S+\.\S+\.\S+$/.test(auth)) {
      throw new Error("Sign in again to delete your account");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: found, error: uErr } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (uErr || !found?.user) throw new Error("Account not found");
    const user = found.user;
    if ((user.email ?? "").toLowerCase() !== data.confirmEmail.trim().toLowerCase()) {
      throw new Error("Type your account's email exactly to confirm");
    }
    const hasTwoFactor = (user.factors ?? []).some((f) => f.status === "verified");
    if (hasTwoFactor && (context.claims as { aal?: string }).aal !== "aal2") {
      throw new Error("Confirm with your two-factor code first");
    }

    // Files first (storage doesn't cascade from the account).
    // motion-images: AI pictures, uploaded scene pictures and the photo a
    // speaker cartoon was made from (all under <owner id>/<project id>/).
    for (const bucket of ["raw-clips", "renders", "motion-images"]) {
      const paths = await listAllFiles(supabaseAdmin.storage, bucket, context.userId);
      for (let i = 0; i < paths.length; i += 500) {
        const { error } = await supabaseAdmin.storage.from(bucket).remove(paths.slice(i, i + 500));
        if (error) throw new Error(`Couldn't delete your files (${bucket}): ${error.message}`);
      }
    }

    const { error: dErr } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (dErr) throw new Error(`Couldn't delete the account: ${dErr.message}`);
    return { ok: true };
  });
