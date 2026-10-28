// The platforms you can post to. Each one has a sign-in (OAuth), a way to
// read the connected channel, and view counts for posted videos. Uploads
// themselves run on the render worker (render-worker/server.js, /publish).
//
// YouTube needs YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (a Google Cloud
// OAuth client with the YouTube Data API v3 turned on) and the redirect
// address <PUBLIC_APP_URL>/publishing/connect/youtube added to that client.

import type { Platform } from "@/lib/publishing-shared";

export type Tokens = {
  access_token: string;
  refresh_token?: string;
  /** Seconds until the access token stops working. */
  expires_in?: number;
  scope?: string;
};

export type Profile = { external_id: string; name: string; avatar_url: string | null };
export type PostStats = { views: number | null; likes: number | null; comments: number | null };

/** The platform no longer accepts this sign-in; the user has to connect again. */
export class ReconnectNeeded extends Error {}

export type Provider = {
  configured(): boolean;
  authUrl(o: { state: string; redirectUri: string }): string;
  exchange(o: { code: string; redirectUri: string }): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  profile(accessToken: string): Promise<Profile>;
  /** Stats by the platform's video id; videos that are gone are left out. */
  stats(accessToken: string, ids: string[]): Promise<Map<string, PostStats>>;
  revoke(token: string): Promise<void>;
};

/** Where a platform sends the user back after they sign in. */
export function redirectUri(platform: Platform): string {
  const raw = process.env.PUBLIC_APP_URL?.trim();
  if (!raw) throw new Error("Publishing isn't set up yet (PUBLIC_APP_URL is missing)");
  return new URL(`/publishing/connect/${platform}`, new URL(raw).origin).toString();
}

const num = (v: unknown) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

async function googleToken(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID?.trim() ?? "",
      client_secret: process.env.YOUTUBE_CLIENT_SECRET?.trim() ?? "",
      ...params,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as Tokens & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !j.access_token) {
    if (j.error === "invalid_grant")
      throw new ReconnectNeeded("Google stopped accepting this sign-in");
    throw new Error(
      `Google sign-in failed${j.error_description ? `: ${j.error_description}` : ""}`,
    );
  }
  return j;
}

type YoutubeItem = {
  id?: string;
  snippet?: { title?: string; thumbnails?: { default?: { url?: string } } };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
};

async function youtubeGet(path: string, accessToken: string) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as {
    items?: YoutubeItem[];
    error?: { message?: string };
  };
  if (res.status === 401) throw new ReconnectNeeded("YouTube stopped accepting this sign-in");
  if (!res.ok) throw new Error(`YouTube: ${j.error?.message ?? `error ${res.status}`}`);
  return j.items ?? [];
}

const youtube: Provider = {
  configured: () =>
    !!process.env.YOUTUBE_CLIENT_ID?.trim() && !!process.env.YOUTUBE_CLIENT_SECRET?.trim(),
  authUrl: ({ state, redirectUri }) => {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID?.trim() ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ].join(" "),
      // A refresh token every time, so posts can go out while the user is away.
      access_type: "offline",
      prompt: "consent select_account",
      state,
    }).toString();
    return u.toString();
  },
  exchange: ({ code, redirectUri }) =>
    googleToken({ code, redirect_uri: redirectUri, grant_type: "authorization_code" }).catch(
      (e: unknown) => {
        // A code that was already used or took too long.
        if (e instanceof ReconnectNeeded)
          throw new Error("That sign-in expired. Try connecting again.");
        throw e;
      },
    ),
  refresh: (refreshToken) =>
    googleToken({ refresh_token: refreshToken, grant_type: "refresh_token" }),
  profile: async (accessToken) => {
    const [ch] = await youtubeGet("channels?part=snippet&mine=true", accessToken);
    if (!ch)
      throw new Error(
        "This Google account doesn't have a YouTube channel yet. Make one on YouTube first.",
      );
    return {
      external_id: String(ch.id),
      name: String(ch.snippet?.title ?? "YouTube channel").slice(0, 100),
      avatar_url: ch.snippet?.thumbnails?.default?.url ?? null,
    };
  },
  stats: async (accessToken, ids) => {
    const out = new Map<string, PostStats>();
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const items = await youtubeGet(
        `videos?part=statistics&id=${batch.map(encodeURIComponent).join(",")}`,
        accessToken,
      );
      for (const v of items) {
        out.set(String(v.id), {
          views: num(v.statistics?.viewCount),
          likes: num(v.statistics?.likeCount),
          comments: num(v.statistics?.commentCount),
        });
      }
    }
    return out;
  },
  revoke: async (token) => {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  },
};

const PROVIDERS: Partial<Record<Platform, Provider>> = { youtube };

export function provider(platform: Platform): Provider {
  const p = PROVIDERS[platform];
  if (!p) throw new Error("Posting there isn't available yet");
  return p;
}

export function availablePlatforms(): Platform[] {
  return (Object.keys(PROVIDERS) as Platform[]).filter((p) => PROVIDERS[p]!.configured());
}
