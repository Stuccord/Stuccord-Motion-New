import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseTransform } from "@/lib/clip-transform";
import { parseBrandKit } from "@/lib/brand-kit";
import { isAudioRole } from "@/lib/media-kind";
import { PERSONAL, inFolder, projectFolder, type ProjectAccess } from "@/lib/workspace";
import { planFor, type TeamRole } from "@/lib/plans";
import { SCENE_BUCKET, parseMotionPlan, sceneImageFolder } from "@/lib/motion-plan";
import { motionAccent, themeFromAccent } from "@/motion/theme";

import { WORKER_SECRET_MISMATCH, workerSecret } from "@/lib/worker-secret";
// A finished render no longer matches the timeline once clips or
// render-affecting settings change. Drop a "ready" project back to "draft"
// so the next Render produces a fresh video instead of re-serving the old one.
async function markProjectEdited(supabase: SupabaseClient<Database>, projectId: string) {
  const { error } = await supabase
    .from("projects")
    .update({ status: "draft" })
    .eq("id", projectId)
    .eq("status", "ready");
  if (error) throw new Error(error.message);
}

type ClipRow = Database["public"]["Tables"]["clips"]["Row"];

/**
 * Inserts a copy of `src` directly after it, shifting every later clip in the
 * project down by one. The shift, the optional patch to `src` and the insert
 * go out as a single upsert, which Postgres applies as one statement, so a
 * failure can't leave the timeline with duplicated or skipped ordinals.
 */
async function insertClipAfter(
  supabase: SupabaseClient<Database>,
  src: ClipRow,
  fields: Pick<ClipRow, "trim_in_ms" | "trim_out_ms">,
  srcPatch: Partial<ClipRow> = {},
): Promise<ClipRow> {
  const { data: later, error: lErr } = await supabase
    .from("clips")
    .select("*")
    .eq("project_id", src.project_id)
    .gt("ordinal", src.ordinal);
  if (lErr) throw new Error(lErr.message);

  const inserted: ClipRow = {
    ...src,
    ...fields,
    id: crypto.randomUUID(),
    ordinal: src.ordinal + 1,
    // Follows the clip it was split from or copied (no start of its own).
    ...("start_ms" in src ? { start_ms: null } : {}),
    // Its own thumbnail (from its own first frame) is made when next shown.
    ...("thumbnail_path" in src ? { thumbnail_path: null } : {}),
    parent_clip_id: src.parent_clip_id ?? src.id,
    created_at: new Date().toISOString(),
  };
  const rows = [
    { ...src, ...srcPatch },
    ...(later ?? []).map((c) => ({ ...c, ordinal: c.ordinal + 1 })),
    inserted,
  ];
  const { data: written, error } = await supabase
    .from("clips")
    .upsert(rows, { onConflict: "id" })
    .select("*");
  if (error) throw new Error(error.message);
  return written?.find((c) => c.id === inserted.id) ?? inserted;
}

// Render jobs only advance when the worker (or the user's browser) reports
// back. If that never happens — a closed tab, a crashed or restarted worker —
// the job stays in progress forever and blocks new renders. Any job with no
// update for this long is treated as dead.
const STALE_RENDER_JOB_MS = 30 * 60 * 1000;
const ACTIVE_JOB_STATUSES = ["queued", "transcribing", "planning", "rendering"] as const;

/**
 * A project the signed-in user can open, what they can do with it, and where
 * its files live. Personal projects are their owner's; team projects are
 * reached through team membership (viewers can only look). The database's
 * rules check the same thing (project_access in the team_projects migration).
 */
export async function projectAccess(
  supabase: SupabaseClient<Database>,
  projectId: string,
  userId: string,
) {
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!project) throw new Error("Project not found");
  let teamRole: TeamRole | null = null;
  let access: ProjectAccess | null = null;
  if (!project.team_id) {
    access = project.user_id === userId ? "edit" : null;
  } else {
    const { data: m } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", project.team_id)
      .eq("user_id", userId)
      .maybeSingle();
    teamRole = (m?.role as TeamRole | undefined) ?? null;
    access = !teamRole ? null : teamRole === "viewer" ? "view" : "edit";
  }
  if (!access) throw new Error("Project not found");
  // Deleting: the owner of a personal project; for a team project its
  // owner and admins, and the editor who made it.
  const canDelete = !project.team_id
    ? true
    : teamRole === "owner" ||
      teamRole === "admin" ||
      (teamRole === "editor" && project.user_id === userId);
  return { project, access, teamRole, canDelete, folder: projectFolder(project) };
}

/** As projectAccess, for changes: viewers are turned away. */
export async function projectForEdit(
  supabase: SupabaseClient<Database>,
  projectId: string,
  userId: string,
) {
  const a = await projectAccess(supabase, projectId, userId);
  if (a.access !== "edit") throw new Error("You can view this project but not change it");
  return a;
}

/**
 * Marks the user's stale in-progress render jobs as failed (optionally only
 * for one project), and fails their projects when no other job is active.
 * Best-effort: errors are logged and never block the caller. Uses the admin
 * client because users have no UPDATE policy on render_jobs; every query is
 * scoped to the caller's user_id.
 */
