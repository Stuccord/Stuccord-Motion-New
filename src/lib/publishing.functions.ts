// Publishing: connect accounts, post finished exports now or at a set time,
// and see how posts are doing. Sign-in tokens are only handled here and in
// src/lib/publishing/*.server.ts; pages never see them.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireSecondStep } from "@/lib/api-keys.functions";
import { isCoverPath } from "@/lib/projects.functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { TeamRole } from "@/lib/plans";
import { PERSONAL, inFolder, projectFolder } from "@/lib/workspace";
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

/** "personal" (the default) or a team's id. */
const WorkspaceInput = z
  .object({ workspace: z.union([z.literal(PERSONAL), z.string().uuid()]).default(PERSONAL) })
  .default({ workspace: PERSONAL });

/** The caller's role in a team, or null. */
async function roleIn(teamId: string, userId: string): Promise<TeamRole | null> {
  const db = await admin();
  const { data } = await db
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as TeamRole | undefined) ?? null;
}
const manages = (r: TeamRole | null) => r === "owner" || r === "admin";
const posts = (r: TeamRole | null) => r === "owner" || r === "admin" || r === "editor";

/**
 * An account the caller may post to (theirs, or their team's as an Editor or
 * up), with the admin client, for the server's own checks.
 */
async function postableAccount(userId: string, accountId: string) {
  const db = await admin();
  const { data: account } = await db
    .from("social_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return null;
  if (account.team_id) return posts(await roleIn(account.team_id, userId)) ? account : null;
  return account.user_id === userId ? account : null;
}

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
  .inputValidator((d: unknown) => WorkspaceInput.parse(d))
  .handler(async ({ data: input, context }): Promise<SocialAccount[]> => {
    let q = context.supabase
      .from("social_accounts")
      .select("id, platform, name, avatar_url, status, created_at")
      .order("created_at", { ascending: true });
    q =
      input.workspace === PERSONAL
        ? q.eq("user_id", context.userId).is("team_id", null)
        : q.eq("team_id", input.workspace);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as SocialAccount[];
  });

/** The platform's sign-in page to send the user to. */
export const startConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ platform: z.enum(PLATFORMS), teamId: z.string().uuid().nullable().optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    if (data.teamId && !manages(await roleIn(data.teamId, context.userId))) {
      throw new Error("Only the team's owner and admins can connect its accounts");
    }
    const { provider, redirectUri, signState } = await server();
    const p = provider(data.platform);
    if (!p.configured()) throw new Error("Posting there isn't set up yet");
    const state = await signState({
      uid: context.userId,
      platform: data.platform,
      ...(data.teamId ? { team: data.teamId } : {}),
    });
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
    const { provider, redirectUri, verifyState, sealToken, tokenOwner } = await server();
    const state = await verifyState(data.state);
    if (state.uid !== context.userId || state.platform !== data.platform) {
      throw new Error("This sign-in was started from a different account. Try connecting again.");
    }
    // For a team: still its owner or an admin.
    const team = state.team ?? null;
    if (team && !manages(await roleIn(team, context.userId))) {
      throw new Error("Only the team's owner and admins can connect its accounts");
    }
    const owner = tokenOwner({ user_id: context.userId, team_id: team });
    const p = provider(data.platform);
    const tokens = await p.exchange({ code: data.code, redirectUri: redirectUri(data.platform) });
    const profile = await p.profile(tokens.access_token);

    const db = await admin();
    // The same account already connected here (the person's own, or the team's).
    const mine = <T extends { eq: (k: string, v: string) => T; is: (k: string, v: null) => T }>(
      q: T,
    ) => (team ? q.eq("team_id", team) : q.eq("user_id", context.userId).is("team_id", null));
    const { data: existing } = await mine(
      db.from("social_accounts").select("id, refresh_token_enc"),
    )
      .eq("platform", data.platform)
      .eq("external_id", profile.external_id)
      .maybeSingle();
    if (!existing) {
      const { count } = await mine(
        db.from("social_accounts").select("id", { count: "exact", head: true }),
      ).eq("platform", data.platform);
      if ((count ?? 0) >= ACCOUNTS_PER_PLATFORM) {
        throw new Error(`You can connect up to ${ACCOUNTS_PER_PLATFORM} accounts on each platform`);
      }
    }
    const row = {
      user_id: context.userId,
      team_id: team,
      platform: data.platform,
      external_id: profile.external_id,
      name: profile.name,
      avatar_url: profile.avatar_url,
      access_token_enc: await sealToken(tokens.access_token, owner),
      // Keep the old refresh token if the platform didn't send a new one.
      refresh_token_enc: tokens.refresh_token
        ? await sealToken(tokens.refresh_token, owner)
        : (existing?.refresh_token_enc ?? null),
      token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      scopes: tokens.scope?.slice(0, 1000) ?? null,
      status: "active",
    };
    const { error } = existing
      ? await db.from("social_accounts").update(row).eq("id", existing.id)
      : await db.from("social_accounts").insert(row);
    if (error) throw new Error(error.message);
    return { name: profile.name, reconnected: !!existing, teamId: team };
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
      .maybeSingle();
    // Your own account, or a team's if you're its owner or an admin.
    const allowed = account
      ? account.team_id
        ? manages(await roleIn(account.team_id, context.userId))
        : account.user_id === context.userId
      : false;
    if (!account || !allowed) {
      throw new Error(
        account?.team_id
          ? "Only the team's owner and admins can disconnect it"
          : "Account not found",
      );
    }
    const { provider, openToken, tokenOwner } = await server();
    try {
      const p = provider(account.platform as Platform);
      const sealed =
        p.revokeWith === "refresh" && account.refresh_token_enc
          ? account.refresh_token_enc
          : account.access_token_enc;
      await p.revoke(await openToken(sealed, tokenOwner(account)));
    } catch (e) {
      // Still disconnect here: the user can remove access on the platform too.
      console.error("[publishing] Revoking a token failed:", e instanceof Error ? e.message : e);
    }
    await db
      .from("social_posts")
      .update({ status: "canceled", error: "The account was disconnected" })
      .eq("account_id", account.id)
      .eq("status", "scheduled");
    const { error } = await db.from("social_accounts").delete().eq("id", account.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WorkspaceInput.parse(d))
  .handler(async ({ data: input, context }): Promise<SocialPost[]> => {
    const team = input.workspace === PERSONAL ? null : input.workspace;
    let q = context.supabase
      .from("social_posts")
      .select(
        "id, user_id, project_id, account_id, platform, account_name, title, caption, privacy, options, scheduled_at, status, error, external_url, published_at, views, likes, comments, stats_updated_at, projects(title)",
      )
      .order("scheduled_at", { ascending: false })
      .limit(300);
    q = team ? q.eq("team_id", team) : q.eq("user_id", context.userId).is("team_id", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const role = team ? await roleIn(team, context.userId) : null;
    // Who posted each one (a team's posts come from several people).
    const names = new Map<string, string>();
    if (team) {
      const db = await admin();
      for (const uid of new Set((data ?? []).map((p) => p.user_id))) {
        const { data: u } = await db.auth.admin.getUserById(uid);
        const meta = (u?.user?.user_metadata ?? {}) as { full_name?: string };
        names.set(uid, meta.full_name || u?.user?.email?.split("@")[0] || "Someone");
      }
    }
    return (data ?? []).map(({ projects, user_id, ...p }) => ({
      ...p,
      project_title: (projects as { title: string } | null)?.title ?? null,
      by: team ? (user_id === context.userId ? "you" : (names.get(user_id) ?? null)) : null,
      // Move, cancel, retry or remove: whoever posted it, or the team's owner and admins.
      can_manage: !team || manages(role) || (role === "editor" && user_id === context.userId),
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
  const account = await postableAccount(userId, accountId);
  if (!account || account.platform !== "tiktok") throw new Error("Account not found");
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
      .select("output_path, user_id, team_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project?.output_path || !inFolder(project.output_path, projectFolder(project))) {
      return { url: null, ext: null };
    }
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
      .select("id, output_path, thumbnail_url, team_id, user_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");
    // A team project: Editors and up post it, to the team's accounts only.
    const team = project.team_id;
    if (team && !posts(await roleIn(team, context.userId))) {
      throw new Error("Viewers can't post the team's projects");
    }
    if (!team && project.user_id !== context.userId) throw new Error("Project not found");
    if (!project.output_path || !inFolder(project.output_path, projectFolder(project))) {
      throw new Error("Export this project first, then post it");
    }

    let aq = context.supabase
      .from("social_accounts")
      .select("id, platform, name, status, scopes")
      .in("id", data.accountIds);
    aq = team ? aq.eq("team_id", team) : aq.eq("user_id", context.userId).is("team_id", null);
    const { data: accounts, error: aErr } = await aq;
    if (aErr) throw new Error(aErr.message);
    if ((accounts ?? []).length !== new Set(data.accountIds).size) {
      throw new Error(
        team
          ? "Team projects go to the team's accounts only"
          : "Personal projects go to your own accounts only",
      );
    }
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
          team_id: team,
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

/** A post the caller may change: theirs, or (for a team post) as its owner or an admin. */
async function postToChange(supabase: SupabaseClient<Database>, userId: string, id: string) {
  const { data: post } = await supabase
    .from("social_posts")
    .select("id, user_id, team_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!post) throw new Error("Post not found");
  const role = post.team_id ? await roleIn(post.team_id, userId) : null;
  const ok = post.team_id
    ? manages(role) || (role === "editor" && post.user_id === userId)
    : post.user_id === userId;
  if (!ok) throw new Error("Only whoever posted it, or the team's owner and admins, can change it");
  return post;
}

export const cancelPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await postToChange(context.supabase, context.userId, data.id);
    const { data: row, error } = await context.supabase
      .from("social_posts")
      .update({ status: "canceled" })
      .eq("id", data.id)
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
    await postToChange(context.supabase, context.userId, data.id);
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
      .in("status", ["scheduled", "failed"])
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That post can't be changed now");
    if (!data.scheduledAt) {
      const { dispatchDuePosts } = await server();
      // (Checked above; an admin may retry someone else's team post.)
      await dispatchDuePosts(await admin(), { ids: [row.id] });
    }
    return { ok: true };
  });

/** Removes a canceled or failed post from the list. */
export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await postToChange(context.supabase, context.userId, data.id);
    const { error } = await context.supabase
      .from("social_posts")
      .delete()
      .eq("id", data.id)
      .in("status", ["canceled", "failed"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
