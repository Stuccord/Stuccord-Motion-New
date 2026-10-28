// Sends due posts to the render worker to upload, records what came back,
// and pulls view counts for posted videos. Runs on the app's server with the
// admin client, so every step checks the post, its account and its files
// belong to the same user.
//
// The worker calls /api/public/publishing-tick once a minute (scheduled posts
// and stats); "Post now" sends its posts straight away.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Platform } from "@/lib/publishing-shared";
import { openToken, sealToken, tokenOwner } from "./crypto.server";
import { provider, ReconnectNeeded } from "./providers.server";
import { tiktokPublishStatus } from "./tiktok.server";

type Db = SupabaseClient<Database>;
type AccountRow = Database["public"]["Tables"]["social_accounts"]["Row"];
type PostRow = Database["public"]["Tables"]["social_posts"]["Row"];

/** An upload that hasn't reported back in this long is given up on. */
const STALE_UPLOAD_MS = 3 * 60 * 60 * 1000;
/** Tries before a post that couldn't reach the worker is marked failed. */
const MAX_ATTEMPTS = 3;
const STATS_EVERY_MS = 24 * 60 * 60 * 1000;
/** The first view count, this long after posting. */
const FIRST_STATS_AFTER_MS = 60 * 60 * 1000;
const SIGNED_URL_SECONDS = 6 * 60 * 60;

function appUrl(path: string): string {
  const raw = process.env.PUBLIC_APP_URL?.trim();
  if (!raw) throw new Error("PUBLIC_APP_URL is not configured");
  return new URL(path, new URL(raw).origin).toString();
}