async function reapStaleRenderJobs(userId: string, projectId?: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoffIso = new Date(Date.now() - STALE_RENDER_JOB_MS).toISOString();

    let query = supabaseAdmin
      .from("render_jobs")
      .update({
        status: "failed",
        stage_message: "Timed out",
        error: "The render stopped responding. Please try rendering again.",
      })
      .eq("user_id", userId)
      .in("status", [...ACTIVE_JOB_STATUSES])
      .lt("updated_at", cutoffIso);
    if (projectId) query = query.eq("project_id", projectId);
    const { data: reaped, error } = await query.select("project_id");
    if (error) throw error;
    if (!reaped?.length) return;

    for (const pid of new Set(reaped.map((j) => j.project_id))) {
      // Anyone's export still running on it (a team project has several people).
      const { count, error: countErr } = await supabaseAdmin
        .from("render_jobs")
        .select("id", { count: "exact", head: true })
        .eq("project_id", pid)
        .in("status", [...ACTIVE_JOB_STATUSES]);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) continue;

      const { error: pErr } = await supabaseAdmin
        .from("projects")
        .update({ status: "failed" })
        .eq("id", pid)
        .in("status", ["queued", "processing"]);
      if (pErr) throw pErr;
    }
    console.warn(`[Render Reaper] Marked ${reaped.length} stale render job(s) as failed`);
  } catch (err) {
    console.error(
      `[Render Reaper] Failed to reap stale jobs: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const CreateInput = z.object({
  title: z.string().trim().min(1).max(120),
  script: z.string().max(20000).optional().nullable(),
  brief: z.string().max(4000).optional().nullable(),
  style_preset: z.string().max(64).default("gadzhi"),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  /** Make it in a team (Editors and up); personal when left out. */
  team_id: z.string().uuid().nullable().optional(),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        title: data.title,
        script: data.script ?? null,
        brief: data.brief ?? null,
        style_preset: data.style_preset,
        aspect_ratio: data.aspect_ratio,
        team_id: data.team_id ?? null,
      })
      .select("*")
      .single();
    if (error) {
      // The database only lets Editors and up make team projects.
      if (data.team_id && /row-level security/i.test(error.message)) {
        throw new Error("You can't make projects in this team (Viewers can only watch)");
      }
      throw new Error(error.message);
    }
    return row;
  });

/** Short-lived links to thumbnail pictures, by storage path (one request for all). */
async function signThumbnails(
  supabase: SupabaseClient<Database>,
  paths: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await supabase.storage
    .from("raw-clips")
    .createSignedUrls(unique, 60 * 60);
  if (error) {
    console.error("[thumbnails] Could not sign links:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

/**
 * Where each clip's thumbnail is saved, by clip id. Read on its own and
 * allowed to fail (e.g. before the clip_thumbnails migration has run): then
 * there are simply no thumbnails yet.
 */
async function thumbnailPaths(
  supabase: SupabaseClient<Database>,
  clipIds: string[],
): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  if (clipIds.length === 0) return out;
  const { data, error } = await supabase
    .from("clips")
    .select("id, thumbnail_path")
    .in("id", clipIds);
  if (error) {
    console.error("[thumbnails] Could not read thumbnail paths:", error.message);
    return null;
  }
  for (const row of data ?? []) if (row.thumbnail_path) out.set(row.id, row.thumbnail_path);
  return out;
}

/** A clip a thumbnail can be made from (when it has none yet). */
export type ThumbSource = {
  id: string;
  storage_path: string;
  filename: string;
  trim_in_ms: number | null;
  trim_out_ms: number | null;
  duration_ms: number | null;
};

/** Which workspace a list is for: "personal" (the default) or a team's id. */
const WorkspaceInput = z
  .object({ workspace: z.union([z.literal(PERSONAL), z.string().uuid()]).default(PERSONAL) })
  .default({ workspace: PERSONAL });

/** The caller's role in a team, or null (personal workspace, or not a member). */
async function roleIn(supabase: SupabaseClient<Database>, teamId: string, userId: string) {
  const { data } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as TeamRole | undefined) ?? null;
}

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WorkspaceInput.parse(d))
  .handler(async ({ data: input, context }) => {
    const team = input.workspace === PERSONAL ? null : input.workspace;
    let q = context.supabase.from("projects").select("*").order("created_at", { ascending: false });
    q = team ? q.eq("team_id", team) : q.is("team_id", null).eq("user_id", context.userId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const projects = data ?? [];
    if (projects.length === 0) return [];
    const role = team ? await roleIn(context.supabase, team, context.userId) : null;

    // Each project's picture: its first main-track clip (V1, or V2 when V1
    // is empty), shown as its saved thumbnail.
    const { data: clipRows, error: cErr } = await context.supabase
      .from("clips")
      .select("id, project_id, role, ordinal, storage_path, filename, trim_in_ms, trim_out_ms, duration_ms")
      .in(
        "project_id",
        projects.map((p) => p.id),
      )
      .order("ordinal", { ascending: true });
    if (cErr) throw new Error(cErr.message);
    const firstClip = new Map<string, NonNullable<typeof clipRows>[number]>();
    for (const c of clipRows ?? []) {
      if (isAudioRole(c.role)) continue;
      const current = firstClip.get(c.project_id);
      const isMain = c.role !== "broll";
      if (!current || (isMain && current.role === "broll")) firstClip.set(c.project_id, c);
    }
    const saved = await thumbnailPaths(
      context.supabase,
      [...firstClip.values()].map((c) => c.id),
    );
    // A cover made in the Thumbnail maker (projects.thumbnail_url holds its
    // storage path) is shown instead of the first clip's frame.
    const covers = projects.flatMap((p) => (isCoverPath(p.thumbnail_url) ? [p.thumbnail_url] : []));
    const urls = await signThumbnails(context.supabase, [...(saved?.values() ?? []), ...covers]);
    return projects.map((p) => {
      const c = firstClip.get(p.id);
      const path = c ? saved?.get(c.id) : undefined;
      const cover = isCoverPath(p.thumbnail_url) ? (urls.get(p.thumbnail_url) ?? null) : null;
      const thumb = cover ?? (path ? (urls.get(path) ?? null) : null);
      // Only offer to make one when thumbnails can be saved (saved != null).
      const source: ThumbSource | null =
        c && saved && !path && !cover
          ? {
              id: c.id,
              storage_path: c.storage_path,
              filename: c.filename,
              trim_in_ms: c.trim_in_ms,
              trim_out_ms: c.trim_out_ms,
              duration_ms: c.duration_ms,
            }
          : null;
      // What the caller can do with it (for the project's menu).
      const access: ProjectAccess = !team || role !== "viewer" ? "edit" : "view";
      const can_delete =
        !team ||
        role === "owner" ||
        role === "admin" ||
        (role === "editor" && p.user_id === context.userId);
      return {
        ...p,
        thumbnail_signed_url: thumb,
        thumbnail_source: source,
        access,
        can_delete,
        made_by_you: p.user_id === context.userId,
      };
    });
  });

export const getUsageStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WorkspaceInput.parse(d))
  .handler(async ({ data: input, context }) => {
    const team = input.workspace === PERSONAL ? null : input.workspace;
    const now = new Date();
    const start30 = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    const start30Iso = new Date(start30.getFullYear(), start30.getMonth(), start30.getDate()).toISOString();

    let pq = context.supabase
      .from("projects")
      .select("id, aspect_ratio, style_preset, status, created_at, duration_seconds");
    pq = team ? pq.eq("team_id", team) : pq.is("team_id", null).eq("user_id", context.userId);
    const { data: projects } = await pq;
    const ids = (projects ?? []).map((p) => p.id);
    // The chart: exports of this workspace's projects.
    const { data: jobs30 } = ids.length
      ? await context.supabase
          .from("render_jobs")
          .select("id, status, created_at, updated_at")
          .in("project_id", ids)
          .gte("created_at", start30Iso)
      : { data: [] as { created_at: string }[] };

    const projectsList = projects ?? [];
    const jobs30List = jobs30 ?? [];

    // 30-day daily series of completed renders
    const days: { date: string; renders: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      days.push({ date: iso, renders: 0 });
    }
    for (const j of jobs30List) {
      const iso = new Date(j.created_at).toISOString().slice(0, 10);
      const bucket = days.find((d) => d.date === iso);
      if (bucket) bucket.renders += 1;
    }

    // Format mix from projects
    const ratioCounts: Record<string, number> = { "9:16": 0, "16:9": 0, "1:1": 0 };
    for (const p of projectsList) ratioCounts[p.aspect_ratio] = (ratioCounts[p.aspect_ratio] ?? 0) + 1;
    const totalRatio = Object.values(ratioCounts).reduce((a, b) => a + b, 0);
    const formatMix = (["9:16", "16:9", "1:1"] as const).map((r) => ({
      ratio: r,
      count: ratioCounts[r] ?? 0,
      pct: totalRatio > 0 ? Math.round(((ratioCounts[r] ?? 0) / totalRatio) * 100) : 0,
    }));

    // Preset mix
    const presetCounts: Record<string, number> = {};
    for (const p of projectsList) presetCounts[p.style_preset] = (presetCounts[p.style_preset] ?? 0) + 1;
    const topPreset = Object.entries(presetCounts).sort((a, b) => b[1] - a[1])[0] ?? null;

    // Minutes rendered (sum duration_seconds of ready projects, fallback 30s each)
    const readyProjects = projectsList.filter((p) => p.status === "ready");
    const totalSeconds = readyProjects.reduce((sum, p) => sum + (p.duration_seconds ?? 30), 0);
    const totalMinutes = Math.round(totalSeconds / 60);

    // This workspace's allowance (the team's, or the caller's own).
    const allowance = await exportAllowance(context.userId, team);

    return {
      totalProjects: projectsList.length,
      readyProjects: readyProjects.length,
      totalMinutes,
      rendersThisMonth: allowance.used,
      renderCap: allowance.cap,
      allowance,
      days,
      formatMix,
      topPreset: topPreset ? { preset: topPreset[0], count: topPreset[1] } : null,
    };
  });

export const listAllClips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WorkspaceInput.parse(d))
  .handler(async ({ data: input, context }) => {
    const team = input.workspace === PERSONAL ? null : input.workspace;
    let q = context.supabase
      .from("clips")
      .select("id, filename, size_bytes, role, created_at, storage_path, project_id, trim_in_ms, trim_out_ms, duration_ms, projects!inner(title, aspect_ratio, team_id, user_id)")
      .order("created_at", { ascending: false })
      .limit(200);
    q = team
      ? q.eq("projects.team_id", team)
      : q.is("projects.team_id", null).eq("projects.user_id", context.userId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const saved = await thumbnailPaths(
      context.supabase,
      (data ?? []).map((c) => c.id),
    );
    const urls = await signThumbnails(context.supabase, [...(saved?.values() ?? [])]);
    return (data ?? []).map((c) => ({
      id: c.id,
      filename: c.filename,
      trim_in_ms: c.trim_in_ms,
      trim_out_ms: c.trim_out_ms,
      duration_ms: c.duration_ms,
      // false: none yet, so the page makes one; null: thumbnails can't be saved yet.
      has_thumbnail: saved ? saved.has(c.id) : null,
      thumbnail_url: saved?.has(c.id) ? (urls.get(saved.get(c.id)!) ?? null) : null,
      size_bytes: c.size_bytes,
      role: c.role,
      created_at: c.created_at,
      storage_path: c.storage_path,
      project_id: c.project_id,
      project_title: (c.projects as unknown as { title: string })?.title ?? "Untitled",
      aspect_ratio: (c.projects as unknown as { aspect_ratio: string })?.aspect_ratio ?? "9:16",
    }));
  });

/** The bell's notifications: exports that finished or failed in the last 30 days. */
export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await context.supabase
      .from("render_jobs")
      .select("id, project_id, status, error, updated_at, projects(title)")
      .eq("user_id", context.userId)
      .in("status", ["completed", "failed"])
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []).map((j) => ({
      id: j.id,
      kind: j.status === "completed" ? ("export_done" as const) : ("export_failed" as const),
      project_id: j.project_id,
      project_title: (j.projects as unknown as { title: string } | null)?.title ?? "Untitled",
      error: j.error,
      at: j.updated_at,
    }));
  });

/** A cover file made by the Thumbnail maker (anything else in thumbnail_url is ignored). */
export const isCoverPath = (p: string | null | undefined): p is string =>
  !!p && /^(?:teams\/[0-9a-f-]{36}|[^/]+)\/thumbs\/cover-[^/]+\.jpg$/.test(p);

/**
 * Sets a project's cover (made in the Thumbnail maker and uploaded to the
 * user's thumbs folder), or clears it with path null. The old cover file is
 * deleted.
 */
export const setProjectCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ project_id: z.string().uuid(), path: z.string().min(1).max(300).nullable() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { folder } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const prefix = `${folder}/thumbs/cover-${data.project_id}-`;
    if (data.path !== null && (!inFolder(data.path, folder) || !data.path.startsWith(prefix) || !data.path.endsWith(".jpg"))) {
      throw new Error("Covers are saved in the project's folder");
    }
    const { data: before, error: rErr } = await context.supabase
      .from("projects")
      .select("thumbnail_url")
      .eq("id", data.project_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!before) throw new Error("Project not found");
    const { error } = await context.supabase
      .from("projects")
      .update({ thumbnail_url: data.path })
      .eq("id", data.project_id);
    if (error) throw new Error(error.message);
    if (isCoverPath(before.thumbnail_url) && before.thumbnail_url !== data.path) {
      const { error: rmErr } = await context.supabase.storage
        .from("raw-clips")
        .remove([before.thumbnail_url]);
      if (rmErr) console.error("[setProjectCover] Couldn't delete the old cover:", rmErr.message);
    }
    return { ok: true };
  });

/** Records where a clip's thumbnail was saved (only inside the user's own thumbs folder). */
export const setClipThumbnail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), path: z.string().min(1).max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: clip } = await context.supabase
      .from("clips")
      .select("project_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!clip) throw new Error("Clip not found");
    const { folder } = await projectForEdit(context.supabase, clip.project_id, context.userId);
    if (data.path !== `${folder}/thumbs/${data.id}.jpg`) {
      throw new Error("Thumbnails are saved in the project's folder");
    }
    const { error } = await context.supabase
      .from("clips")
      .update({ thumbnail_path: data.path })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await reapStaleRenderJobs(context.userId, data.id);
    const { access, teamRole, canDelete, folder } = await projectAccess(
      context.supabase,
      data.id,
      context.userId,
    );
    let team: { id: string; name: string; role: TeamRole } | null = null;
    const [{ data: project, error: pErr }, { data: clips, error: cErr }, { data: jobs, error: jErr }] =
      await Promise.all([
        context.supabase.from("projects").select("*").eq("id", data.id).maybeSingle(),
        context.supabase
          .from("clips")
          .select("*")
          .eq("project_id", data.id)
          .order("ordinal", { ascending: true }),
        context.supabase
          .from("render_jobs")
          .select("*")
          .eq("project_id", data.id)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
    if (pErr) throw new Error(pErr.message);
    if (cErr) throw new Error(cErr.message);
    if (jErr) throw new Error(jErr.message);
    if (!project) throw new Error("Project not found");
    if (project.team_id && teamRole) {
      const { data: t } = await context.supabase
        .from("teams")
        .select("id, name")
        .eq("id", project.team_id)
        .maybeSingle();
      if (t) team = { id: t.id, name: t.name, role: teamRole };
    }
    return {
      project,
      clips: clips ?? [],
      latestJob: jobs?.[0] ?? null,
      access,
      canDelete,
      folder,
      team,
    };
  });

/** Every file directly in a storage folder (paths with the folder). */
async function listFolder(
  db: { storage: { from: (b: string) => { list: (p: string, o: { limit: number; offset: number }) => Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }> } } },
  bucket: string,
  folder: string,
): Promise<string[]> {
  const out: string[] = [];
  const dir = folder.replace(/\/$/, "");
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(dir, { limit: 1000, offset });
    if (error) {
      console.error(`[storage] Couldn't list ${bucket}/${dir}:`, error.message);
      break;
    }
    const page = data ?? [];
    for (const f of page) if (f.id) out.push(`${dir}/${f.name}`);
    if (page.length < 1000) break;
  }
  return out;
}

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { canDelete, project: owned } = await projectAccess(
      context.supabase,
      data.id,
      context.userId,
    );
    if (!canDelete) {
      throw new Error("Only the team's owner and admins, or whoever made it, can delete this project");
    }
    // Its clips' thumbnail pictures go with it.
    const { data: projectClips } = await context.supabase
      .from("clips")
      .select("id, storage_path")
      .eq("project_id", data.id);
    const thumbs = [
      ...((await thumbnailPaths(
        context.supabase,
        (projectClips ?? []).map((c) => c.id),
      )) ?? new Map<string, string>()).values(),
    ].map((thumbnail_path) => ({ thumbnail_path }));
    const { data: projectRow } = await context.supabase
      .from("projects")
      .select("thumbnail_url")
      .eq("id", data.id)
      .maybeSingle();
    // Posts of it that haven't gone out yet are called off.
    const { error: postErr } = await context.supabase
      .from("social_posts")
      .update({ status: "canceled", error: "The project was deleted" })
      .eq("project_id", data.id)
      .eq("status", "scheduled");
    if (postErr) console.error("[deleteProject] Canceling posts failed:", postErr.message);
    const { data: gone, error } = await context.supabase
      .from("projects")
      .delete()
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!gone?.length) throw new Error("You can't delete this project");
    const paths = [
      ...(thumbs ?? []).flatMap((t) => (t.thumbnail_path ? [t.thumbnail_path] : [])),
      ...(isCoverPath(projectRow?.thumbnail_url) ? [projectRow.thumbnail_url] : []),
    ];
    if (paths.length) {
      const { error: rmErr } = await context.supabase.storage.from("raw-clips").remove(paths);
      if (rmErr) console.error("[deleteProject] Failed to delete thumbnails:", rmErr.message);
    }
    // Its uploaded files (unless another project's clip still uses one) and
    // its AI pictures and speaker photo. The project is already gone, so a
    // failure here only leaves files behind; it's logged, not shown.
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const media = [...new Set((projectClips ?? []).map((c) => c.storage_path))];
    if (media.length) {
      const { data: stillUsed } = await admin
        .from("clips")
        .select("storage_path")
        .in("storage_path", media);
      const used = new Set((stillUsed ?? []).map((c) => c.storage_path));
      const unused = media.filter((m) => !used.has(m));
      for (let i = 0; i < unused.length; i += 500) {
        const { error: mErr } = await admin.storage.from("raw-clips").remove(unused.slice(i, i + 500));
        if (mErr) console.error("[deleteProject] Failed to delete files:", mErr.message);
      }
    }
    const pictures = await listFolder(admin, SCENE_BUCKET, sceneImageFolder(owned.user_id, owned.id));
    for (let i = 0; i < pictures.length; i += 500) {
      const { error: iErr } = await admin.storage.from(SCENE_BUCKET).remove(pictures.slice(i, i + 500));
      if (iErr) console.error("[deleteProject] Failed to delete pictures:", iErr.message);
    }
    return { ok: true };
  });

