// Local-development-only auth bypass.
//
// When ENABLE_DEV_MOCK_AUTH=true and NODE_ENV is exactly "development",
// requests without a bearer token are served as a dedicated dev user. The
// dev user signs in with a real email + password, so every query still runs
// under that user's JWT and Row Level Security applies. This module never
// touches the service-role key.
//
// Load inside server handlers:
//   const { getDevMockAccessToken } = await import("@/integrations/supabase/dev-mock-auth.server");
import { createClient } from "@supabase/supabase-js";

let cached: { accessToken: string; expiresAtMs: number } | null = null;
let pending: Promise<string> | null = null;
let loggedWarning = false;

export function isDevMockAuthEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.ENABLE_DEV_MOCK_AUTH === "true";
}

async function signInDevUser(): Promise<string> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.DEV_MOCK_USER_EMAIL;
  const password = process.env.DEV_MOCK_USER_PASSWORD;

  if (!url || !publishableKey) {
    throw new Error("Dev mock auth: missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  }
  if (!email || !password) {
    throw new Error(
      "Dev mock auth: set DEV_MOCK_USER_EMAIL and DEV_MOCK_USER_PASSWORD (see supabase/seed-dev-user.mjs)",
    );
  }

  const client = createClient(url, publishableKey, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(
      `Dev mock auth: sign-in failed for ${email}: ${error?.message ?? "no session"}`,
    );
  }

  cached = {
    accessToken: data.session.access_token,
    expiresAtMs: (data.session.expires_at ?? 0) * 1000,
  };
  return cached.accessToken;
}

/**
 * Returns an access token for the dev user, or null when mock auth is
 * disabled. Tokens are cached per process and re-issued shortly before expiry.
 */
export async function getDevMockAccessToken(): Promise<string | null> {
  if (!isDevMockAuthEnabled()) return null;

  if (!loggedWarning) {
    console.warn(
      "[Supabase Auth] [DEV MODE ONLY] No bearer token provided. Signing in as DEV_MOCK_USER_EMAIL because ENABLE_DEV_MOCK_AUTH=true.",
    );
    loggedWarning = true;
  }

  if (cached && cached.expiresAtMs - Date.now() > 60_000) return cached.accessToken;
  if (!pending) {
    pending = signInDevUser().finally(() => {
      pending = null;
    });
  }
  return pending;
}