function workerUrl(endpoint: string): string {
  const raw = process.env.RENDER_WORKER_URL?.trim();
  if (!raw) throw new Error("The render worker isn't set up (RENDER_WORKER_URL)");
  const url = new URL(raw);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] === "jobs") segments.pop();
  url.pathname = `/${[...segments, endpoint].join("/")}`;
  return url.toString();
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Checks a request signed with RENDER_WORKER_SECRET (like the render webhook). */
export async function verifyWorkerSignature(body: string, signature: string): Promise<boolean> {
  const secret = process.env.RENDER_WORKER_SECRET?.trim();
  if (!secret) return false;
  const expected = await hmacHex(secret, body);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

class WorkerUnreachable extends Error {}

async function sendToWorker(payload: unknown) {
  const secret = process.env.RENDER_WORKER_SECRET?.trim();
  if (!secret) throw new Error("The render worker isn't set up (RENDER_WORKER_SECRET)");
  const body = JSON.stringify(payload);
  let res: Response;
  try {
    res = await fetch(workerUrl("publish"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stuccord-signature": await hmacHex(secret, body),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new WorkerUnreachable("Couldn't reach the upload service");
  }
  if (res.status === 404) throw new Error("Posting needs the render worker to be updated");
  if (res.status === 503 || res.status === 429)
    throw new WorkerUnreachable("The upload service is busy");
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || "The upload service turned the post down");
  }
}

/**
 * A working access token for an account, refreshed when it's close to
 * running out (`minLeftMs`). Marks the account for reconnecting when the
 * platform won't accept it any more.
 */
export async function accessTokenFor(
  db: Db,
  account: AccountRow,
  minLeftMs: number,
): Promise<string> {
  const left = account.token_expires_at
    ? Date.parse(account.token_expires_at) - Date.now()
    : Infinity;
  const early = provider(account.platform as Platform).refreshEarlyMs ?? 0;
  if (left > Math.max(minLeftMs, early) || !account.refresh_token_enc) {
    return openToken(account.access_token_enc, tokenOwner(account));
  }
  try {
    const refresh = await openToken(account.refresh_token_enc, tokenOwner(account));
    const t = await provider(account.platform as Platform).refresh(refresh);
    const patch = {
      access_token_enc: await sealToken(t.access_token, tokenOwner(account)),
      ...(t.refresh_token
        ? { refresh_token_enc: await sealToken(t.refresh_token, tokenOwner(account)) }
        : {}),
      token_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      status: "active",
    };
    await db
      .from("social_accounts")
      .update(patch)
      .eq("id", account.id)
      .eq("user_id", account.user_id);
    return t.access_token;
  } catch (e) {
    if (e instanceof ReconnectNeeded) {
      await db
        .from("social_accounts")
        .update({ status: "needs_reconnect" })
        .eq("id", account.id)
        .eq("user_id", account.user_id);
      throw e;
    }
    // Renewing early didn't work, but the current sign-in still does.
    if (left > minLeftMs) return openToken(account.access_token_enc, tokenOwner(account));
    throw e;
  }
}

/**
 * Renews sign-ins that run out unless they're renewed (Instagram's), for
 * accounts that haven't posted lately, so they don't need reconnecting.
 */
export async function refreshExpiringTokens(db: Db) {
  let renewed = 0;
  for (const platform of ["instagram"] as const) {
    const early = provider(platform).refreshEarlyMs;
    if (!early || !provider(platform).configured()) continue;
    const { data: accounts } = await db
      .from("social_accounts")
      .select("*")
      .eq("platform", platform)
      .eq("status", "active")
      .lt("token_expires_at", new Date(Date.now() + early).toISOString())
      .order("token_expires_at", { ascending: true })
      .limit(20);
    for (const a of accounts ?? []) {
      try {
        await accessTokenFor(db, a, early);
        renewed++;
      } catch (e) {
        console.error(
          "[publishing] Renewing a sign-in failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
  return renewed;
}

async function markFailed(db: Db, post: PostRow, error: string) {
  await db
    .from("social_posts")
    .update({ status: "failed", error: error.slice(0, 500) })
    .eq("id", post.id)
    .eq("status", "uploading");
}

/**
 * The account a post goes to, only if it belongs with the post: the
 * person's own account for a personal post, the team's for a team post.
 */
async function accountForPost(
  db: Db,
  post: { account_id: string | null; user_id: string; team_id: string | null },
) {
  if (!post.account_id) return null;
  let q = db.from("social_accounts").select("*").eq("id", post.account_id);
  q = post.team_id
    ? q.eq("team_id", post.team_id)
    : q.eq("user_id", post.user_id).is("team_id", null);
  const { data } = await q.maybeSingle();
  return data;
}

/** Sends one claimed post (status "uploading") to the worker. */
async function sendPost(db: Db, post: PostRow) {
  // A personal post's files are the person's; a team post's, the team's.
  const folder = post.team_id ? `teams/${post.team_id}` : post.user_id;
  const owned = (p: string | null) => !p || (p.startsWith(`${folder}/`) && !p.includes(".."));
  if (!owned(post.video_path) || !owned(post.cover_path)) {
    return markFailed(db, post, "That video isn't in your files");
  }
  if (!post.account_id) return markFailed(db, post, "The account was disconnected");
  const account = await accountForPost(db, post);
  if (!account) return markFailed(db, post, "The account was disconnected");
  if (account.status !== "active") {
    return markFailed(
      db,
      post,
      `Reconnect ${account.name}: the platform stopped accepting its sign-in`,
    );
  }

  try {
    // Uploads can take a while: start with a token that has most of its hour left.
    const accessToken = await accessTokenFor(db, account, 50 * 60 * 1000);
    const { data: video, error: vErr } = await db.storage
      .from("renders")
      .createSignedUrl(post.video_path, SIGNED_URL_SECONDS);
    if (vErr || !video) return markFailed(db, post, "The video file is gone. Export it again.");
    let coverUrl: string | null = null;
    if (post.cover_path) {
      const { data: cover } = await db.storage
        .from("raw-clips")
        .createSignedUrl(post.cover_path, SIGNED_URL_SECONDS);
      coverUrl = cover?.signedUrl ?? null;
    }
    await sendToWorker({
      post_id: post.id,
      platform: post.platform,
      account_external_id: account.external_id,
      access_token: accessToken,
      video_url: video.signedUrl,
      cover_url: coverUrl,
      title: post.title,
      caption: post.caption,
      privacy: post.privacy,
      made_for_kids: post.made_for_kids,
      options: post.options,
      callback_url: appUrl("/api/public/publish-webhook"),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't send the post";
    if (e instanceof WorkerUnreachable && post.attempts < MAX_ATTEMPTS) {
      // Try again in a few minutes.
      await db
        .from("social_posts")
        .update({
          status: "scheduled",
          error: msg,
          scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        })
        .eq("id", post.id)
        .eq("status", "uploading");
      return;
    }
    if (e instanceof ReconnectNeeded) {
      return markFailed(
        db,
        post,
        `Reconnect ${account.name}: the platform stopped accepting its sign-in`,
      );
    }
    return markFailed(db, post, msg);
  }
}

/**
 * Sends posts that are due (or just `ids`, for "Post now") to the worker.
 * Each post is claimed first, so two ticks never send the same one.
 */
export async function dispatchDuePosts(db: Db, opts: { ids?: string[]; userId?: string } = {}) {
  // Uploads that never reported back.
  await db
    .from("social_posts")
    .update({ status: "failed", error: "The upload didn't finish. Try again." })
    .eq("status", "uploading")
    .lt("updated_at", new Date(Date.now() - STALE_UPLOAD_MS).toISOString());

  let q = db
    .from("social_posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);
  if (opts.ids) q = q.in("id", opts.ids);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: due, error } = await q;
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const row of due ?? []) {
    const { data: claimed } = await db
      .from("social_posts")
      .update({ status: "uploading", attempts: row.attempts + 1, error: null })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("*")
      .maybeSingle();
    if (!claimed) continue;
    await sendPost(db, claimed);
    sent++;
  }
  return sent;
}

export type PublishResult = {
  post_id?: unknown;
  status?: unknown;
  external_id?: unknown;
  external_url?: unknown;
  /** The platform's id for the upload (TikTok's publish_id). */
  external_ref?: unknown;
  error?: unknown;
};

/** Saves what the worker reports for an upload. */
export async function recordPublishResult(db: Db, r: PublishResult) {
  if (typeof r.post_id !== "string") throw new Error("Missing post_id");
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
  const url = str(r.external_url, 500);
  const patch =
    r.status === "published"
      ? {
          status: "published",
          external_id: str(r.external_id, 200),
          external_url: url && /^https:\/\//.test(url) ? url : null,
          external_ref: str(r.external_ref, 200),
          published_at: new Date().toISOString(),
          error: null,
        }
      : r.status === "failed"
        ? { status: "failed", error: str(r.error, 500) ?? "The upload failed" }
        : null;
  if (!patch) {
    // A progress report: just keeps the upload from being given up on.
    await db
      .from("social_posts")
      .update({ error: null })
      .eq("id", r.post_id)
      .eq("status", "uploading");
    return;
  }
  await db.from("social_posts").update(patch).eq("id", r.post_id).eq("status", "uploading");
}

/** Pulls view, like and comment counts for posts that are due an update. */
export async function syncPostStats(db: Db, opts: { userId?: string; force?: boolean } = {}) {
  const now = Date.now();
  let q = db
    .from("social_posts")
    .select(
      "id, user_id, team_id, account_id, external_id, external_url, published_at, stats_updated_at",
    )
    .eq("status", "published")
    .not("external_id", "is", null)
    .lte("published_at", new Date(now - (opts.force ? 0 : FIRST_STATS_AFTER_MS)).toISOString())
    .order("stats_updated_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (!opts.force) {
    q = q.or(
      `stats_updated_at.is.null,stats_updated_at.lt.${new Date(now - STATS_EVERY_MS).toISOString()}`,
    );
  }
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: posts, error } = await q;
  if (error) throw new Error(error.message);

  const byAccount = new Map<string, typeof posts>();
  for (const p of posts ?? []) {
    if (!p.account_id || !p.external_id) continue;
    byAccount.set(p.account_id, [...(byAccount.get(p.account_id) ?? []), p]);
  }
  let updated = 0;
  for (const [accountId, list] of byAccount) {
    const { data: account } = await db
      .from("social_accounts")
      .select("*")
      .eq("id", accountId)
      .maybeSingle();
    if (!account || account.status !== "active") continue;
    try {
      const token = await accessTokenFor(db, account, 5 * 60 * 1000);
      const stats = await provider(account.platform as Platform).stats(
        token,
        list.map((p) => p.external_id!),
      );
      for (const p of list) {
        // Only posts that belong with this account (the person's, or the team's).
        const belongs = account.team_id
          ? p.team_id === account.team_id
          : !p.team_id && p.user_id === account.user_id;
        if (!belongs) continue;
        const s = stats.get(p.external_id!);
        await db
          .from("social_posts")
          .update({
            ...(s ? { views: s.views, likes: s.likes, comments: s.comments } : {}),
            ...(s?.url && !p.external_url ? { external_url: s.url } : {}),
            stats_updated_at: new Date().toISOString(),
          })
          .eq("id", p.id);
        updated++;
      }
    } catch (e) {
      console.error(
        "[publishing] Stats for one account failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return updated;
}

/** How long to keep looking for a TikTok post after the upload finished. */
const RESOLVE_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * TikTok finishes a post after the upload (processing and moderation), and
 * only then says its id. This looks up uploads that don't have one yet: the
 * id lets view counts be fetched, and a post TikTok turned down is marked
 * failed.
 */
export async function resolvePendingPosts(db: Db, opts: { userId?: string } = {}) {
  let q = db
    .from("social_posts")
    .select("id, user_id, team_id, account_id, platform, external_ref, published_at, options")
    .eq("status", "published")
    .eq("platform", "tiktok")
    .is("external_id", null)
    .not("external_ref", "is", null)
    .order("published_at", { ascending: true })
    .limit(50);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: posts, error } = await q;
  if (error) throw new Error(error.message);

  let resolved = 0;
  const tokens = new Map<string, string | null>();
  for (const p of posts ?? []) {
    const stop = () =>
      db
        .from("social_posts")
        .update({ external_ref: null })
        .eq("id", p.id)
        .eq("status", "published");
    if (!p.account_id || (p.options as { mode?: string } | null)?.mode !== "direct") {
      await stop();
      continue;
    }
    if (p.published_at && Date.now() - Date.parse(p.published_at) > RESOLVE_FOR_MS) {
      await stop();
      continue;
    }
    if (!tokens.has(p.account_id)) {
      const account = await accountForPost(db, p);
      tokens.set(
        p.account_id,
        account && account.status === "active"
          ? await accessTokenFor(db, account, 5 * 60 * 1000).catch(() => null)
          : null,
      );
    }
    const token = tokens.get(p.account_id);
    if (!token) continue;
    try {
      const r = await tiktokPublishStatus(token, p.external_ref!);
      if (r.state === "done" && r.postId) {
        await db
          .from("social_posts")
          .update({ external_id: r.postId })
          .eq("id", p.id)
          .eq("status", "published");
        resolved++;
      } else if (
        r.state === "draft" ||
        (r.state === "done" &&
          (p.options as { privacy_level?: string } | null)?.privacy_level === "SELF_ONLY")
      ) {
        // TikTok won't share the id of a draft or an "Only me" post: no counts.
        await stop();
      } else if (r.state === "failed") {
        await db
          .from("social_posts")
          .update({ status: "failed", error: r.reason, external_ref: null, published_at: null })
          .eq("id", p.id)
          .eq("status", "published");
      }
    } catch (e) {
      console.error("[publishing] TikTok status check failed:", e instanceof Error ? e.message : e);
    }
  }
  return resolved;
}
