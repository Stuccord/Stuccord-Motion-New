// Teams: make a team, invite people with a link, change roles, remove
// members, hand over ownership and delete the team. Members and invites are
// written with the admin client after the caller's role is checked here; the
// database lets signed-in users read only their own teams.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireSecondStep, hashApiKey } from "@/lib/api-keys.functions";
import { INVITE_DAYS, TEAMS_OWNED_LIMIT, planFor, type TeamRole } from "@/lib/plans";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

export type TeamSummary = {
  id: string;
  name: string;
  plan: string;
  role: TeamRole;
  members: number;
};

export type TeamMember = {
  user_id: string;
  name: string;
  email: string | null;
  role: TeamRole;
  joined_at: string;
  you: boolean;
};

export type TeamInvite = {
  id: string;
  role: Exclude<TeamRole, "owner">;
  uses: number;
  created_at: string;
  expires_at: string;
};

const TeamId = z.object({ teamId: z.string().uuid() });
const Name = z.string().trim().min(1).max(60);
const ManagedRole = z.enum(["admin", "editor", "viewer"]);

/** The caller's role in a team, or an error if they aren't in it. */
async function myRole(teamId: string, userId: string): Promise<TeamRole> {
  const db = await admin();
  const { data } = await db
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Team not found");
  return data.role as TeamRole;
}

const canManage = (r: TeamRole) => r === "owner" || r === "admin";

/** A random secret for an invite link (letters and digits). */
function newInviteSecret(): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const out: string[] = [];
  while (out.length < 32) {
    for (const b of crypto.getRandomValues(new Uint8Array(48))) {
      if (b < 248 && out.length < 32) out.push(ALPHABET[b % 62]);
    }
  }
  return out.join("");
}

export const listMyTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TeamSummary[]> => {
    const { data: mine, error } = await context.supabase
      .from("team_members")
      .select("team_id, role, teams(id, name, plan)")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const ids = (mine ?? []).map((m) => m.team_id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const { data: all } = await context.supabase
        .from("team_members")
        .select("team_id")
        .in("team_id", ids);
      for (const m of all ?? []) counts.set(m.team_id, (counts.get(m.team_id) ?? 0) + 1);
    }
    return (mine ?? [])
      .map((m) => {
        const t = m.teams as { id: string; name: string; plan: string } | null;
        return t
          ? {
              id: t.id,
              name: t.name,
              plan: t.plan,
              role: m.role as TeamRole,
              members: counts.get(t.id) ?? 1,
            }
          : null;
      })
      .filter((t): t is TeamSummary => !!t)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: Name }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { count } = await db
      .from("team_members")
      .select("team_id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("role", "owner");
    if ((count ?? 0) >= TEAMS_OWNED_LIMIT) {
      throw new Error(`You can own up to ${TEAMS_OWNED_LIMIT} teams`);
    }
    const { data: team, error } = await db
      .from("teams")
      .insert({ name: data.name, created_by: context.userId })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    const { error: mErr } = await db
      .from("team_members")
      .insert({ team_id: team.id, user_id: context.userId, role: "owner" });
    if (mErr) {
      await db.from("teams").delete().eq("id", team.id);
      throw new Error(mErr.message);
    }
    return team;
  });

