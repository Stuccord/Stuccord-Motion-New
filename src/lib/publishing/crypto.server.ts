// Secrets for publishing, all from PUBLISHING_TOKEN_KEY (32 random bytes, as
// base64 or 64 hex characters; make one with `openssl rand -base64 32`):
//  - connected accounts' sign-in tokens are encrypted with AES-256-GCM before
//    they're stored, tied to the owner's id so a token can't be moved to
//    another user's row;
//  - the OAuth "state" sent to a platform is signed, so a sign-in can only
//    finish for the user who started it, within 15 minutes.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function rawKey(): Uint8Array<ArrayBuffer> {
  const raw = process.env.PUBLISHING_TOKEN_KEY?.trim();
  if (!raw) throw new Error("Publishing isn't set up yet (PUBLISHING_TOKEN_KEY is missing)");
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    bytes = Uint8Array.from(raw.match(/../g)!, (h) => parseInt(h, 16));
  } else {
    try {
      bytes = fromB64url(raw.replace(/=+$/, ""));
    } catch {
      bytes = null;
    }
  }
  if (!bytes || bytes.length !== 32) {
    throw new Error("PUBLISHING_TOKEN_KEY must be 32 bytes, as base64 or 64 hex characters");
  }
  return bytes;
}

async function aesKey() {
  return crypto.subtle.importKey("raw", rawKey(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hmacKey() {
  // A separate key for signing, derived from the main one.
  const base = await crypto.subtle.importKey(
    "raw",
    rawKey(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", base, enc.encode("oauth-state")));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * Whose tokens these are, for encryption: a person's id for their own
 * account, "team:<id>" for a team's (so it keeps working when whoever
 * connected it leaves the team).
 */
export const tokenOwner = (a: { user_id: string; team_id?: string | null }) =>
  a.team_id ? `team:${a.team_id}` : a.user_id;

/** Encrypts a token for the user (or team, see tokenOwner) who owns it. */
export async function sealToken(token: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(userId) },
    await aesKey(),
    enc.encode(token),
  );
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function openToken(sealed: string, userId: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unreadable token");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(iv), additionalData: enc.encode(userId) },
    await aesKey(),
    fromB64url(ct),
  );
  return dec.decode(pt);
}

const STATE_TTL_MS = 15 * 60 * 1000;

/** `team`: connecting an account for a team (its owner or an admin). */
export type OAuthState = { uid: string; platform: string; verifier?: string; team?: string };

/** A signed state for the platform's sign-in page (and the PKCE verifier, if any). */
export async function signState(s: OAuthState): Promise<string> {
  const body = b64url(
    enc.encode(
      JSON.stringify({
        ...s,
        exp: Date.now() + STATE_TTL_MS,
        n: b64url(crypto.getRandomValues(new Uint8Array(9))),
      }),
    ),
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyState(state: string): Promise<OAuthState> {
  const [body, sig] = state.split(".");
  const fail = () => new Error("That sign-in link expired or isn't valid. Try connecting again.");
  if (!body || !sig) throw fail();
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(sig), enc.encode(body));
  } catch {
    ok = false;
  }
  if (!ok) throw fail();
  const parsed = JSON.parse(dec.decode(fromB64url(body))) as OAuthState & { exp: number };
  if (!(parsed.exp > Date.now())) throw fail();
  return {
    uid: parsed.uid,
    platform: parsed.platform,
    verifier: parsed.verifier,
    team: parsed.team,
  };
}