/**
 * Moves a project between your personal space and a team, files and all.
 * Into a team: only whoever made it, and only into a team where they're an
 * Editor or up. Back out of a team: the team's owner and admins; it becomes
 * theirs. Every file it uses (clips, thumbnails, cover, exports) is moved to
 * the new folder first; if a move fails, the ones already moved go back.
 */
export const moveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        to: z.union([z.literal(PERSONAL), z.string().uuid()]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project, teamRole } = await projectAccess(context.supabase, data.id, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    let target: { team_id: string | null; user_id: string };
    if (data.to === PERSONAL) {
      if (!project.team_id) throw new Error("It's already in your personal space");
      if (teamRole !== "owner" && teamRole !== "admin") {
        throw new Error("Only the team's owner and admins can move projects out of it");
      }
      target = { team_id: null, user_id: context.userId };
    } else {
      if (project.team_id) throw new Error("Move it to your personal space first");
      if (project.user_id !== context.userId) throw new Error("Only whoever made it can move it");
      const role = await roleIn(db, data.to, context.userId);
      if (!role || role === "viewer") {
        throw new Error("You need to be an Editor or up in that team to move projects into it");
      }
      target = { team_id: data.to, user_id: project.user_id };
    }

    // Not while it's exporting (the export would land in the old folder).
    const { count: busy } = await db
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .in("status", [...ACTIVE_JOB_STATUSES]);
    if ((busy ?? 0) > 0) throw new Error("Wait for its export to finish, then move it");

    const from = projectFolder(project);
    const to = projectFolder(target);
    const moved = (path: string | null) =>
      path && inFolder(path, from) ? `${to}${path.slice(from.length)}` : path;

    const { data: clips } = await db
      .from("clips")
      .select("id, storage_path, thumbnail_path")
      .eq("project_id", project.id);
    const { data: jobs } = await db
      .from("render_jobs")
      .select("id, output_path")
      .eq("project_id", project.id);

    // Every file to move, once each (split clips share a file).
    const files = new Map<string, "raw-clips" | "renders" | typeof SCENE_BUCKET>();
    for (const c of clips ?? []) {
      files.set(c.storage_path, "raw-clips");
      if (c.thumbnail_path) files.set(c.thumbnail_path, "raw-clips");
    }
    if (isCoverPath(project.thumbnail_url)) files.set(project.thumbnail_url, "raw-clips");
    if (project.output_path) files.set(project.output_path, "renders");
    for (const j of jobs ?? []) if (j.output_path) files.set(j.output_path, "renders");

    // AI pictures and the speaker cartoon live under the project's owner; when
    // the owner changes they move too, and the plan's paths with them.
    const imgFrom = sceneImageFolder(project.user_id, project.id);
    const imgTo = sceneImageFolder(target.user_id, project.id);
    const imgMoved = (path: string) =>
      path.startsWith(imgFrom) ? `${imgTo}${path.slice(imgFrom.length)}` : path;
    if (imgFrom !== imgTo) {
      for (const path of await listFolder(db, SCENE_BUCKET, imgFrom)) files.set(path, SCENE_BUCKET);
    }
    const repoint = <T,>(value: T): T =>
      value == null || imgFrom === imgTo
        ? value
        : (JSON.parse(JSON.stringify(value).split(`"${imgFrom}`).join(`"${imgTo}`)) as T);

    const done: { bucket: "raw-clips" | "renders" | typeof SCENE_BUCKET; from: string; to: string }[] = [];
    const undo = async () => {
      for (const m of done.reverse()) {
        await db.storage.from(m.bucket).move(m.to, m.from).catch(() => undefined);
      }
    };
    for (const [path, bucket] of files) {
      const dest = bucket === SCENE_BUCKET ? imgMoved(path) : moved(path);
      if (!dest || dest === path) continue;
      const { error } = await db.storage.from(bucket).move(path, dest);
      if (error) {
        // A file that's already gone (e.g. an old export) is skipped.
        if (/not.?found|does not exist/i.test(error.message)) continue;
        await undo();
        throw new Error(`Couldn't move its files (${error.message}). Nothing was changed.`);
      }
      done.push({ bucket, from: path, to: dest });
    }

    // The clips' files as they were (before the rows below are updated).
    const clipFiles = [...new Set((clips ?? []).map((c) => c.storage_path))];
    try {
      for (const c of clips ?? []) {
        const { error } = await db
          .from("clips")
          .update({ storage_path: moved(c.storage_path)!, thumbnail_path: moved(c.thumbnail_path) })
          .eq("id", c.id);
        if (error) throw error;
      }
      for (const j of jobs ?? []) {
        if (!j.output_path) continue;
        const { error } = await db
          .from("render_jobs")
          .update({ output_path: moved(j.output_path) })
          .eq("id", j.id);
        if (error) throw error;
      }
      // Captions follow their files.
      for (const path of clipFiles) {
        const dest = moved(path);
        if (dest && dest !== path) {
          await db.from("transcripts").update({ storage_path: dest }).eq("storage_path", path);
        }
      }
      const { error: pErr } = await db
        .from("projects")
        .update({
          team_id: target.team_id,
          user_id: target.user_id,
          thumbnail_url: isCoverPath(project.thumbnail_url)
            ? moved(project.thumbnail_url)
            : project.thumbnail_url,
          output_path: moved(project.output_path),
          motion_plan: repoint(project.motion_plan),
          motion_plan_previous: repoint(project.motion_plan_previous),
          motion_character: repoint(project.motion_character),
        })
        .eq("id", project.id);
      if (pErr) throw pErr;
    } catch (e) {
      await undo();
      throw new Error(
        `Couldn't move the project (${e instanceof Error ? e.message : "database error"})`,
      );
    }

    // Scheduled posts pointed at the old files.
    await db
      .from("social_posts")
      .update({ status: "canceled", error: "The project was moved" })
      .eq("project_id", project.id)
      .eq("status", "scheduled");

    return { ok: true, moved: done.length };
  });

