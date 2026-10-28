// Instagram: "Instagram API with Instagram Login" (Business and Creator
// accounts, no Facebook Page needed).
//
// Needs INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET (from the Meta app's
// "Instagram API with Instagram Login" setup) and the redirect address
// <PUBLIC_APP_URL>/publishing/connect/instagram added there.
// Permissions: instagram_business_basic, instagram_business_content_publish
// and instagram_business_manage_insights (views).
//
// Instagram has no refresh token: the long-lived access token (60 days) is
// renewed with itself, so it's stored in both token columns and renewed once
// it has less than 30 days left (it must be at least a day old to renew).

import type { PostStats, Provider, Tokens } from "./providers.server";
import { ReconnectNeeded } from "./reconnect";

const GRAPH = "https://graph.instagram.com";
const VERSION = "v21.0";
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
];

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
};

const num = (v: unknown) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

/** Readable text for an Instagram API error; throws ReconnectNeeded for a dead sign-in. */
function fail(status: number, e: GraphError | undefined): never {
  // 190: the token expired or was revoked (e.g. the app was removed in Instagram).
  if (e?.code === 190 || status === 401) {
    throw new ReconnectNeeded("Instagram stopped accepting this sign-in");
  }
  throw new Error(
    `Instagram: ${e?.error_user_msg || e?.message || `error ${status}`}`.slice(0, 300),
  );
}

async function graph<T>(path: string, accessToken: string): Promise<T> {
  const u = new URL(`${GRAPH}/${VERSION}/${path}`);
  u.searchParams.set("access_token", accessToken);
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  if (!res.ok || j.error) fail(res.status, j.error);
  return j;
}

/** Swaps a short-lived token (1 hour) for a long-lived one (60 days). */
async function longLived(shortToken: string): Promise<Tokens> {
  const u = new URL(`${GRAPH}/access_token`);
  u.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: process.env.INSTAGRAM_APP_SECRET?.trim() ?? "",
    access_token: shortToken,
  }).toString();
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  const j = (await res.json().catch(() => ({}))) as Tokens & { error?: GraphError };
  if (!res.ok || !j.access_token) fail(res.status, j.error);
  return { access_token: j.access_token, refresh_token: j.access_token, expires_in: j.expires_in };
}

export const instagram: Provider = {
  configured: () =>
    !!process.env.INSTAGRAM_APP_ID?.trim() && !!process.env.INSTAGRAM_APP_SECRET?.trim(),
  authUrl: ({ state, redirectUri }) => {
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.search = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID?.trim() ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      enable_fb_login: "0",
      state,
    }).toString();
    return u.toString();
  },
  exchange: async ({ code, redirectUri }) => {
    const res = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID?.trim() ?? "",
        client_secret: process.env.INSTAGRAM_APP_SECRET?.trim() ?? "",
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        // Instagram sometimes adds "#_" to the code in the address.
        code: code.replace(/#_$/, ""),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      permissions?: string | string[];
      data?: { access_token?: string; permissions?: string | string[] }[];
      error_message?: string;
      error_type?: string;
    };
    const short = j.access_token ?? j.data?.[0]?.access_token;
    if (!res.ok || !short) {
      if (j.error_type === "OAuthException") {
        throw new Error("That sign-in expired. Try connecting again.");
      }
      throw new Error(`Instagram sign-in failed${j.error_message ? `: ${j.error_message}` : ""}`);
    }
    const perms = j.permissions ?? j.data?.[0]?.permissions;
    const t = await longLived(short);
    return { ...t, scope: Array.isArray(perms) ? perms.join(",") : perms };
  },
  refresh: async (token) => {
    const u = new URL(`${GRAPH}/refresh_access_token`);
    u.search = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: token,
    }).toString();
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    const j = (await res.json().catch(() => ({}))) as Tokens & { error?: GraphError };
    if (!res.ok || !j.access_token) fail(res.status, j.error);
    return {
      access_token: j.access_token,
      refresh_token: j.access_token,
      expires_in: j.expires_in,
    };
  },
  refreshEarlyMs: 30 * 24 * 60 * 60 * 1000,
  profile: async (accessToken) => {
    const me = await graph<{
      user_id?: string | number;
      id?: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
      account_type?: string;
    }>("me?fields=user_id,username,name,profile_picture_url,account_type", accessToken);
    const id = me.user_id != null ? String(me.user_id) : me.id;
    if (!id) throw new Error("Instagram didn't say which account this is");
    if (me.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(me.account_type)) {
      throw new Error(
        "Only Business and Creator accounts can post through apps. Switch to a professional account in Instagram's settings.",
      );
    }
    return {
      external_id: id,
      name: me.username ? `@${me.username}` : (me.name ?? "Instagram account"),
      avatar_url: me.profile_picture_url ?? null,
    };
  },
  stats: async (accessToken, ids) => {
    const out = new Map<string, PostStats>();
    for (const id of ids) {
      try {
        // Views, likes and comments come from insights…
        const r = await graph<{
          data?: {
            name?: string;
            values?: { value?: number }[];
            total_value?: { value?: number };
          }[];
        }>(`${encodeURIComponent(id)}/insights?metric=views,likes,comments`, accessToken);
        const m = (k: string) => {
          const row = r.data?.find((d) => d.name === k);
          return num(row?.total_value?.value ?? row?.values?.[0]?.value);
        };
        out.set(id, { views: m("views"), likes: m("likes"), comments: m("comments") });
      } catch (e) {
        if (e instanceof ReconnectNeeded) throw e;
        // …which aren't there for everything (e.g. a Story after a day), so fall
        // back to the counts on the post itself; a deleted post is left out.
        try {
          const f = await graph<{
            like_count?: number;
            comments_count?: number;
            permalink?: string;
          }>(`${encodeURIComponent(id)}?fields=like_count,comments_count,permalink`, accessToken);
          out.set(id, {
            views: null,
            likes: num(f.like_count),
            comments: num(f.comments_count),
            url: f.permalink?.startsWith("https://") ? f.permalink : null,
          });
        } catch (e2) {
          if (e2 instanceof ReconnectNeeded) throw e2;
        }
      }
    }
    return out;
  },
  // Instagram Login has no sign-out call: people remove the app in Instagram
  // (Settings → Apps and websites). The stored token is deleted either way.
  revoke: async () => undefined,
  revokeWith: "access",
};
