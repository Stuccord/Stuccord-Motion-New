// API keys, managed from Settings → API keys. A key is "smk_" and 40 random
// letters and digits; only its SHA-256 hash is kept (see
// src/lib/api/v1.server.ts, which checks keys on each API request). The
// key is shown once, when it's made.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const API_KEY_LIMIT = 10;

export type ApiKeyScope = "read" | "full";
export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  created_at: string;
  last_used_at: string | null;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function newKey(): string {
  // 62 letters and digits; bytes above 247 are dropped so each is equally likely.
  const out: string[] = [];
  while (out.length < 40) {
    for (const b of crypto.getRandomValues(new Uint8Array(64))) {
      if (b < 248 && out.length < 40) out.push(ALPHABET[b % 62]);
    }
  }
  return `smk_${out.join("")}`;
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** With two-factor on, keys can only be managed after the code is entered. */
async function requireSecondStep(userId: string, claims: unknown) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const hasTwoFactor = (data?.user?.factors ?? []).some((f) => f.status === "verified");
  if (hasTwoFactor && (claims as { aal?: string }).aal !== "aal2") {
    throw new Error("Confirm with your two-factor code first");
  }
}

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApiKeyRow[]> => {
    const { data, error } = await context.supabase
      .from("api_keys")
      .select("id, name, prefix, scope, created_at, last_used_at")
      .eq("user_id", context.userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((k) => ({ ...k, scope: k.scope === "full" ? "full" : "read" }));
  });

/** Makes a key and returns it (the only time it can be seen). */
export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(["read", "full"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    const { count, error: cErr } = await context.supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .is("revoked_at", null);
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) >= API_KEY_LIMIT) {
      throw new Error(`You can have up to ${API_KEY_LIMIT} keys. Revoke one you no longer use.`);
    }
    const key = newKey();
    const { data: row, error } = await context.supabase
      .from("api_keys")
      .insert({
        user_id: context.userId,
        name: data.name,
        prefix: key.slice(0, 12),
        key_hash: await hashApiKey(key),
        scope: data.scope,
      })
      .select("id, name, prefix, scope, created_at, last_used_at")
      .single();
    if (error) throw new Error(error.message);
    return { key, row: { ...row, scope: data.scope } as ApiKeyRow };
  });

/** Stops a key working, straight away and for good. */
export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    const { error } = await context.supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
