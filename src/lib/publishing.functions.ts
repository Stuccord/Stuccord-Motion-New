// Publishing: connect accounts, post finished exports now or at a set time,
// and see how posts are doing. Sign-in tokens are only handled here and in
// src/lib/publishing/*.server.ts; pages never see them.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireSecondStep } from "@/lib/api-keys.functions";
import { isCoverPath } from "@/lib/projects.functions";
import {
  CAPTION_MAX,
  PLATFORMS,
  SCHEDULED_LIMIT,
  SCHEDULE_MAX_AHEAD_DAYS,
  SCHEDULE_MIN_AHEAD_MS,
  TITLE_MAX,
  TIKTOK_CAPTION_MAX,
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_HASHTAG_MAX,
  countHashtags,
  type Platform,
  type SocialAccount,
  type SocialPost,
  type TikTokCreatorInfo,
} from "@/lib/publishing-shared";

/** Accounts a user can connect on one platform. */
const ACCOUNTS_PER_PLATFORM = 10;

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
const server = () =>
  Promise.all([
    import("@/lib/publishing/providers.server"),
    import("@/lib/publishing/crypto.server"),
    import("@/lib/publishing/dispatch.server"),
  ]).then(([providers, crypto, dispatch]) => ({ ...providers, ...crypto, ...dispatch }));

/** Which platforms are set up on this server (have their app keys). */
export const getPublishingSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { availablePlatforms } = await server();
    const ready =
      !!process.env.PUBLISHING_TOKEN_KEY?.trim() && !!process.env.PUBLIC_APP_URL?.trim();
    return { platforms: ready ? availablePlatforms() : ([] as Platform[]) };
  });

export const listSocialAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SocialAccount[]> => {
    const { data, error } = await context.supabase
      .from("social_accounts")
      .select("id, platform, name, avatar_url, status, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as SocialAccount[];
  });

/** The platform's sign-in page to send the user to. */
export const startConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ platform: z.enum(PLATFORMS) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    const { provider, redirectUri, signState } = await server();
    const p = provider(data.platform);
    if (!p.configured()) throw new Error("Posting there isn't set up yet");
    const state = await signState({ uid: context.userId, platform: data.platform });
    return { url: p.authUrl({ state, redirectUri: redirectUri(data.platform) }) };
  });

/** Finishes connecting, after the platform sends the user back with a code. */
export const finishConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        platform: z.enum(PLATFORMS),
        code: z.string().min(1).max(2000),
        state: z.string().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { provider, redirectUri, verifyState, sealToken } = await server();
    const state = await verifyState(data.state);
    if (state.uid !== context.userId || state.platform !== data.platform) {
      throw new Error("This sign-in was started from a different account. Try connecting again.");
    }
    const p = provider(data.platform);
    const tokens = await p.exchange({ code: data.code, redirectUri: redirectUri(data.platform) });
    const profile = await p.profile(tokens.access_token);

    const db = await admin();
    const { data: existing } = await db
      .from("social_accounts")
      .select("id, refresh_token_enc")
      .eq("user_id", context.userId)
      .eq("platform", data.platform)
      .eq("external_id", profile.external_id)
      .maybeSingle();
    if (!existing) {
      const { count } = await db
        .from("social_accounts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .eq("platform", data.platform);
      if ((count ?? 0) >= ACCOUNTS_PER_PLATFORM) {
        throw new Error(`You can connect up to ${ACCOUNTS_PER_PLATFORM} accounts on each platform`);
      }
    }
    const row = {
      user_id: context.userId,
      platform: data.platform,
      external_id: profile.external_id,
      name: profile.name,
      avatar_url: profile.avatar_url,
      access_token_enc: await sealToken(tokens.access_token, context.userId),
      // Keep the old refresh token if the platform didn't send a new one.
      refresh_token_enc: tokens.refresh_token
        ? await sealToken(tokens.refresh_token, context.userId)
        : (existing?.refresh_token_enc ?? null),
      token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      scopes: tokens.scope?.slice(0, 1000) ?? null,
      status: "active",
    };
    const { error } = existing
      ? await db
          .from("social_accounts")
          .update(row)
          .eq("id", existing.id)
          .eq("user_id", context.userId)
      : await db.from("social_accounts").insert(row);
    if (error) throw new Error(error.message);
    return { name: profile.name, reconnected: !!existing };
  });

