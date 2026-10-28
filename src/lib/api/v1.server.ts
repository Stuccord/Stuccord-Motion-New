// The public API (/api/v1), for a user's own scripts. Each request carries an
// API key ("Authorization: Bearer smk_..."), made in Settings → API keys.
//
// There's no signed-in session behind a key, so this uses the admin client
// and limits every query to the key's owner itself (user_id). Keep that true
// for anything added here.
//
// Docs for users: the API section in src/routes/_authenticated/help.tsx.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashApiKey, type ApiKeyScope } from "@/lib/api-keys.functions";
import { startCloudRender } from "@/lib/projects.functions";
import { isAudioRole, isImageFilename, IMAGE_DEFAULT_MS } from "@/lib/media-kind";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, UPLOAD_TYPES_MESSAGE } from "@/lib/upload-rules";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Caller = { userId: string; scope: ApiKeyScope; keyId: string };

// Requests per key per minute (per server instance), so a runaway script
// can't hammer the database.
const RATE_PER_MINUTE = 120;
const recent = new Map<string, number[]>();

async function authenticate(request: Request, need: ApiKeyScope): Promise<Caller> {
  const header = request.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(smk_[A-Za-z0-9]{40})$/.exec(header.trim())?.[1];
  if (!key) {
    throw new ApiError(401, "unauthorized", "Send your API key as: Authorization: Bearer smk_…");
  }
  const { data: row, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, scope, last_used_at")
    .eq("key_hash", await hashApiKey(key))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new ApiError(500, "server_error", "Couldn't check the API key");
  if (!row) throw new ApiError(401, "unauthorized", "This API key doesn't exist or was revoked");
  const scope: ApiKeyScope = row.scope === "full" ? "full" : "read";
  if (need === "full" && scope !== "full") {
    throw new ApiError(403, "forbidden", "This API key is read-only");
  }

  const now = Date.now();
  const times = (recent.get(row.id) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= RATE_PER_MINUTE) {
    throw new ApiError(429, "rate_limited", `Too many requests: up to ${RATE_PER_MINUTE} a minute`);
  }
  times.push(now);
  recent.set(row.id, times);

  // "Last used", at most every 5 minutes (best effort).
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > 5 * 60_000) {
    void supabaseAdmin
      .from("api_keys")
      .update({ last_used_at: new Date(now).toISOString() })
      .eq("id", row.id)
      .then(({ error: e }) => e && console.error("[api] last_used_at:", e.message));
  }
  return { userId: row.user_id, scope, keyId: row.id };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Runs an endpoint: checks the key, turns errors into JSON. */
export function endpoint(
  need: ApiKeyScope,
  run: (caller: Caller, request: Request, params: Record<string, string>) => Promise<unknown>,
  status = 200,
) {
  return async ({ request, params }: { request: Request; params: Record<string, string> }) => {
    try {
      const caller = await authenticate(request, need);
      return json(await run(caller, request, params ?? {}), status);
    } catch (e) {
      if (e instanceof ApiError) {
        return json({ error: { code: e.code, message: e.message } }, e.status);
      }
      if (e instanceof z.ZodError) {
        const issue = e.issues[0];
        const where = issue?.path.join(".") || "body";
        return json(
          {
            error: { code: "invalid_request", message: `${where}: ${issue?.message ?? "invalid"}` },
          },
          400,
        );
      }
      console.error("[api] Unexpected error:", e instanceof Error ? e.message : e);
      return json({ error: { code: "server_error", message: "Something went wrong" } }, 500);
    }
  };
}

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_request", "The body must be JSON");
  }
}

const uuid = (v: string | undefined, what: string) => {
  if (!v || !z.string().uuid().safeParse(v).success) {
    throw new ApiError(404, "not_found", `${what} not found`);
  }
  return v;
};

// ---------- what the API returns ----------

type ProjectRow = {
  id: string;
  title: string;
  aspect_ratio: string;
  status: string;
  created_at: string;
  updated_at: string;
};
const projectOut = (p: ProjectRow) => ({
  id: p.id,
  title: p.title,
  aspect_ratio: p.aspect_ratio,
  status: p.status,
  created_at: p.created_at,
  updated_at: p.updated_at,
});

const TRACK: Record<string, string> = {
  auto: "V1",
  aroll: "V1",
  broll: "V2",
  music: "A2",
  sfx: "A2",
  voiceover: "VO",
};