const AttachClipInput = z.object({
  project_id: z.string().uuid(),
  storage_path: z.string().min(1),
  filename: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  role: z.enum(["auto", "aroll", "broll", "music", "sfx", "voiceover"]).default("auto"),
  ordinal: z.number().int().nonnegative().default(0),
  duration_ms: z.number().int().nonnegative().optional(),
  trim_in_ms: z.number().int().nonnegative().optional(),
  trim_out_ms: z.number().int().nonnegative().optional(),
  parent_clip_id: z.string().uuid().optional(),
  /** Where it starts on the timeline (a voiceover starts at the playhead). */
  start_ms: z.number().int().nonnegative().optional(),
});

export const attachClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AttachClipInput.parse(d))
  .handler(async ({ data, context }) => {
    const { folder } = await projectForEdit(context.supabase, data.project_id, context.userId);
    if (!inFolder(data.storage_path, folder)) {
      throw new Error("That file isn't in this project's folder");
    }
    const insert = {
      project_id: data.project_id,
      user_id: context.userId,
      storage_path: data.storage_path,
      filename: data.filename,
      size_bytes: data.size_bytes,
      role: data.role,
      ordinal: data.ordinal,
      trim_in_ms: data.trim_in_ms ?? 0,
      trim_out_ms: data.trim_out_ms ?? null,
      duration_ms: data.duration_ms ?? null,
      parent_clip_id: data.parent_clip_id ?? null,
      ...(data.start_ms !== undefined ? { start_ms: data.start_ms } : {}),
    };
    const { data: row, error } = await context.supabase
      .from("clips")
      .insert(insert)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await markProjectEdited(context.supabase, data.project_id);
    return row;
  });


export const removeClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: clip, error: cErr } = await context.supabase
      .from("clips")
      .select("storage_path, project_id")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!clip) return { ok: true };
    const thumbnailPath = (await thumbnailPaths(context.supabase, [data.id]))?.get(data.id);

    const { error } = await context.supabase.from("clips").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    // Its thumbnail picture is its own (one per clip).
    if (thumbnailPath) {
      const { error: thErr } = await context.supabase.storage
        .from("raw-clips")
        .remove([thumbnailPath]);
      if (thErr) console.error("[removeClip] Failed to delete thumbnail:", thErr.message);
    }

    // Split halves and duplicates share the uploaded file. Only delete it once
    // no clip references that storage path any more. parent_clip_id can't be
    // used for this: it is nulled when the original clip is deleted.
    const { count, error: countErr } = await context.supabase
      .from("clips")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", clip.storage_path);
    if (countErr) {
      console.error(
        "[removeClip] Could not check for shared source; keeping file:",
        countErr.message,
      );
    } else if (count === 0) {
      const { error: rmErr } = await context.supabase.storage
        .from("raw-clips")
        .remove([clip.storage_path]);
      if (rmErr) console.error("[removeClip] Failed to delete source file:", rmErr.message);
      // Its transcript goes with it.
      const { error: tErr } = await context.supabase
        .from("transcripts")
        .delete()
        .eq("storage_path", clip.storage_path);
      if (tErr) console.error("[removeClip] Failed to delete transcript:", tErr.message);
    }

    await markProjectEdited(context.supabase, clip.project_id);
    return { ok: true };
  });