/** Disconnects an account: signs out of it and cancels its waiting posts. */
export const disconnectAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    const db = await admin();
    const { data: account } = await db
      .from("social_accounts")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!account) throw new Error("Account not found");
    const { provider, openToken } = await server();
    try {
      const p = provider(account.platform as Platform);
      const sealed =
        p.revokeWith === "refresh" && account.refresh_token_enc
          ? account.refresh_token_enc
          : account.access_token_enc;
      await p.revoke(await openToken(sealed, context.userId));
    } catch (e) {
      // Still disconnect here: the user can remove access on the platform too.
      console.error("[publishing] Revoking a token failed:", e instanceof Error ? e.message : e);
    }
    await db
      .from("social_posts")
      .update({ status: "canceled", error: "The account was disconnected" })
      .eq("account_id", account.id)
      .eq("user_id", context.userId)
      .eq("status", "scheduled");
    const { error } = await db
      .from("social_accounts")
      .delete()
      .eq("id", account.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SocialPost[]> => {
    const { data, error } = await context.supabase
      .from("social_posts")
      .select(
        "id, project_id, account_id, platform, account_name, title, caption, privacy, options, scheduled_at, status, error, external_url, published_at, views, likes, comments, stats_updated_at, projects(title)",
      )
      .eq("user_id", context.userId)
      .order("scheduled_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []).map(({ projects, ...p }) => ({
      ...p,
      project_title: (projects as { title: string } | null)?.title ?? null,
    })) as SocialPost[];
  });

const TikTokOptionsInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("direct"),
    privacy_level: z.enum([
      "PUBLIC_TO_EVERYONE",
      "MUTUAL_FOLLOW_FRIENDS",
      "FOLLOWER_OF_CREATOR",
      "SELF_ONLY",
    ]),
    allow_comment: z.boolean(),
    allow_duet: z.boolean(),
    allow_stitch: z.boolean(),
    brand_organic: z.boolean(),
    brand_content: z.boolean(),
  }),
  z.object({ mode: z.literal("draft") }),
]);

const PostInput = z.object({
  projectId: z.string().uuid(),
  accountIds: z.array(z.string().uuid()).min(1).max(10),
  title: z.string().trim().max(TITLE_MAX),
  caption: z.string().max(CAPTION_MAX),
  privacy: z.enum(["public", "unlisted", "private"]),
  madeForKids: z.boolean(),
  /** The TikTok choices for each TikTok account, by account id. */
  tiktok: z.record(z.string().uuid(), TikTokOptionsInput).default({}),
  /** Reel or Story for each Instagram account, by account id. */
  instagram: z
    .record(
      z.string().uuid(),
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("reel"), share_to_feed: z.boolean() }),
        z.object({ kind: z.literal("story") }),
      ]),
    )
    .default({}),
  /** null = post now. */
  scheduledAt: z.string().datetime().nullable(),
});

/** A TikTok account's sign-in, ready to call the API (refreshed if needed). */
async function tiktokToken(userId: string, accountId: string) {
  const db = await admin();
  const { data: account } = await db
    .from("social_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .eq("platform", "tiktok")
    .maybeSingle();
  if (!account) throw new Error("Account not found");
  if (account.status !== "active") throw new Error(`Reconnect ${account.name} first`);
  const { accessTokenFor } = await server();
  return { account, token: await accessTokenFor(db, account, 5 * 60 * 1000) };
}

/**
 * What a TikTok account can post right now: its name, the "who can see"
 * choices, and whether comments, Duet and Stitch are off for it. TikTok asks
 * apps to check this each time they show the posting form.
 */
export const getTikTokCreatorInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TikTokCreatorInfo> => {
    const { token } = await tiktokToken(context.userId, data.accountId);
    const { tiktokCreatorInfo } = await import("@/lib/publishing/tiktok.server");
    return tiktokCreatorInfo(token);
  });