type JobRow = {
  id: string;
  project_id: string;
  status: string;
  progress: number;
  stage_message: string | null;
  error: string | null;
  output_path: string | null;
  created_at: string;
  updated_at: string;
};
async function exportOut(j: JobRow) {
  let download_url: string | null = null;
  if (j.status === "completed" && j.output_path) {
    const { data } = await supabaseAdmin.storage
      .from("renders")
      .createSignedUrl(j.output_path, 3600);
    download_url = data?.signedUrl ?? null;
  }
  return {
    id: j.id,
    project_id: j.project_id,
    status: j.status,
    progress: j.progress,
    stage: j.stage_message,
    error: j.status === "failed" ? j.error : null,
    download_url,
    download_expires_in: download_url ? 3600 : null,
    created_at: j.created_at,
    updated_at: j.updated_at,
  };
}

async function ownProject(userId: string, projectId: string | undefined) {
  const id = uuid(projectId, "Project");
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "server_error", "Couldn't load the project");
  if (!data) throw new ApiError(404, "not_found", "Project not found");
  return data;
}

// ---------- endpoints ----------

/** GET /api/v1/projects */
export async function listProjects({ userId }: Caller) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, title, aspect_ratio, status, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new ApiError(500, "server_error", "Couldn't list the projects");
  return { projects: (data ?? []).map(projectOut) };
}

/** POST /api/v1/projects { title, aspect_ratio? } */
export async function createProject({ userId }: Caller, request: Request) {
  const input = z
    .object({
      title: z.string().trim().min(1).max(120),
      aspect_ratio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
    })
    .parse(await body(request));
  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({ user_id: userId, title: input.title, aspect_ratio: input.aspect_ratio })
    .select("id, title, aspect_ratio, status, created_at, updated_at")
    .single();
  if (error) throw new ApiError(500, "server_error", "Couldn't make the project");
  return { project: projectOut(data) };
}