export const updateClipOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        order: z.array(
          z.object({
            id: z.string().uuid(),
            ordinal: z.number().int().nonnegative(),
            role: z.enum(["auto", "aroll", "broll", "music", "sfx", "voiceover"]).optional(),
            // Where it starts on the timeline; null follows the clip before it.
            // Left out: unchanged.
            start_ms: z.number().int().nonnegative().nullable().optional(),
          })
        ),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Write the whole new order in one upsert so it applies all-or-nothing.
    // Ids outside this project are ignored, as before.
    const { data: rows, error: rErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("project_id", data.project_id)
      .in(
        "id",
        data.order.map((item) => item.id),
      );
    if (rErr) throw new Error(rErr.message);
    const byId = new Map(data.order.map((item) => [item.id, item]));
    const updated = (rows ?? []).map((row) => {
      const item = byId.get(row.id)!;
      return {
        ...row,
        ordinal: item.ordinal,
        role: item.role ?? row.role,
        ...(item.start_ms !== undefined ? { start_ms: item.start_ms } : {}),
      };
    });
    if (updated.length > 0) {
      const { error } = await context.supabase.from("clips").upsert(updated, { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    await markProjectEdited(context.supabase, data.project_id);
    return { ok: true };
  });

export const updateClipTrim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        trim_in_ms: z.number().int().nonnegative(),
        trim_out_ms: z.number().int().nonnegative().nullable(),
        // A placed clip's start moves with its in-point (left out: unchanged).
        start_ms: z.number().int().nonnegative().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("clips")
      .update({
        trim_in_ms: data.trim_in_ms,
        trim_out_ms: data.trim_out_ms,
        ...(data.start_ms !== undefined ? { start_ms: data.start_ms } : {}),
      })
      .eq("id", data.id)
      .select("project_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (updated?.project_id) await markProjectEdited(context.supabase, updated.project_id);
    return { ok: true };
  });

/** Where a clip sits in the frame (moved, resized, rotated); null: its default fit. */
export const updateClipTransform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        transform: z
          .object({
            x: z.number().finite(),
            y: z.number().finite(),
            scale: z.number().finite().positive(),
            rotation: z.number().finite(),
          })
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Kept within limits; the default fit is saved as null.
    const transform = data.transform ? parseTransform(data.transform) : null;
    const { data: updated, error } = await context.supabase
      .from("clips")
      .update({ transform })
      .eq("id", data.id)
      .select("project_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (updated?.project_id) await markProjectEdited(context.supabase, updated.project_id);
    return { ok: true, transform };
  });

export const updateClipDuration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), duration_ms: z.number().int().nonnegative() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clips")
      .update({ duration_ms: data.duration_ms })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const splitClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), at_ms: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Load the source clip
    const { data: src, error: sErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sErr || !src) throw new Error("Clip not found");
    const trimIn = src.trim_in_ms ?? 0;
    const trimOut = src.trim_out_ms ?? src.duration_ms ?? null;
    const cutAbs = trimIn + data.at_ms; // absolute ms into source
    if (trimOut != null && (cutAbs <= trimIn + 50 || cutAbs >= trimOut - 50)) {
      throw new Error("Split point too close to a clip edge");
    }

    // Left half keeps src's id and ends at the cut; the right half starts there.
    const right = await insertClipAfter(
      context.supabase,
      src,
      { trim_in_ms: cutAbs, trim_out_ms: trimOut },
      { trim_out_ms: cutAbs },
    );

    await markProjectEdited(context.supabase, src.project_id);
    return { left_id: src.id, right_id: right.id };
  });

/**
 * Auto-cut: replaces clips with the pieces of them to keep (pauses cut out).
 * Each clip keeps its id for its first piece; the others are new clips right
 * after it, like split halves. Every change goes out as one upsert, so the
 * timeline is never left half cut. Returns each clip's piece ids, in order.
 */
export const cutClipRanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        cuts: z
          .array(
            z.object({
              id: z.string().uuid(),
              keep: z
                .array(
                  z.object({
                    in_ms: z.number().int().min(0),
                    out_ms: z.number().int().positive(),
                  }),
                )
                .min(1)
                .max(500),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: all, error: aErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("project_id", data.project_id)
      .order("ordinal", { ascending: true });
    if (aErr) throw new Error(aErr.message);
    const clips = all ?? [];
    const byId = new Map(clips.map((c) => [c.id, c]));
    const cuts = new Map(data.cuts.map((c) => [c.id, c.keep]));
    for (const [id, keep] of cuts) {
      const c = byId.get(id);
      if (!c) throw new Error("A clip to cut isn't in this project any more");
      if (isAudioRole(c.role)) throw new Error("Only video clips can be cut");
      const end = c.duration_ms ?? Infinity;
      let at = 0;
      for (const k of keep) {
        if (k.out_ms - k.in_ms < 50 || k.in_ms < at || k.out_ms > end) {
          throw new Error("The parts to keep don't fit the clip; find the pauses again");
        }
        at = k.out_ms;
      }
    }

    // Every clip after a cut one moves down by the number of new pieces.
    const rows: ClipRow[] = [];
    const pieces: Record<string, string[]> = {};
    let shift = 0;
    const now = new Date().toISOString();
    for (const c of clips) {
      const keep = cuts.get(c.id);
      if (!keep) {
        if (shift > 0) rows.push({ ...c, ordinal: c.ordinal + shift });
        continue;
      }
      const ordinal = c.ordinal + shift;
      rows.push({ ...c, ordinal, trim_in_ms: keep[0].in_ms, trim_out_ms: keep[0].out_ms });
      pieces[c.id] = [c.id];
      keep.slice(1).forEach((k, i) => {
        const id = crypto.randomUUID();
        pieces[c.id].push(id);
        rows.push({
          ...c,
          id,
          ordinal: ordinal + 1 + i,
          trim_in_ms: k.in_ms,
          trim_out_ms: k.out_ms,
          ...("start_ms" in c ? { start_ms: null } : {}),
          ...("thumbnail_path" in c ? { thumbnail_path: null } : {}),
          parent_clip_id: c.parent_clip_id ?? c.id,
          created_at: now,
        });
      });
      shift += keep.length - 1;
    }
    const { error } = await context.supabase.from("clips").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(error.message);
    await markProjectEdited(context.supabase, data.project_id);
    return { pieces };
  });

/**
 * Undoes an Auto-cut: removes the pieces it added and puts the clips' trims
 * and places back as they were. The pieces share their clip's file, so no
 * file is deleted (only the pieces' own thumbnails).
 */
export const restoreClipLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        remove_ids: z.array(z.string().uuid()).max(5000),
        clips: z
          .array(
            z.object({
              id: z.string().uuid(),
              ordinal: z.number().int(),
              trim_in_ms: z.number().int().min(0).nullable(),
              trim_out_ms: z.number().int().positive().nullable(),
            }),
          )
          .max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: all, error: aErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("project_id", data.project_id);
    if (aErr) throw new Error(aErr.message);
    const byId = new Map((all ?? []).map((c) => [c.id, c]));
    const remove = data.remove_ids.filter((id) => byId.has(id));
    if (remove.length > 0) {
      const thumbs = await thumbnailPaths(context.supabase, remove);
      const { error } = await context.supabase.from("clips").delete().in("id", remove);
      if (error) throw new Error(error.message);
      const files = [...(thumbs?.values() ?? [])];
      if (files.length > 0) {
        const { error: thErr } = await context.supabase.storage.from("raw-clips").remove(files);
        if (thErr) console.error("[restoreClipLayout] Couldn't delete thumbnails:", thErr.message);
      }
    }
    const rows = data.clips.flatMap((c) => {
      const row = byId.get(c.id);
      return row && !remove.includes(c.id)
        ? [{ ...row, ordinal: c.ordinal, trim_in_ms: c.trim_in_ms ?? 0, trim_out_ms: c.trim_out_ms }]
        : [];
    });
    if (rows.length > 0) {
      const { error } = await context.supabase.from("clips").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    await markProjectEdited(context.supabase, data.project_id);
    return { ok: true };
  });

