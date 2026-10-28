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
  type Platform,
  type SocialAccount,
  type SocialPost,
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
      const token = await openToken(
        account.refresh_token_enc ?? account.access_token_enc,
        context.userId,
      );
      await provider(account.platform as Platform).revoke(token);
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
        "id, project_id, account_id, platform, account_name, title, caption, privacy, scheduled_at, status, error, external_url, published_at, views, likes, comments, stats_updated_at, projects(title)",
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

const PostInput = z.object({
  projectId: z.string().uuid(),
  accountIds: z.array(z.string().uuid()).min(1).max(10),
  title: z.string().trim().max(TITLE_MAX),
  caption: z.string().max(CAPTION_MAX),
  privacy: z.enum(["public", "unlisted", "private"]),
  madeForKids: z.boolean(),
  /** null = post now. */
  scheduledAt: z.string().datetime().nullable(),
});

/** Makes one post per chosen account for a project's latest export. */
export const createPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PostInput.parse(d))
  .handler(async ({ data, context }) => {
    // YouTube rejects these in titles.
    const title = data.title.replace(/[<>]/g, "").trim();
    if (!title) throw new Error("Add a title");
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
      .select("id, platform, name, status")
      .eq("user_id", context.userId)
      .in("id", data.accountIds);
    if (aErr) throw new Error(aErr.message);
    if ((accounts ?? []).length !== new Set(data.accountIds).size)
      throw new Error("Account not found");
    const stale = (accounts ?? []).find((a) => a.status !== "active");
    if (stale) throw new Error(`Reconnect ${stale.name} on the Publishing page first`);

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
      .update({ status: "scheduled", scheduled_at: when.toISOString(), error: null, attempts: 0 })
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
