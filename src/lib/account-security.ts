// Password and two-factor (authenticator app) for the signed-in user, using
// Supabase Auth. The database also requires the code for users who turned
// two-factor on (migration 20261031120000_mfa_enforcement).

import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// The app's Supabase project and public key (as the main client uses them).
function project() {
  const c = supabase as unknown as { supabaseUrl: string; supabaseKey: string };
  return { url: c.supabaseUrl, key: c.supabaseKey };
}

/**
 * Whether `password` is this account's password: tried on a separate,
 * throwaway client so the current session isn't touched, and that sign-in
 * is ended right away.
 */
export async function checkPassword(email: string, password: string): Promise<boolean> {
  const { url, key } = project();
  const opaqueKey = key.startsWith("sb_publishable_");
  const temp = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      // New-style keys aren't bearer tokens (as in the main client).
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (opaqueKey && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  const { data, error } = await temp.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await temp.auth.signOut({ scope: "local" });
  return true;
}

export const MIN_PASSWORD = 8;

/** Changes the password after checking the current one. Throws with a message to show. */
export async function changePassword(current: string, next: string) {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error("You're not signed in");
  if (next.length < MIN_PASSWORD) {
    throw new Error(`The new password needs at least ${MIN_PASSWORD} characters`);
  }
  if (!(await checkPassword(email, current))) throw new Error("Your current password isn't right");
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    if (/same/i.test(error.message))
      throw new Error("Pick a password you haven't used here before");
    throw new Error(error.message);
  }
}

/** The account's authenticator app, if one is set up (verified). */
export async function getAuthenticator() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return data.all.find((f) => f.factor_type === "totp" && f.status === "verified") ?? null;
}

/**
 * Starts setting up an authenticator app: returns the QR code to scan (an
 * SVG image URL) and the key to type in instead. Unfinished earlier set-ups
 * are cleared first.
 */
export async function startAuthenticatorSetup() {
  const { data: list, error: lErr } = await supabase.auth.mfa.listFactors();
  if (lErr) throw new Error(lErr.message);
  for (const f of list.all) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  });
  if (error) throw new Error(error.message);
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Checks a 6-digit code for an authenticator (finishing set-up, or signing in). */
export async function checkCode(factorId: string, code: string) {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) throw new Error("Enter the 6-digit code from your app");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: clean });
  if (error) {
    throw new Error(
      /invalid|expired/i.test(error.message)
        ? "That code isn't right. Try the current one."
        : error.message,
    );
  }
}

/** Turns two-factor off (or abandons an unfinished set-up). */
export async function removeAuthenticator(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}

/** Whether this session still needs the two-factor code (signed in with the password only). */
export async function needsCode(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return false;
  return data.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

/** Signs in the rest of the way with the code from the authenticator app. */
export async function verifySignInCode(code: string) {
  const factor = await getAuthenticator();
  if (!factor) throw new Error("No authenticator app is set up for this account");
  await checkCode(factor.id, code);
}

/** Emails a password-reset link that opens /reset-password in this app. */
export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new Error(error.message);
}