export const duplicateClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: src, error: sErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sErr || !src) throw new Error("Clip not found");

    const copy = await insertClipAfter(context.supabase, src, {
      trim_in_ms: src.trim_in_ms ?? 0,
      trim_out_ms: src.trim_out_ms,
    });
    await markProjectEdited(context.supabase, src.project_id);
    return copy;
  });


export const updateProjectSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        aspect_ratio: z.enum(["9:16", "16:9", "1:1"]).optional(),
        style_preset: z.string().max(64).optional(),
        title: z.string().trim().min(1).max(120).optional(),
        script: z.string().max(20000).nullable().optional(),
        brief: z.string().max(4000).nullable().optional(),
        // The editor's export switches: Captions, Music and the music volume.
        captions_enabled: z.boolean().optional(),
        music_enabled: z.boolean().optional(),
        music_volume: z.number().int().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Database["public"]["Tables"]["projects"]["Update"] = {};
    if (data.aspect_ratio !== undefined) patch.aspect_ratio = data.aspect_ratio;
    if (data.style_preset !== undefined) patch.style_preset = data.style_preset;
    if (data.title !== undefined) patch.title = data.title;
    if (data.script !== undefined) patch.script = data.script;
    if (data.brief !== undefined) patch.brief = data.brief;
    if (data.captions_enabled !== undefined) patch.captions_enabled = data.captions_enabled;
    if (data.music_enabled !== undefined) patch.music_enabled = data.music_enabled;
    if (data.music_volume !== undefined) patch.music_volume = data.music_volume;
    // The music switch and volume only change the export when there is
    // uploaded music or SFX to mix in.
    let musicAffectsRender = false;
    if (data.music_enabled !== undefined || data.music_volume !== undefined) {
      const { count, error: aErr } = await context.supabase
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("project_id", data.id)
        .in("role", ["music", "sfx"]);
      if (aErr) throw new Error(aErr.message);
      musicAffectsRender = (count ?? 0) > 0;
    }
    const { data: row, error } = await context.supabase
      .from("projects")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    // Title is display-only; everything else here changes the rendered video.
    const affectsRender =
      data.aspect_ratio !== undefined ||
      data.style_preset !== undefined ||
      data.script !== undefined ||
      data.brief !== undefined ||
      data.captions_enabled !== undefined ||
      musicAffectsRender;
    if (affectsRender && row.status === "ready") {
      await markProjectEdited(context.supabase, data.id);
      return { ...row, status: "draft" as const };
    }
    return row;
  });

/** Saved transcripts (words in source-file time) for a project's clips. */
export const listProjectTranscripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: clips, error: cErr } = await context.supabase
      .from("clips")
      .select("storage_path")
      .eq("project_id", data.project_id);
    if (cErr) throw new Error(cErr.message);
    const paths = [...new Set((clips ?? []).map((c) => c.storage_path))];
    if (paths.length === 0) return [];
    const { data: rows, error } = await context.supabase
      .from("transcripts")
      .select("storage_path, words, edited, language, updated_at")
      .in("storage_path", paths);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const TranscriptWordInput = z
  .object({
    text: z.string().trim().min(1).max(100),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
  })
  .refine((w) => w.end_ms >= w.start_ms, "A word can't end before it starts");

/**
 * Saves the user's corrected words for one source file's transcript. Only an
 * existing transcript can be updated (they're created by the render worker).
 */
export const saveTranscriptWords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        storage_path: z.string().min(1).max(1024),
        words: z.array(TranscriptWordInput).max(50_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const words = [...data.words].sort((a, b) => a.start_ms - b.start_ms);
    const { data: row, error } = await context.supabase
      .from("transcripts")
      .update({ words, edited: true })
      .eq("storage_path", data.storage_path)
      .select("storage_path, words, edited, language, updated_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Transcript not found");
    return row;
  });

export const getClipSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("raw-clips")
      .createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