/** A short-lived link to a project's latest export, to preview it before posting. */
export const getExportPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: project } = await context.supabase
      .from("projects")
      .select("output_path")
      .eq("id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!project?.output_path?.startsWith(`${context.userId}/`)) return { url: null, ext: null };
    const { data: signed } = await context.supabase.storage
      .from("renders")
      .createSignedUrl(project.output_path, 60 * 60);
    // Browser exports can be WebM, which Instagram doesn't take.
    const ext = project.output_path.split(".").pop()?.toLowerCase() ?? null;
    return { url: signed?.signedUrl ?? null, ext };
  });

/** Makes one post per chosen account for a project's latest export. */
export const createPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PostInput.parse(d))
  .handler(async ({ data, context }) => {
    // YouTube rejects these in titles.
    const title = data.title.replace(/[<>]/g, "").trim();
    let when = new Date();
    if (data.scheduledAt) {
      when = new Date(data.scheduledAt);
      const ahead = when.getTime() - Date.now();
      if (ahead < SCHEDULE_MIN_AHEAD_MS) throw new Error("Pick a time at least 5 minutes from now");
      if (ahead > SCHEDULE_MAX_AHEAD_DAYS * 86_400_000) {
        throw new Error(`Posts can be scheduled up to ${SCHEDULE_MAX_AHEAD_DAYS} days ahead`);
      }
    }

    const { data: project } = await context.supabase
      .from("projects")
      .select("id, output_path, thumbnail_url")
      .eq("id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");
    if (!project.output_path || !project.output_path.startsWith(`${context.userId}/`)) {
      throw new Error("Export this project first, then post it");
    }

    const { data: accounts, error: aErr } = await context.supabase
      .from("social_accounts")
      .select("id, platform, name, status, scopes")
      .eq("user_id", context.userId)
      .in("id", data.accountIds);
    if (aErr) throw new Error(aErr.message);
    if ((accounts ?? []).length !== new Set(data.accountIds).size)
      throw new Error("Account not found");
    const stale = (accounts ?? []).find((a) => a.status !== "active");
    if (stale) throw new Error(`Reconnect ${stale.name} on the Publishing page first`);
    if (!title && accounts!.some((a) => a.platform === "youtube")) {
      throw new Error("Add a title for YouTube");
    }

    // TikTok: check each account's choices against what TikTok allows it now.
    for (const a of accounts!.filter((x) => x.platform === "tiktok")) {
      const o = data.tiktok[a.id];
      if (!o) throw new Error(`Choose how to post to ${a.name}`);
      if ((data.caption.trim() || title).length > TIKTOK_CAPTION_MAX) {
        throw new Error(`TikTok captions can be up to ${TIKTOK_CAPTION_MAX} characters`);
      }
      const scopes = (a.scopes ?? "").split(/[\s,]+/);
      const need = o.mode === "direct" ? "video.publish" : "video.upload";
      if (a.scopes && !scopes.includes(need)) {
        throw new Error(`Reconnect ${a.name} and allow posting: a TikTok permission is missing`);
      }
      if (o.mode === "direct") {
        if (o.brand_content && o.privacy_level === "SELF_ONLY") {
          throw new Error("Branded content can't be private on TikTok");
        }
        const { token } = await tiktokToken(context.userId, a.id);
        const { tiktokCreatorInfo } = await import("@/lib/publishing/tiktok.server");
        const info = await tiktokCreatorInfo(token);
        if (!info.privacy_level_options.includes(o.privacy_level)) {
          throw new Error(`That "who can see" choice isn't available for ${a.name}`);
        }
        if (
          (o.allow_comment && info.comment_disabled) ||
          (o.allow_duet && info.duet_disabled) ||
          (o.allow_stitch && info.stitch_disabled)
        ) {
          throw new Error(`${a.name} has comments, Duet or Stitch turned off in TikTok`);
        }
      }
    }

    // Instagram: Reels carry the caption (Stories have none).
    for (const a of accounts!.filter((x) => x.platform === "instagram")) {
      const o = data.instagram[a.id];
      if (!o) throw new Error(`Choose a Reel or a Story for ${a.name}`);
      if (/\.webm$/i.test(project.output_path)) {
        throw new Error("Instagram needs an MP4. Export with Render Video, then post.");
      }
      const scopes = (a.scopes ?? "").split(/[\s,]+/);
      if (a.scopes && !scopes.includes("instagram_business_content_publish")) {
        throw new Error(
          `Reconnect ${a.name} and allow posting: an Instagram permission is missing`,
        );
      }
      if (o.kind === "reel") {
        const text = data.caption.trim() || title;
        if (text.length > INSTAGRAM_CAPTION_MAX) {
          throw new Error(`Instagram captions can be up to ${INSTAGRAM_CAPTION_MAX} characters`);
        }
        if (countHashtags(text) > INSTAGRAM_HASHTAG_MAX) {
          throw new Error(`Instagram allows up to ${INSTAGRAM_HASHTAG_MAX} hashtags`);
        }
      }
    }

    const { count } = await context.supabase
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "scheduled");
    if ((count ?? 0) + accounts!.length > SCHEDULED_LIMIT) {
      throw new Error(`You can have up to ${SCHEDULED_LIMIT} posts waiting. Cancel some first.`);
    }

    const { data: rows, error } = await context.supabase
      .from("social_posts")
      .insert(
        accounts!.map((a) => ({
          user_id: context.userId,
          project_id: project.id,
          account_id: a.id,
          platform: a.platform,
          account_name: a.name,
          title,
          caption: data.caption,
          privacy: data.privacy,
          made_for_kids: data.madeForKids,
          options:
            a.platform === "tiktok"
              ? data.tiktok[a.id]
              : a.platform === "instagram"
                ? data.instagram[a.id]
                : {},
          video_path: project.output_path!,
          cover_path: isCoverPath(project.thumbnail_url) ? project.thumbnail_url : null,
          scheduled_at: when.toISOString(),
        })),
      )
      .select("id");
    if (error) throw new Error(error.message);

    if (!data.scheduledAt) {
      const { dispatchDuePosts } = await server();
      await dispatchDuePosts(await admin(), {
        ids: (rows ?? []).map((r) => r.id),
        userId: context.userId,
      });
    }
    return { created: rows?.length ?? 0, scheduled: !!data.scheduledAt };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const cancelPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("social_posts")
      .update({ status: "canceled" })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That post isn't waiting any more");
    return { ok: true };
  });

/** Moves a waiting post, or tries a failed one again (now or at a new time). */
export const reschedulePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    IdInput.extend({ scheduledAt: z.string().datetime().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let when = new Date();
    if (data.scheduledAt) {
      when = new Date(data.scheduledAt);
      const ahead = when.getTime() - Date.now();
      if (ahead < SCHEDULE_MIN_AHEAD_MS) throw new Error("Pick a time at least 5 minutes from now");
      if (ahead > SCHEDULE_MAX_AHEAD_DAYS * 86_400_000) {
        throw new Error(`Posts can be scheduled up to ${SCHEDULE_MAX_AHEAD_DAYS} days ahead`);
      }
    }
    const { data: row, error } = await context.supabase
      .from("social_posts")
      .update({
        status: "scheduled",
        scheduled_at: when.toISOString(),
        error: null,
        attempts: 0,
        external_ref: null,
      })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .in("status", ["scheduled", "failed"])
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That post can't be changed now");
    if (!data.scheduledAt) {
      const { dispatchDuePosts } = await server();
      await dispatchDuePosts(await admin(), { ids: [row.id], userId: context.userId });
    }
    return { ok: true };
  });

/** Removes a canceled or failed post from the list. */
export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_posts")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .in("status", ["canceled", "failed"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