/** GET /api/v1/projects/:projectId — the project, its clips and its latest export. */
export async function getProject({ userId }: Caller, _r: Request, params: Record<string, string>) {
  const project = await ownProject(userId, params.projectId);
  const [{ data: clips }, { data: jobs }] = await Promise.all([
    supabaseAdmin
      .from("clips")
      .select("id, filename, role, ordinal, duration_ms, trim_in_ms, trim_out_ms, start_ms")
      .eq("project_id", project.id)
      .eq("user_id", userId)
      .order("ordinal", { ascending: true }),
    supabaseAdmin
      .from("render_jobs")
      .select("*")
      .eq("project_id", project.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  return {
    project: projectOut(project),
    clips: (clips ?? []).map((c) => ({
      id: c.id,
      filename: c.filename,
      track: TRACK[c.role] ?? "V1",
      duration_ms: c.duration_ms,
      trim_in_ms: c.trim_in_ms,
      trim_out_ms: c.trim_out_ms,
      start_ms: c.start_ms,
    })),
    latest_export: jobs?.[0] ? await exportOut(jobs[0]) : null,
  };
}

/**
 * POST /api/v1/projects/:projectId/uploads { filename, content_type, size }
 * A one-time link to PUT the file to (valid for 2 hours); then add it with
 * POST /clips.
 */
export async function createUpload(
  { userId }: Caller,
  request: Request,
  params: Record<string, string>,
) {
  const project = await ownProject(userId, params.projectId);
  const input = z
    .object({
      filename: z.string().trim().min(1).max(200),
      content_type: z.string().min(1).max(100),
      size: z.number().int().positive(),
    })
    .parse(await body(request));
  if (!ALLOWED_UPLOAD_TYPES.has(input.content_type)) {
    throw new ApiError(400, "unsupported_type", `Unsupported file type. ${UPLOAD_TYPES_MESSAGE}`);
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(400, "too_large", "Files can be up to 500 MB");
  }
  // In the user's own folder, like the editor's uploads.
  const safe = input.filename.replace(/[^\w.-]+/g, "_");
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `${userId}/projects/${project.id}/clips/${unique}-${safe}`;
  const { data, error } = await supabaseAdmin.storage.from("raw-clips").createSignedUploadUrl(path);
  if (error || !data) throw new ApiError(500, "server_error", "Couldn't make an upload link");
  return {
    upload: {
      path,
      url: data.signedUrl,
      method: "PUT",
      headers: { "content-type": input.content_type },
      expires_in: 7200,
    },
  };
}

/**
 * POST /api/v1/projects/:projectId/clips
 *   { path, filename?, track?: "V1"|"V2"|"A2"|"VO", duration_ms?, start_ms? }
 * Adds an uploaded file to the timeline (V1: after the last clip).
 */
export async function addClip(
  { userId }: Caller,
  request: Request,
  params: Record<string, string>,
) {
  const project = await ownProject(userId, params.projectId);
  const input = z
    .object({
      path: z.string().min(1).max(400),
      filename: z.string().trim().min(1).max(200).optional(),
      track: z.enum(["V1", "V2", "A2", "VO"]).optional(),
      duration_ms: z.number().int().positive().optional(),
      start_ms: z.number().int().nonnegative().optional(),
    })
    .parse(await body(request));
  const prefix = `${userId}/projects/${project.id}/clips/`;
  if (!input.path.startsWith(prefix) || input.path.includes("..")) {
    throw new ApiError(400, "invalid_request", "path: use the path from POST /uploads");
  }
  // The file must be there (uploaded to the link).
  const folder = input.path.slice(0, input.path.lastIndexOf("/"));
  const name = input.path.slice(input.path.lastIndexOf("/") + 1);
  const { data: found } = await supabaseAdmin.storage
    .from("raw-clips")
    .list(folder, { search: name, limit: 10 });
  const file = (found ?? []).find((f) => f.name === name);
  if (!file) {
    throw new ApiError(400, "not_uploaded", "Upload the file to the link first, then add it");
  }
  const filename = input.filename ?? name.replace(/^\d+_[a-z0-9]+-/, "");
  const audioName = /\.(mp3|wav|m4a|aac|ogg)$/i.test(filename);
  const track = input.track ?? (audioName ? "A2" : "V1");
  if (
    (track === "A2" || track === "VO") !== audioName &&
    !(track === "VO" && /\.webm$/i.test(filename))
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      audioName ? "Audio goes on A2 or VO" : "Videos and images go on V1 or V2",
    );
  }
  const role =
    track === "V1"
      ? "aroll"
      : track === "V2"
        ? "broll"
        : track === "VO"
          ? "voiceover"
          : /sfx|whoosh|impact|riser|swoosh|snap/i.test(filename)
            ? "sfx"
            : "music";
  const { count } = await supabaseAdmin
    .from("clips")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id)
    .eq("user_id", userId);
  const image = isImageFilename(filename);
  const { data: row, error } = await supabaseAdmin
    .from("clips")
    .insert({
      project_id: project.id,
      user_id: userId,
      storage_path: input.path,
      filename,
      size_bytes: Number((file.metadata as { size?: number } | null)?.size ?? 0),
      role,
      ordinal: count ?? 0,
      trim_in_ms: 0,
      trim_out_ms: image ? IMAGE_DEFAULT_MS : null,
      duration_ms: input.duration_ms ?? null,
      ...(input.start_ms !== undefined || role === "voiceover"
        ? { start_ms: input.start_ms ?? 0 }
        : {}),
    })
    .select("id, filename, role, duration_ms, start_ms")
    .single();
  if (error) throw new ApiError(500, "server_error", "Couldn't add the clip");
  // An edit after an export makes the project a draft again (like the editor).
  await supabaseAdmin
    .from("projects")
    .update({ status: "draft" })
    .eq("id", project.id)
    .eq("user_id", userId)
    .eq("status", "ready");
  return {
    clip: {
      id: row.id,
      filename: row.filename,
      track: TRACK[row.role] ?? track,
      duration_ms: row.duration_ms,
      start_ms: row.start_ms,
      is_audio: isAudioRole(row.role),
    },
  };
}

/**
 * POST /api/v1/projects/:projectId/exports { captions?, music?, music_volume? }
 * Starts a cloud export (counts toward the monthly exports).
 */
export async function startExport(
  { userId }: Caller,
  request: Request,
  params: Record<string, string>,
) {
  const project = await ownProject(userId, params.projectId);
  const raw =
    request.headers.get("content-length") === "0" ? {} : await body(request).catch(() => ({}));
  const input = z
    .object({
      captions: z.boolean().optional(),
      music: z.boolean().optional(),
      music_volume: z.number().int().min(0).max(100).optional(),
    })
    .parse(raw ?? {});
  try {
    const job = await startCloudRender(supabaseAdmin, userId, {
      project_id: project.id,
      captions: input.captions ?? project.captions_enabled,
      music: {
        enabled: input.music ?? project.music_enabled,
        volume: input.music_volume ?? project.music_volume,
      },
    });
    return { export: await exportOut(job) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't start the export";
    if (/exports for this month/.test(msg)) throw new ApiError(429, "export_limit", msg);
    if (/Upload at least one clip|Add a video or picture/.test(msg)) {
      throw new ApiError(400, "no_clips", msg);
    }
    throw new ApiError(503, "export_unavailable", msg);
  }
}

/** GET /api/v1/exports/:exportId */
export async function getExport({ userId }: Caller, _r: Request, params: Record<string, string>) {
  const id = uuid(params.exportId, "Export");
  const { data, error } = await supabaseAdmin
    .from("render_jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "server_error", "Couldn't load the export");
  if (!data) throw new ApiError(404, "not_found", "Export not found");
  return { export: await exportOut(data) };
}