export const getSignedClipUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      project_id: z.string().uuid(),
      filename: z.string().min(1),
      ordinal: z.number().int().nonnegative().default(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { folder } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const safeName = data.filename.replace(/[^\w.\-]+/g, "_");
    const path = `${folder}/${data.project_id}/${Date.now()}_${data.ordinal}_${safeName}`;
    const { data: signed, error } = await context.supabase.storage
      .from("raw-clips")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Failed to create signed upload URL");
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const getRenderSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("renders")
      .createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

function resolveWorkerJobsEndpoint(rawUrl: string | undefined): URL {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error("RENDER_WORKER_URL is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("RENDER_WORKER_URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RENDER_WORKER_URL must use http or https");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] !== "jobs") {
    segments.push("jobs");
  }
  parsed.pathname = `/${segments.join("/")}`;
  return parsed;
}

function resolveCallbackWebhookEndpoint(rawBaseUrl: string | undefined): URL {
  if (!rawBaseUrl || !rawBaseUrl.trim()) {
    throw new Error("PUBLIC_APP_URL is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl.trim());
  } catch {
    throw new Error("PUBLIC_APP_URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must use http or https");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const expectedTail = ["api", "public", "render-webhook"];
  const endsWithExpected = expectedTail.every(
    (seg, idx) => segments[segments.length - expectedTail.length + idx] === seg,
  );
  if (!endsWithExpected) {
    segments.push(...expectedTail);
  }
  parsed.pathname = `/${segments.join("/")}`;
  return parsed;
}

export type CloudRenderInput = {
  project_id: string;
  captions: boolean;
  music: { enabled: boolean; volume: number };
};

/** The first moment of this month (UTC): allowances reset then. */
function monthStartIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export type ExportAllowance = {
  used: number;
  cap: number;
  /** The team whose allowance it is; null for the person's own. */
  team: { id: string; name: string } | null;
  plan: string;
};

/**
 * This month's exports against an allowance: a team's (exports of its
 * projects, from its plan) or a person's own (their exports outside teams).
 * Failed exports don't count. Counted with the admin client so exports of
 * projects that have since moved or gone still count.
 */
export async function exportAllowance(userId: string, teamId: string | null): Promise<ExportAllowance> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  let q = admin
    .from("render_jobs")
    .select("id", { count: "exact", head: true })
    .neq("status", "failed")
    .gte("created_at", monthStartIso());
  if (teamId) {
    const { data: team } = await admin
      .from("teams")
      .select("id, name, plan")
      .eq("id", teamId)
      .maybeSingle();
    const plan = planFor(team?.plan);
    const { count, error } = await q.eq("team_id", teamId);
    if (error) throw new Error(error.message);
    return {
      used: count ?? 0,
      cap: plan.teamExports,
      team: { id: teamId, name: team?.name ?? "This team" },
      plan: plan.label,
    };
  }
  const plan = planFor("free");
  q = q.eq("user_id", userId).is("team_id", null);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return { used: count ?? 0, cap: plan.personalExports, team: null, plan: plan.label };
}

function assertAllowanceLeft(a: ExportAllowance) {
  if (a.used < a.cap) return;
  throw new Error(
    a.team
      ? `${a.team.name} has used all ${a.cap} team exports for this month on the ${a.plan} plan. Exporting opens again on the 1st; you can keep editing meanwhile.`
      : `You've used all ${a.cap} exports for this month on the ${a.plan.toLowerCase()} plan. Exporting opens again on the 1st; you can keep editing meanwhile.`,
  );
}

/**
 * Starts a cloud export of a project the user can edit (theirs, or a team's
 * as an Editor or up): checks the monthly cap, makes the job and hands it to
 * the render worker. Access is checked for `userId` explicitly, so it's safe
 * with the admin client too (the API, where an API key stands in for a
 * signed-in user).
 */
export async function startCloudRender(
  db: SupabaseClient<Database>,
  userId: string,
  data: CloudRenderInput,
) {
  // Check access + fetch payload for worker
  const { project, folder } = await projectForEdit(db, data.project_id, userId);

  // The monthly allowance: the team's for a team project, else the
  // person's. Stale jobs are failed first so a dead render doesn't count;
  // failed exports never count, so retrying after a failure is free.
  await reapStaleRenderJobs(userId);
  assertAllowanceLeft(await exportAllowance(userId, project.team_id));

  const { data: clips, error: cErr } = await db
    .from("clips")
    .select("*")
    .eq("project_id", data.project_id)
    .order("ordinal", { ascending: true });
  if (cErr) throw new Error(cErr.message);
  if (!clips?.length) throw new Error("Upload at least one clip before rendering");
  if (!clips.some((c) => !isAudioRole(c.role))) {
    throw new Error("Add a video or picture before rendering: sound alone can't be exported");
  }

  // Create job row
  const { data: job, error: jErr } = await db
    .from("render_jobs")
    .insert({
      project_id: project.id,
      user_id: userId,
      team_id: project.team_id,
      status: "queued",
      progress: 0,
      stage_message: "Queued for editing",
    })
    .select("*")
    .single();
  if (jErr) throw new Error(jErr.message);

  await db.from("projects").update({ status: "queued" }).eq("id", project.id);

  // Dispatch to external worker with timeout and robust status validation
  try {
    const workerJobsUrl = resolveWorkerJobsEndpoint(process.env.RENDER_WORKER_URL);
    const secretForWorker = workerSecret();
    if (!secretForWorker) {
      throw new Error("RENDER_WORKER_SECRET is not configured");
    }
    const callbackWebhookUrl = resolveCallbackWebhookEndpoint(
      process.env.PUBLIC_APP_URL || process.env.PUBLIC_URL,
    );

    // The Motion Explainer graphics, when there are some and they're on.
    const motionPlan = parseMotionPlan(project.motion_plan);
    const withGraphics =
      !!motionPlan && motionPlan.enabled !== false && motionPlan.elements.length > 0;

    // Saved transcripts (and the user's corrections) for these source files,
    // so the worker only transcribes files it hasn't seen. Best-effort: if
    // this lookup fails the worker simply transcribes again. Graphics are
    // placed by their words, so they need them too.
    const savedWords = new Map<string, unknown>();
    if (data.captions || withGraphics) {
      const paths = [...new Set(clips.map((c) => c.storage_path))];
      // A team's files are the team's, whoever transcribed them; personal
      // files are looked up by their owner.
      let tq = db.from("transcripts").select("storage_path, words").in("storage_path", paths);
      if (!project.team_id) tq = tq.eq("user_id", userId);
      const { data: transcripts, error: tErr } = await tq;
      if (tErr) console.error("[submitRender] Transcript lookup failed:", tErr.message);
      for (const t of transcripts ?? []) savedWords.set(t.storage_path, t.words);
    }

    // Presign download URLs for each clip so the worker doesn't need service role.
    const clipUrls = await Promise.all(
      clips.map(async (c) => {
        const { data: signed } = await db.storage
          .from("raw-clips")
          .createSignedUrl(c.storage_path, 60 * 60 * 6);
        return {
          id: c.id,
          storage_path: c.storage_path,
          filename: c.filename,
          role: c.role,
          ordinal: c.ordinal,
          download_url: signed?.signedUrl ?? null,
          duration_ms: c.duration_ms ?? null,
          trim_in_ms: c.trim_in_ms ?? 0,
          trim_out_ms: c.trim_out_ms ?? null,
          // Where it starts on the timeline; null follows the clip before it.
          start_ms: c.start_ms ?? null,
          parent_clip_id: c.parent_clip_id ?? null,
          // Moved, resized or rotated in the preview; null: the default fit.
          transform: parseTransform(c.transform),
          // Words in source-file time, or null when not transcribed yet.
          transcript_words: savedWords.get(c.storage_path) ?? null,
        };
      }),
    );

    // Presign an upload URL for the final render output.
    const outputPath = `${folder}/${project.id}/${job.id}.mp4`;
    const { data: uploadSigned, error: uploadErr } = await db.storage
      .from("renders")
      .createSignedUploadUrl(outputPath);
    if (uploadErr) throw new Error(uploadErr.message);

    // The brand kit: the team's for a team project, else the account's
    // (read fresh: the sign-in token may be older than the last save), with a
    // link to its logo for the worker.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let kit;
    if (project.team_id) {
      const { data: team } = await supabaseAdmin
        .from("teams")
        .select("brand_kit")
        .eq("id", project.team_id)
        .maybeSingle();
      kit = parseBrandKit(team?.brand_kit);
    } else {
      const { data: owner } = await supabaseAdmin.auth.admin.getUserById(userId);
      kit = parseBrandKit(owner?.user?.user_metadata?.brand_kit);
    }
    let logoUrl: string | null = null;
    if (kit.logo) {
      const { data: signedLogo } = await db.storage
        .from("raw-clips")
        .createSignedUrl(kit.logo.path, 60 * 60 * 6);
      logoUrl = signedLogo?.signedUrl ?? null;
    }
    const brandKit = {
      ...kit,
      logo: kit.logo && logoUrl ? { ...kit.logo, url: logoUrl } : null,
    };
    // Story scenes' pictures (this project's own), linked for the worker.
    const sceneImages: Record<string, string> = {};
    if (withGraphics) {
      const folder = sceneImageFolder(project.user_id, project.id);
      const paths = [
        ...new Set(
          motionPlan.elements
            .flatMap((e) => e.scenes ?? [])
            .map((sc) => sc.image?.path)
            .filter((x): x is string => !!x && x.startsWith(folder)),
        ),
      ];
      if (paths.length) {
        const { data: signed } = await supabaseAdmin.storage
          .from(SCENE_BUCKET)
          .createSignedUrls(paths, 60 * 60 * 6);
        for (const s of signed ?? []) if (s.path && s.signedUrl) sceneImages[s.path] = s.signedUrl;
      }
    }

    const payload = {
      job_id: job.id,
      project_id: project.id,
      user_id: userId,
      title: project.title,
      script: project.script,
      brief: project.brief,
      style_preset: project.style_preset,
      aspect_ratio: project.aspect_ratio,
      captions: data.captions,
      music: data.music,
      brand_kit: brandKit,
      // Motion Explainer graphics: each anchored to a clip and a word in its
      // transcript; the worker places them from the words, like captions,
      // and draws them in the colours below (see src/motion).
      motion: withGraphics
        ? {
            elements: motionPlan.elements,
            // The user's pick, the brand kit's colour, or the video's.
            theme: themeFromAccent(motionAccent(motionPlan.colour, kit.highlightColor).hex),
            // Automatic sounds: on/off, volume, and hand edits.
            sound: motionPlan.sound ?? null,
            // Story pictures: a link for each storage path in the scenes.
            images: sceneImages,
            // The graphics' look: glass or paper.
            look: motionPlan.look ?? "glass",
            // Camera angles (on unless turned off) and where the speaker is.
            angles: motionPlan.angles ?? null,
          }
        : null,
      // Voiceovers go apart from the clips, so a worker from before
      // voiceovers leaves them out instead of taking them for videos.
      clips: clipUrls.filter((c) => c.role !== "voiceover"),
      voiceovers: clipUrls.filter((c) => c.role === "voiceover"),
      output: {
        path: outputPath,
        upload_url: uploadSigned.signedUrl,
        token: uploadSigned.token,
      },
      callback_url: callbackWebhookUrl.toString(),
    };
    const body = JSON.stringify(payload);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secretForWorker),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const signature = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(workerJobsUrl.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stuccord-signature": signature,
        },
        body,
        signal: controller.signal,
      });
    } catch (fetchErr: unknown) {
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        throw new Error("Render worker connection timed out after 15 seconds");
      }
      throw new Error("Failed to connect to render worker");
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status === 401) throw new Error(WORKER_SECRET_MISMATCH);
    if (res.status !== 202) {
      throw new Error(`Render worker rejected job with HTTP status ${res.status}`);
    }
  } catch (dispatchErr: unknown) {
    const sanitizedError =
      dispatchErr instanceof Error
        ? dispatchErr.message.slice(0, 500)
        : "Cloud render dispatch failed";

    console.error(`[Worker Dispatch Failed] job=${job.id} project=${project.id}`);

    // Safely transition job and project rows to failed so they never stay stuck in queued
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const nowIso = new Date().toISOString();

      const { data: updatedJobs, error: jErr } = await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          stage_message: "Dispatch failed",
          error: sanitizedError,
          updated_at: nowIso,
        })
        .eq("id", job.id)
        .eq("project_id", project.id)
        .eq("user_id", userId)
        .select("id");

      if (jErr || !updatedJobs || updatedJobs.length !== 1) {
        console.error(`[Worker Dispatch] Failed to update render job row: ${jErr?.message}`);
      }

      const { data: updatedProjects, error: pErr } = await supabaseAdmin
        .from("projects")
        .update({
          status: "failed",
          updated_at: nowIso,
        })
        .eq("id", project.id)
        .select("id");

      if (pErr || !updatedProjects || updatedProjects.length !== 1) {
        console.error(`[Worker Dispatch] Failed to update project row: ${pErr?.message}`);
      }
    } catch (adminErr) {
      console.error(
        `[Worker Dispatch] Admin failure update error: ${adminErr instanceof Error ? adminErr.message : "unknown"}`,
      );
    }

    throw new Error(
      "Cloud rendering is temporarily unavailable. The job could not be dispatched to the render worker.",
    );
  }

  return job;
}

