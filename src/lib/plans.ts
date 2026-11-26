// What each plan includes. Limits are read from here (and enforced by the
// server), so paid plans only need new entries. Everyone is on Free until
// payments exist; a team's plan is stored on the team (teams.plan).

export type PlanId = "free";

export type Plan = {
  label: string;
  /** Exports a month in a personal workspace. */
  personalExports: number;
  /** Exports a month for a team, shared by its members. */
  teamExports: number;
  /** People in a team, the owner included. */
  teamSeats: number;
  /** AI graphics plans (Motion Explainer) a month in a personal workspace. */
  personalPlans: number;
  /** AI graphics plans a month for a team, shared by its members. */
  teamPlans: number;
  /** AI story pictures a month in a personal workspace. */
  personalImages: number;
  /** AI story pictures a month for a team, shared by its members. */
  teamImages: number;
  /** Exports carry the "Made with Stuccord" watermark (not for the app's owner). */
  watermark: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    label: "Free",
    personalExports: 5,
    teamExports: 5,
    teamSeats: 3,
    // Kept low while everyone is free: each AI plan and picture costs money.
    personalPlans: 3,
    teamPlans: 3,
    personalImages: 10,
    teamImages: 10,
    // Paid plans (when payments exist) export without it.
    watermark: true,
  },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? "free") as PlanId] ?? PLANS.free;
}

/**
 * The cap the app's owner gets (owner.server.ts): effectively no limit.
 * isUnlimited() tells the UI to say "Unlimited" instead of the number.
 */
export const UNLIMITED = 1_000_000;
export const isUnlimited = (cap: number) => cap >= UNLIMITED;

/** Teams one person can own. */
export const TEAMS_OWNED_LIMIT = 5;

export const TEAM_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_HINT: Record<TeamRole, string> = {
  owner: "Everything, including deleting the team",
  admin: "Manages members and invites, and edits",
  editor: "Makes and edits projects, exports and posts",
  viewer: "Opens, watches and downloads",
};

/** Invite links stop working after this long. */
export const INVITE_DAYS = 7;
