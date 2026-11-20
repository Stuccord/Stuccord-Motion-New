// The app's owner(s): no monthly limits (exports, AI plans, AI pictures), so
// testing never runs into the free plan's caps. Everyone else keeps their
// plan's limits. Server-only: limits are enforced on the server.
//
// OWNER_USER_IDS (comma-separated Supabase user ids) replaces the default
// list when it's set, e.g. on Render to add or remove someone without a
// code change.

const DEFAULT_OWNER_IDS = ["49204fad-2eea-496b-b7b9-36c36fbd610e"];

function ownerIds(): string[] {
  const fromEnv = (process.env.OWNER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_OWNER_IDS;
}

/** True for the app's owner(s), who have no monthly limits. */
export function isAppOwner(userId: string | null | undefined): boolean {
  return !!userId && ownerIds().includes(userId);
}