export const submitRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        // Burn word-by-word captions into the export (editor's Captions switch).
        captions: z.boolean().default(true),
        // Mix uploaded music (looped, ducked under the voice) and SFX (on cuts)
        // into the export, from the editor's Music switch and volume (0-100).
        music: z
          .object({ enabled: z.boolean(), volume: z.number().min(0).max(100) })
          .default({ enabled: true, volume: 60 }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => startCloudRender(context.supabase, context.userId, data));

/**
 * Client-side render pipeline (browser stitches clips with MediaRecorder).
 * `startBrowserRender` enforces the render cap, creates a job row, mints
 * signed download URLs for every clip, and mints a signed upload URL for
 * the final MP4/WebM in the `renders` bucket.
 */
export const startBrowserRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        ext: z.enum(["mp4", "webm"]).default("mp4"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project, folder } = await projectForEdit(
      context.supabase,
      data.project_id,
      context.userId,
    );
    await reapStaleRenderJobs(context.userId);
    assertAllowanceLeft(await exportAllowance(context.userId, project.team_id));

    const { data: clips, error: cErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("project_id", data.project_id)
      .order("ordinal", { ascending: true });
    if (cErr) throw new Error(cErr.message);
    if (!clips || clips.length === 0) throw new Error("Add at least one clip before exporting.");

    const signed = await Promise.all(
      clips.map(async (c) => {
        const { data: s } = await context.supabase.storage
          .from("raw-clips")
          .createSignedUrl(c.storage_path, 60 * 60 * 2);
        return { ...c, download_url: s?.signedUrl ?? null };
      }),
    );
    const missing = signed.filter((c) => !c.download_url);
    if (missing.length) throw new Error("Some clips are unavailable. Try re-uploading.");

    const { data: job, error: jErr } = await context.supabase
      .from("render_jobs")
      .insert({
        project_id: data.project_id,
        user_id: context.userId,
        team_id: project.team_id,
        status: "rendering",
        progress: 5,
        stage_message: "Rendering in browser",
      })
      .select("id")
      .single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Failed to create render job");

    const outputPath = `${folder}/${data.project_id}/${job.id}.${data.ext}`;
    const { data: up, error: upErr } = await context.supabase.storage
      .from("renders")
      .createSignedUploadUrl(outputPath);
    if (upErr || !up) throw new Error(upErr?.message ?? "Failed to prepare upload");

    await context.supabase
      .from("projects")
      .update({ status: "processing" })
      .eq("id", data.project_id);

    return {
      job_id: job.id,
      aspect_ratio: project.aspect_ratio,
      clips: signed,
      upload: { path: outputPath, token: up.token },
    };
  });

export const finishBrowserRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        job_id: z.string().uuid("Invalid job ID format"),
        project_id: z.string().uuid("Invalid project ID format"),
        output_path: z.string().min(1).max(500),
        duration_ms: z.number().int().nonnegative().optional(),
        status: z.enum(["completed", "failed"]),
        error: z.string().max(2000).optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // 1. Validate & sanitize payload based on status
    let sanitizedOutputPath: string | null = null;
    let sanitizedError: string | null = null;

    // The export is saved in the project's folder (a team's, for a team project).
    const { folder } = await projectForEdit(context.supabase, data.project_id, context.userId);

    if (data.status === "completed") {
      const rawPath = data.output_path.trim();
      const expectedPrefix = `${folder}/${data.project_id}/`;

      if (
        !rawPath.startsWith(expectedPrefix) ||
        rawPath.includes("..") ||
        rawPath.includes("//") ||
        rawPath.startsWith("/") ||
        rawPath.startsWith("\\") ||
        /https?:\/\//i.test(rawPath)
      ) {
        throw new Error("Invalid output path format or unauthorized path prefix");
      }

      const filename = rawPath.slice(expectedPrefix.length);
      if (!/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes("/") || filename.includes("\\")) {
        throw new Error("Invalid output path filename");
      }

      sanitizedOutputPath = rawPath;
    } else {
      const rawError = (data.error ?? "Render failed in browser").trim();
      // Strip control characters and multi-line traces; enforce max 500 characters
      sanitizedError = rawError
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .slice(0, 500);
    }

    // 2. Load trusted server admin client inside handler (never exposed to client bundle)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 3. Verify job ownership before performing any update
    const { data: existingJob, error: jobFetchErr } = await supabaseAdmin
      .from("render_jobs")
      .select("id, project_id, user_id, status, output_path")
      .eq("id", data.job_id)
      .eq("project_id", data.project_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (jobFetchErr || !existingJob) {
      throw new Error("Render job not found or unauthorized");
    }

    // (Access to the project was checked above, with the user's own client.)

    const nowIso = new Date().toISOString();

    // 4. Perform trusted admin update on render_jobs and verify exactly one row affected
    if (data.status === "completed") {
      const { data: updatedJobs, error: jErr } = await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "completed",
          progress: 100,
          stage_message: "Ready",
          output_path: sanitizedOutputPath,
          error: null,
          updated_at: nowIso,
        })
        .eq("id", data.job_id)
        .eq("project_id", data.project_id)
        .eq("user_id", context.userId)
        .select("id");

      if (jErr || !updatedJobs || updatedJobs.length !== 1) {
        throw new Error(jErr?.message ?? "Failed to update render job row");
      }

      // 5. Update projects row and verify exactly one row affected
      const projectPatch: {
        status: "ready";
        output_path: string;
        updated_at: string;
        duration_seconds?: number;
      } = {
        status: "ready",
        output_path: sanitizedOutputPath!,
        updated_at: nowIso,
      };
      if (data.duration_ms != null) {
        projectPatch.duration_seconds = Math.round(data.duration_ms / 1000);
      }

      const { data: updatedProjects, error: pErr } = await supabaseAdmin
        .from("projects")
        .update(projectPatch)
        .eq("id", data.project_id)
        .select("id");

      if (pErr || !updatedProjects || updatedProjects.length !== 1) {
        throw new Error(pErr?.message ?? "Failed to update project row");
      }
    } else {
      const { data: updatedJobs, error: jErr } = await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          stage_message: "Failed",
          error: sanitizedError,
          updated_at: nowIso,
        })
        .eq("id", data.job_id)
        .eq("project_id", data.project_id)
        .eq("user_id", context.userId)
        .select("id");

      if (jErr || !updatedJobs || updatedJobs.length !== 1) {
        throw new Error(jErr?.message ?? "Failed to update render job row");
      }

      const { data: updatedProjects, error: pErr } = await supabaseAdmin
        .from("projects")
        .update({
          status: "failed",
          updated_at: nowIso,
        })
        .eq("id", data.project_id)
        .select("id");

      if (pErr || !updatedProjects || updatedProjects.length !== 1) {
        throw new Error(pErr?.message ?? "Failed to update project row");
      }
    }

    return { ok: true };
  });

