// Workspaces: your personal space, or a team. A project's files live in its
// workspace's folder in storage: the owner's user id for a personal project,
// teams/<team id> for a team project (so the work stays with the team).

/** "personal", or a team's id. */
export type WorkspaceId = string;
export const PERSONAL: WorkspaceId = "personal";

export type ProjectOwner = { user_id: string; team_id: string | null };

/** The storage folder for a project's files. */
export function projectFolder(p: ProjectOwner): string {
  return p.team_id ? `teams/${p.team_id}` : p.user_id;
}

/** Is a storage path inside a folder (and not trying to climb out of it)? */
export function inFolder(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`) && !path.includes("..") && !path.includes("//");
}

/** The folder a stored file is in (a clip's file is in its project's folder). */
export function folderOfPath(path: string): string {
  const parts = path.split("/");
  return parts[0] === "teams" ? `teams/${parts[1]}` : parts[0];
}

/** What the signed-in user can do with a project. */
export type ProjectAccess = "edit" | "view";
