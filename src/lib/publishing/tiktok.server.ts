// TikTok: Login Kit sign-in and the Content Posting API.
//
// Needs TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET (a TikTok for Developers
// app with Login Kit and Content Posting, Direct Post on) and the redirect
// address <PUBLIC_APP_URL>/publishing/connect/tiktok added to that app.
// Scopes: user.info.basic, video.publish (post to the profile), video.upload
// (send to drafts) and video.list (view counts).

import type { TikTokCreatorInfo, TikTokPrivacy } from "@/lib/publishing-shared";
import type { PostStats, Provider, Tokens } from "./providers.server";
import { ReconnectNeeded } from "./reconnect";

const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.publish", "video.upload", "video.list"];

const num = (v: unknown) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

/** TikTok's error codes that mean the sign-in no longer works. */
const DEAD_SIGN_IN = new Set(["access_token_invalid", "access_token_expired"]);

/** Readable messages for TikTok's posting errors. */
export function tiktokMessage(code: string, fallback: string): string {
  switch (code) {
    case "scope_not_authorized":
      return "Reconnect TikTok and allow posting: a permission is missing.";
    case "spam_risk_too_many_posts":
      return "TikTok's daily post limit for this account is reached. Try again tomorrow.";
    case "spam_risk_user_banned_from_posting":
      return "TikTok isn't letting this account post right now.";
    case "reached_active_user_cap":
      return "Stuccord's daily TikTok posting allowance is used up. Try again tomorrow.";
    case "unaudited_client_can_only_post_to_private_accounts":
      return "TikTok only allows private posts from this app until it's approved.";
    case "privacy_level_option_mismatch":
      return "That 'who can see' choice isn't available for this account any more.";
    case "rate_limit_exceeded":
      return "TikTok is busy. Try again in a minute.";
    default:
      return `TikTok: ${fallback || code}`.slice(0, 300);
  }
}

/** Calls the TikTok API; returns `data` or throws with a readable message. */
async function call<T>(
  path: string,
  accessToken: string,
  body?: unknown,
): Promise<{ data: T; raw: string }> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json; charset=UTF-8" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  let j: { data?: T; error?: { code?: string; message?: string } } = {};
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const code = j.error?.code ?? (res.ok ? "ok" : `http_${res.status}`);
  if (DEAD_SIGN_IN.has(code) || res.status === 401) {
    throw new ReconnectNeeded("TikTok stopped accepting this sign-in");
  }
  if (code !== "ok") throw new Error(tiktokMessage(code, j.error?.message ?? ""));
  return { data: (j.data ?? {}) as T, raw };
}

async function token(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY?.trim() ?? "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET?.trim() ?? "",
      ...params,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as Tokens & {
    error?: string | { code?: string; message?: string };
    error_description?: string;
  };
  if (!res.ok || !j.access_token) {
    const code = typeof j.error === "string" ? j.error : j.error?.code;
    if (code === "invalid_grant")
      throw new ReconnectNeeded("TikTok stopped accepting this sign-in");
    throw new Error(
      `TikTok sign-in failed${j.error_description ? `: ${j.error_description}` : ""}`,
    );
  }
  return j;
}

const PRIVACY: TikTokPrivacy[] = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
];

/** What this account can post right now (TikTok asks apps to check before each post). */
export async function tiktokCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  const { data } = await call<{
    creator_nickname?: string;
    creator_username?: string;
    creator_avatar_url?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  }>("/post/publish/creator_info/query/", accessToken, {});
  return {
    nickname: String(data.creator_nickname ?? ""),
    username: String(data.creator_username ?? ""),
    avatar_url: data.creator_avatar_url ?? null,
    privacy_level_options: (data.privacy_level_options ?? []).filter((p): p is TikTokPrivacy =>
      PRIVACY.includes(p as TikTokPrivacy),
    ),
    comment_disabled: !!data.comment_disabled,
    duet_disabled: !!data.duet_disabled,
    stitch_disabled: !!data.stitch_disabled,
    max_video_post_duration_sec: num(data.max_video_post_duration_sec),
  };
}

export type TikTokPublishState =
  | { state: "done"; postId: string | null }
  | { state: "draft" }
  | { state: "failed"; reason: string }
  | { state: "pending" };

/**
 * Where an upload has got to. The public post's id is a 64-bit number, which
 * JSON.parse would round, so it's read from the raw text.
 */
export async function tiktokPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<TikTokPublishState> {
  const { data, raw } = await call<{ status?: string; fail_reason?: string }>(
    "/post/publish/status/fetch/",
    accessToken,
    { publish_id: publishId },
  );
  if (data.status === "PUBLISH_COMPLETE") {
    const m = raw.match(/"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)/);
    return { state: "done", postId: m ? m[1] : null };
  }
  if (data.status === "SEND_TO_USER_INBOX") return { state: "draft" };
  if (data.status === "FAILED") {
    return { state: "failed", reason: tiktokMessage(data.fail_reason ?? "", "the post failed") };
  }
  return { state: "pending" };
}

export const tiktok: Provider = {
  configured: () =>
    !!process.env.TIKTOK_CLIENT_KEY?.trim() && !!process.env.TIKTOK_CLIENT_SECRET?.trim(),
  authUrl: ({ state, redirectUri }) => {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.search = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY?.trim() ?? "",
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    }).toString();
    return u.toString();
  },
  exchange: ({ code, redirectUri }) =>
    token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" }).catch(
      (e: unknown) => {
        if (e instanceof ReconnectNeeded)
          throw new Error("That sign-in expired. Try connecting again.");
        throw e;
      },
    ),
  refresh: (refreshToken) => token({ refresh_token: refreshToken, grant_type: "refresh_token" }),
  profile: async (accessToken) => {
    const { data } = await call<{
      user?: { open_id?: string; display_name?: string; avatar_url?: string };
    }>("/user/info/?fields=open_id,display_name,avatar_url", accessToken);
    if (!data.user?.open_id) throw new Error("TikTok didn't say which account this is");
    return {
      external_id: data.user.open_id,
      name: String(data.user.display_name || "TikTok account").slice(0, 100),
      avatar_url: data.user.avatar_url ?? null,
    };
  },
  stats: async (accessToken, ids) => {
    const out = new Map<string, PostStats>();
    for (let i = 0; i < ids.length; i += 20) {
      const { raw } = await call(
        "/video/query/?fields=id,view_count,like_count,comment_count,share_url",
        accessToken,
        { filters: { video_ids: ids.slice(i, i + 20) } },
      );
      // Ids are read as text (64-bit), each with the counts that follow it.
      const videos = raw.split(/"id"\s*:\s*"?/).slice(1);
      for (const v of videos) {
        const id = v.match(/^(\d+)/)?.[1];
        if (!id) continue;
        const field = (k: string) => v.match(new RegExp(`"${k}"\\s*:\\s*(\\d+)`))?.[1];
        const url = v.match(/"share_url"\s*:\s*"([^"]+)"/)?.[1]?.replace(/\\\//g, "/") ?? null;
        out.set(id, {
          views: num(field("view_count")),
          likes: num(field("like_count")),
          comments: num(field("comment_count")),
          url: url && url.startsWith("https://") ? url : null,
        });
      }
    }
    return out;
  },
  revoke: async (accessToken) => {
    await fetch(`${API}/oauth/revoke/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY?.trim() ?? "",
        client_secret: process.env.TIKTOK_CLIENT_SECRET?.trim() ?? "",
        token: accessToken,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  },
  revokeWith: "access",
};