export const renameTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.extend({ name: Name }).parse(d))
  .handler(async ({ data, context }) => {
    if (!canManage(await myRole(data.teamId, context.userId))) {
      throw new Error("Only the owner or an admin can rename the team");
    }
    const db = await admin();
    const { error } = await db.from("teams").update({ name: data.name }).eq("id", data.teamId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** A team with its members, open invites (for admins) and seat use. */
export const getTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.parse(d))
  .handler(async ({ data, context }) => {
    const role = await myRole(data.teamId, context.userId);
    const db = await admin();
    const { data: team } = await db
      .from("teams")
      .select("id, name, plan, created_at")
      .eq("id", data.teamId)
      .single();
    if (!team) throw new Error("Team not found");
    const { data: rows } = await db
      .from("team_members")
      .select("user_id, role, created_at")
      .eq("team_id", data.teamId);
    const members: TeamMember[] = await Promise.all(
      (rows ?? []).map(async (m) => {
        const { data: u } = await db.auth.admin.getUserById(m.user_id);
        const meta = (u?.user?.user_metadata ?? {}) as { full_name?: string };
        const email = u?.user?.email ?? null;
        return {
          user_id: m.user_id,
          name: meta.full_name || email?.split("@")[0] || "Member",
          email,
          role: m.role as TeamRole,
          joined_at: m.created_at,
          you: m.user_id === context.userId,
        };
      }),
    );
    const order: TeamRole[] = ["owner", "admin", "editor", "viewer"];
    members.sort(
      (a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name),
    );

    let invites: TeamInvite[] = [];
    if (canManage(role)) {
      const { data: inv } = await db
        .from("team_invites")
        .select("id, role, uses, created_at, expires_at")
        .eq("team_id", data.teamId)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      invites = (inv ?? []) as TeamInvite[];
    }
    const plan = planFor(team.plan);
    return {
      team: { id: team.id, name: team.name, plan: team.plan, planLabel: plan.label },
      role,
      members,
      invites,
      seats: { used: members.length, limit: plan.teamSeats },
    };
  });

/** Makes an invite link. The secret is returned once; only its hash is kept. */
export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.extend({ role: ManagedRole }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    const role = await myRole(data.teamId, context.userId);
    if (!canManage(role)) throw new Error("Only the owner or an admin can invite people");
    if (data.role === "admin" && role !== "owner") {
      throw new Error("Only the owner can invite admins");
    }
    const db = await admin();
    const { count: open } = await db
      .from("team_invites")
      .select("id", { count: "exact", head: true })
      .eq("team_id", data.teamId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    if ((open ?? 0) >= 20)
      throw new Error("This team has 20 open invite links. Revoke some first.");
    const secret = newInviteSecret();
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
    const { error } = await db.from("team_invites").insert({
      team_id: data.teamId,
      role: data.role,
      token_hash: await hashApiKey(secret),
      created_by: context.userId,
      expires_at: expires,
    });
    if (error) throw new Error(error.message);
    return { token: secret, expires_at: expires };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.extend({ inviteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!canManage(await myRole(data.teamId, context.userId))) {
      throw new Error("Only the owner or an admin can revoke invites");
    }
    const db = await admin();
    const { error } = await db
      .from("team_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .eq("team_id", data.teamId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const Token = z.object({ token: z.string().regex(/^[A-Za-z0-9]{32}$/) });

async function findInvite(token: string) {
  const db = await admin();
  const { data: inv } = await db
    .from("team_invites")
    .select("id, team_id, role, uses, expires_at, revoked_at, created_by")
    .eq("token_hash", await hashApiKey(token))
    .maybeSingle();
  if (!inv || inv.revoked_at || Date.parse(inv.expires_at) <= Date.now()) return null;
  return inv;
}

/** What an invite link is for, shown before joining. */
export const getInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Token.parse(d))
  .handler(async ({ data, context }) => {
    const inv = await findInvite(data.token);
    if (!inv) return { valid: false as const };
    const db = await admin();
    const { data: team } = await db
      .from("teams")
      .select("name, plan")
      .eq("id", inv.team_id)
      .maybeSingle();
    if (!team) return { valid: false as const };
    let invitedBy: string | null = null;
    if (inv.created_by) {
      const { data: u } = await db.auth.admin.getUserById(inv.created_by);
      invitedBy =
        (u?.user?.user_metadata as { full_name?: string } | undefined)?.full_name ||
        u?.user?.email?.split("@")[0] ||
        null;
    }
    const { data: mine } = await db
      .from("team_members")
      .select("role")
      .eq("team_id", inv.team_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    const { count } = await db
      .from("team_members")
      .select("user_id", { count: "exact", head: true })
      .eq("team_id", inv.team_id);
    return {
      valid: true as const,
      teamId: inv.team_id,
      teamName: team.name,
      role: inv.role as Exclude<TeamRole, "owner">,
      invitedBy,
      alreadyMember: !!mine,
      full: (count ?? 0) >= planFor(team.plan).teamSeats,
    };
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Token.parse(d))
  .handler(async ({ data, context }) => {
    const inv = await findInvite(data.token);
    if (!inv) throw new Error("This invite link has expired or was revoked. Ask for a new one.");
    const db = await admin();
    const { data: mine } = await db
      .from("team_members")
      .select("role")
      .eq("team_id", inv.team_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (mine) return { teamId: inv.team_id, already: true };
    const { data: team } = await db.from("teams").select("plan").eq("id", inv.team_id).single();
    const { count } = await db
      .from("team_members")
      .select("user_id", { count: "exact", head: true })
      .eq("team_id", inv.team_id);
    const seats = planFor(team?.plan).teamSeats;
    if ((count ?? 0) >= seats) {
      throw new Error(
        `This team is full (${seats} people on its plan). Ask an admin to make room.`,
      );
    }
    const { error } = await db
      .from("team_members")
      .insert({ team_id: inv.team_id, user_id: context.userId, role: inv.role });
    if (error) throw new Error(error.message);
    await db
      .from("team_invites")
      .update({ uses: inv.uses + 1 })
      .eq("id", inv.id);
    return { teamId: inv.team_id, already: false };
  });

export const changeMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    TeamId.extend({ userId: z.string().uuid(), role: ManagedRole }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    const me = await myRole(data.teamId, context.userId);
    if (!canManage(me)) throw new Error("Only the owner or an admin can change roles");
    if (data.userId === context.userId) throw new Error("You can't change your own role");
    const them = await myRole(data.teamId, data.userId).catch(() => {
      throw new Error("That person isn't in the team");
    });
    if (them === "owner") throw new Error("To change the owner, the owner hands over ownership");
    if (me === "admin" && (them === "admin" || data.role === "admin")) {
      throw new Error("Only the owner can make or change admins");
    }
    const db = await admin();
    const { error } = await db
      .from("team_members")
      .update({ role: data.role })
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.extend({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    const me = await myRole(data.teamId, context.userId);
    if (!canManage(me)) throw new Error("Only the owner or an admin can remove people");
    if (data.userId === context.userId) throw new Error("Use Leave team to leave");
    const them = await myRole(data.teamId, data.userId).catch(() => {
      throw new Error("That person isn't in the team");
    });
    if (them === "owner") throw new Error("The owner can't be removed");
    if (me === "admin" && them === "admin") throw new Error("Only the owner can remove admins");
    const db = await admin();
    const { error } = await db
      .from("team_members")
      .delete()
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const leaveTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.parse(d))
  .handler(async ({ data, context }) => {
    const me = await myRole(data.teamId, context.userId);
    if (me === "owner") {
      throw new Error("Hand over ownership first, or delete the team");
    }
    const db = await admin();
    const { error } = await db
      .from("team_members")
      .delete()
      .eq("team_id", data.teamId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** The owner hands the team to another member and becomes an admin. */
export const transferOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.extend({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    if ((await myRole(data.teamId, context.userId)) !== "owner") {
      throw new Error("Only the owner can hand over the team");
    }
    if (data.userId === context.userId) throw new Error("You already own it");
    await myRole(data.teamId, data.userId).catch(() => {
      throw new Error("That person isn't in the team");
    });
    const db = await admin();
    // One owner at a time: step down first, then promote.
    const { error: e1 } = await db
      .from("team_members")
      .update({ role: "admin" })
      .eq("team_id", data.teamId)
      .eq("user_id", context.userId);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await db
      .from("team_members")
      .update({ role: "owner" })
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);
    if (e2) {
      await db
        .from("team_members")
        .update({ role: "owner" })
        .eq("team_id", data.teamId)
        .eq("user_id", context.userId);
      throw new Error(e2.message);
    }
    return { ok: true };
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.extend({ confirmName: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSecondStep(context.userId, context.claims);
    if ((await myRole(data.teamId, context.userId)) !== "owner") {
      throw new Error("Only the owner can delete the team");
    }
    const db = await admin();
    const { data: team } = await db.from("teams").select("name").eq("id", data.teamId).single();
    if (!team || data.confirmName.trim() !== team.name) {
      throw new Error("Type the team's name exactly to delete it");
    }
    // Nothing is lost by accident: its projects are moved out or deleted first.
    const { count: projects } = await db
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("team_id", data.teamId);
    if ((projects ?? 0) > 0) {
      throw new Error(
        `The team still has ${projects} project${projects === 1 ? "" : "s"}. Move them out or delete them first.`,
      );
    }
    const { error } = await db.from("teams").delete().eq("id", data.teamId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- brand kit and allowances ----------

/** A team's brand kit (any member can read it; team projects always use it). */
export const getTeamBrandKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.parse(d))
  .handler(async ({ data, context }) => {
    const role = await myRole(data.teamId, context.userId);
    const db = await admin();
    const { data: team } = await db
      .from("teams")
      .select("brand_kit")
      .eq("id", data.teamId)
      .maybeSingle();
    const { parseBrandKit } = await import("@/lib/brand-kit");
    return { kit: parseBrandKit(team?.brand_kit), canEdit: canManage(role) };
  });

/** Saves a team's brand kit (owner and admins). Its logo must be in the team's folder. */
export const saveTeamBrandKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TeamId.extend({ kit: z.unknown() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!canManage(await myRole(data.teamId, context.userId))) {
      throw new Error("Only the team's owner and admins can change its brand kit");
    }
    const { parseBrandKit } = await import("@/lib/brand-kit");
    const kit = parseBrandKit(data.kit);
    const folder = `teams/${data.teamId}/brand/`;
    if (kit.logo && (!kit.logo.path.startsWith(folder) || kit.logo.path.includes(".."))) {
      throw new Error("The team's logo has to be uploaded to the team");
    }
    const db = await admin();
    const { error } = await db.from("teams").update({ brand_kit: kit }).eq("id", data.teamId);
    if (error) throw new Error(error.message);
    return { kit };
  });

/** This month's exports: your own allowance and each of your teams'. */
export const listAllowances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { exportAllowance } = await import("@/lib/projects.functions");
    const { data: mine } = await context.supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", context.userId);
    const personal = await exportAllowance(context.userId, null);
    const teams = await Promise.all(
      (mine ?? []).map((m) => exportAllowance(context.userId, m.team_id)),
    );
    teams.sort((a, b) => (a.team?.name ?? "").localeCompare(b.team?.name ?? ""));
    return { personal, teams };
  });
