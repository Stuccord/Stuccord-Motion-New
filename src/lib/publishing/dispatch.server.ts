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
import { openToken, sealToken } from "./crypto.server";
import { provider, ReconnectNeeded } from "./providers.server";

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
  if (left > minLeftMs || !account.refresh_token_enc) {
    return openToken(account.access_token_enc, account.user_id);
  }
  try {
    const refresh = await openToken(account.refresh_token_enc, account.user_id);
    const t = await provider(account.platform as Platform).refresh(refresh);
    const patch = {
      access_token_enc: await sealToken(t.access_token, account.user_id),
      ...(t.refresh_token
        ? { refresh_token_enc: await sealToken(t.refresh_token, account.user_id) }
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
    }
    throw e;
  }
}

async function markFailed(db: Db, post: PostRow, error: string) {
  await db
    .from("social_posts")
    .update({ status: "failed", error: error.slice(0, 500) })
    .eq("id", post.id)
    .eq("status", "uploading");
}

/** Sends one claimed post (status "uploading") to the worker. */
async function sendPost(db: Db, post: PostRow) {
  const owned = (p: string | null) => !p || (p.startsWith(`${post.user_id}/`) && !p.includes(".."));
  if (!owned(post.video_path) || !owned(post.cover_path)) {
    return markFailed(db, post, "That video isn't in your files");
  }
  if (!post.account_id) return markFailed(db, post, "The account was disconnected");
  const { data: account } = await db
    .from("social_accounts")
    .select("*")
    .eq("id", post.account_id)
    .eq("user_id", post.user_id)
    .maybeSingle();
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
      access_token: accessToken,
      video_url: video.signedUrl,
      cover_url: coverUrl,
      title: post.title,
      caption: post.caption,
      privacy: post.privacy,
      made_for_kids: post.made_for_kids,
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
    .select("id, user_id, account_id, external_id, published_at, stats_updated_at")
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
        if (p.user_id !== account.user_id) continue;
        const s = stats.get(p.external_id!);
        await db
          .from("social_posts")
          .update({ ...(s ?? {}), stats_updated_at: new Date().toISOString() })
          .eq("id", p.id)
          .eq("user_id", account.user_id);
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
