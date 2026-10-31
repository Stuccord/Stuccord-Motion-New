// Motion Explainer, stage 1: making the AI's graphics plan for a project.
//
// Planning needs the video's words first. "Transcribe" sends the main
// track's files that have no transcript yet to the render worker
// (/transcribe), which reports back through /api/public/transcribe-webhook;
// the editor watches projects.transcribe_status. Then "Plan graphics" sends
// the words (and the script, if any) to Claude and saves the checked plan on
// the project. The plan it replaces is kept once, for Undo.
//
// Who can do what follows the project: anyone who can open it sees the plan;
// planning, undoing and transcribing need edit rights. Plans count against a
// monthly allowance: the team's for a team project, else the person's own.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { cleanTranscriptWords, type TranscriptWord } from "@/lib/captions";
import { isImageFilename } from "@/lib/media-kind";
import {
  MOTION_STYLE,
  MotionPlan as MotionPlanSchema,
  draftsToElements,
  sceneImageFolder,
  mainSegments,
  numberedTranscript,
  parseMotionPlan,
  parseSpeakerCartoon,
  spokenWords,
  type MotionPlan,
  type PlanClip,
  type SpeakerCartoon,
} from "@/lib/motion-plan";
import { planFor, type Plan } from "@/lib/plans";
import { projectAccess, projectForEdit } from "@/lib/projects.functions";

const ProjectInput = z.object({ project_id: z.string().uuid() });

type Db = SupabaseClient<Database>;
type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

// ---------- allowance ----------

export type PlanAllowance = {
  used: number;
  cap: number;
  /** The team whose allowance it is; null for the person's own. */
  team: { id: string; name: string } | null;
};

/** The first moment of this month (UTC): allowances reset then. */
function monthStartIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * This month's AI plans against an allowance: a team's (plans for its
 * projects) or a person's own (plans outside teams).
 */
export function planAllowance(userId: string, teamId: string | null): Promise<PlanAllowance> {
  return monthlyAllowance("motion_plan_runs", userId, teamId, (p, team) =>
    team ? p.teamPlans : p.personalPlans,
  );
}

/** This month's AI story pictures against an allowance, counted like plans. */
export function imageAllowance(userId: string, teamId: string | null): Promise<PlanAllowance> {
  return monthlyAllowance("motion_image_runs", userId, teamId, (p, team) =>
    team ? p.teamImages : p.personalImages,
  );
}

/**
 * This month's runs in `table` against an allowance: a team's (runs for its
 * projects) or a person's own (runs outside teams). Counted with the admin
 * client so runs for projects that have since moved or gone still count.
 */
async function monthlyAllowance(
  table: "motion_plan_runs" | "motion_image_runs",
  userId: string,
  teamId: string | null,
  capOf: (plan: Plan, team: boolean) => number,
): Promise<PlanAllowance> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  let q = admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte("created_at", monthStartIso());
  if (teamId) {
    const { data: team } = await admin
      .from("teams")
      .select("id, name, plan")
      .eq("id", teamId)
      .maybeSingle();
    const { count, error } = await q.eq("team_id", teamId);
    if (error) throw new Error(error.message);
    return {
      used: count ?? 0,
      cap: capOf(planFor(team?.plan), true),
      team: { id: teamId, name: team?.name ?? "This team" },
    };
  }
  q = q.eq("user_id", userId).is("team_id", null);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return { used: count ?? 0, cap: capOf(planFor("free"), false), team: null };
}

// ---------- the project's words ----------

type ProjectWords = {
  clips: PlanClip[];
  /** Main-track video clips whose file has no transcript yet. */
  missing: PlanClip[];
  transcripts: Map<string, TranscriptWord[]>;
};

async function projectWords(db: Db, project: ProjectRow, userId: string): Promise<ProjectWords> {
  const { data: rows, error } = await db
    .from("clips")
    .select(
      "id, role, ordinal, storage_path, filename, trim_in_ms, trim_out_ms, duration_ms, start_ms",
    )
    .eq("project_id", project.id);
  if (error) throw new Error(error.message);
  const clips = (rows ?? []) as PlanClip[];
  const mainIds = new Set(mainSegments(clips).map((s) => s.clipId));
  const main = clips.filter((c) => mainIds.has(c.id) && !isImageFilename(c.filename ?? ""));

  const transcripts = new Map<string, TranscriptWord[]>();
  const paths = [...new Set(main.map((c) => c.storage_path))];
  if (paths.length) {
    // A team's files are the team's, whoever transcribed them; personal
    // files are looked up by their owner (as the export does).
    let tq = db.from("transcripts").select("storage_path, words").in("storage_path", paths);
    if (!project.team_id) tq = tq.eq("user_id", userId);
    const { data: saved, error: tErr } = await tq;
    if (tErr) throw new Error(tErr.message);
    for (const t of saved ?? []) transcripts.set(t.storage_path, cleanTranscriptWords(t.words));
  }
  const missing = main.filter((c) => !transcripts.has(c.storage_path));
  return { clips, missing, transcripts };
}

// ---------- reading ----------

/** A transcribe run that hasn't reported back in this long has stopped. */
const TRANSCRIBE_STALE_MS = 20 * 60 * 1000;

export type MotionPlanState = {
  plan: MotionPlan | null;
  canUndo: boolean;
  canEdit: boolean;
  transcribe: { status: "running" | "done" | "failed" | null; error: string | null };
  /** Main-track videos still without a transcript. */
  untranscribed: number;
  allowance: PlanAllowance;
  /** AI story pictures this month. */
  images: PlanAllowance;
  /** The project's cartoon of its speaker (stage 8), if made. */
  character: SpeakerCartoon | null;
};

export const getMotionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProjectInput.parse(d))
  .handler(async ({ data, context }): Promise<MotionPlanState> => {
    const { project, access } = await projectAccess(
      context.supabase,
      data.project_id,
      context.userId,
    );
    const { missing } = await projectWords(context.supabase, project, context.userId);
    let status = project.transcribe_status;
    let transcribeError = project.transcribe_error;
    const startedMs = project.transcribe_started_at
      ? Date.parse(project.transcribe_started_at)
      : NaN;
    if (status === "running" && !(Date.now() - startedMs < TRANSCRIBE_STALE_MS)) {
      status = "failed";
      transcribeError = "Transcribing stopped responding. Please try again.";
    }
    return {
      plan: parseMotionPlan(project.motion_plan),
      canUndo: parseMotionPlan(project.motion_plan_previous) != null,
      canEdit: access === "edit",
      transcribe: {
        status: status === "running" || status === "done" || status === "failed" ? status : null,
        error: transcribeError,
      },
      untranscribed: missing.length,
      allowance: await planAllowance(context.userId, project.team_id),
      images: await imageAllowance(context.userId, project.team_id),
      character: projectCartoon(project),
    };
  });

/** The project's cartoon, if it's stored and in the project's own folder. */
export function projectCartoon(project: {
  id: string;
  user_id: string;
  motion_character: Json | null;
}): SpeakerCartoon | null {
  const c = parseSpeakerCartoon(project.motion_character);
  const folder = sceneImageFolder(project.user_id, project.id);
  const ok = (p: string) => p.startsWith(folder) && !p.includes("..");
  return c && ok(c.image) && ok(c.photo) ? c : null;
}

// ---------- planning ----------

export const planMotionGraphics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProjectInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { project } = await projectForEdit(db, data.project_id, context.userId);
    const { clips, missing, transcripts } = await projectWords(db, project, context.userId);

    if (missing.length) {
      throw new Error(
        `${missing.length} clip${missing.length === 1 ? " has" : "s have"} no transcript yet. Click Transcribe first.`,
      );
    }
    const words = spokenWords(mainSegments(clips), transcripts);
    if (words.length === 0) throw new Error("There are no spoken words to plan graphics from.");

    // Imported here so the planner (and the SDK) only load on the server.
    const { MAX_PLAN_WORDS, PlanError, requestPlan } = await import("@/lib/motion-plan.server");
    if (words.length > MAX_PLAN_WORDS) {
      throw new Error(
        "This video is too long to plan in one go. Try splitting it into shorter projects.",
      );
    }

    const allowance = await planAllowance(context.userId, project.team_id);
    if (allowance.used >= allowance.cap) {
      throw new Error(
        allowance.team
          ? `${allowance.team.name} has used all ${allowance.cap} AI plans this month.`
          : `You've used all ${allowance.cap} AI plans this month.`,
      );
    }

    let result;
    try {
      result = await requestPlan({
        title: project.title,
        script: project.script,
        brief: project.brief,
        numberedWords: numberedTranscript(words),
        wordCount: words.length,
      });
    } catch (e) {
      if (e instanceof PlanError) throw new Error(e.message);
      console.error("[planMotionGraphics] Planning failed:", e instanceof Error ? e.message : e);
      throw new Error("Planning failed. Please try again.");
    }

    // A plan made counts, whatever's kept of it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: runErr } = await supabaseAdmin.from("motion_plan_runs").insert({
      user_id: context.userId,
      team_id: project.team_id,
      project_id: project.id,
      model: result.model.slice(0, 64),
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });
    if (runErr) console.error("[planMotionGraphics] Recording the plan failed:", runErr.message);

    const elements = draftsToElements(result.draft.elements, words);
    // The sound switch and volume carry over; hand-moved or deleted sounds
    // belonged to the old graphics, so they don't. The colour (the same
    // video's) carries over too.
    const old = parseMotionPlan(project.motion_plan);
    const before = old?.sound;
    const colourBefore = old?.colour;
    const plan: MotionPlan = {
      version: 1,
      style: MOTION_STYLE,
      model: result.model.slice(0, 64),
      language: result.draft.language.slice(0, 16) || "en",
      created_at: new Date().toISOString(),
      ...(before && (before.enabled !== undefined || before.volume !== undefined)
        ? { sound: { enabled: before.enabled, volume: before.volume } }
        : {}),
      ...(colourBefore ? { colour: colourBefore } : {}),
      elements,
    };

    // The plan it replaces is kept once, for Undo.
    const previous = parseMotionPlan(project.motion_plan);
    const { error } = await db
      .from("projects")
      .update({
        motion_plan: plan as unknown as Json,
        ...(previous ? { motion_plan_previous: previous as unknown as Json } : {}),
      })
      .eq("id", project.id);
    if (error) throw new Error(error.message);

    return { plan, dropped: result.draft.elements.length - elements.length };
  });

/** Puts back the plan the last "Plan graphics" replaced (and keeps the newer one for Redo). */
export const undoMotionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProjectInput.parse(d))
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const previous = parseMotionPlan(project.motion_plan_previous);
    if (!previous) throw new Error("There's no earlier plan to go back to.");
    const { error } = await context.supabase
      .from("projects")
      .update({
        motion_plan: previous as unknown as Json,
        motion_plan_previous: project.motion_plan,
      })
      .eq("id", project.id);
    if (error) throw new Error(error.message);
    return { plan: previous };
  });

// ---------- editing by hand ----------

/**
 * Saves the plan after changes made in the editor (graphics moved, resized,
 * edited, added or deleted, or all turned off). A plan is known by when it
 * was made (created_at): if the stored plan is a different one (the AI
 * replanned, or Undo ran, since these changes started), the save is refused
 * so that plan isn't overwritten. Every graphic must point at one of this
 * project's clips. The Undo copy is left as it is.
 */
export const saveMotionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        plan: z.unknown(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const parsed = MotionPlanSchema.safeParse(data.plan);
    if (!parsed.success) throw new Error("These graphics couldn't be saved (they aren't valid).");
    const plan = parsed.data;
    const { project } = await projectForEdit(db, data.project_id, context.userId);

    const current = parseMotionPlan(project.motion_plan);
    if (current && current.created_at !== plan.created_at) {
      throw new Error("The graphics were replanned meanwhile. Your view has been refreshed.");
    }

    const { data: rows, error: cErr } = await db
      .from("clips")
      .select("id")
      .eq("project_id", project.id);
    if (cErr) throw new Error(cErr.message);
    const clipIds = new Set((rows ?? []).map((c) => c.id));
    if (plan.elements.some((e) => !clipIds.has(e.start.clip_id) || !clipIds.has(e.end.clip_id))) {
      throw new Error("A graphic points at a clip that isn't in this project.");
    }
    // Story scenes: on this project's clips, and their pictures in this
    // project's own folder (the export hands out links to them).
    const folder = sceneImageFolder(project.user_id, project.id);
    for (const sc of plan.elements.flatMap((e) => e.scenes ?? [])) {
      if (!clipIds.has(sc.at.clip_id)) {
        throw new Error("A scene points at a clip that isn't in this project.");
      }
      if (sc.image && (!sc.image.path.startsWith(folder) || sc.image.path.includes(".."))) {
        throw new Error("A scene picture isn't one of this project's.");
      }
    }
    // Notes lines: on this project's clips.
    if (plan.elements.some((e) => (e.lines ?? []).some((l) => !clipIds.has(l.at.clip_id)))) {
      throw new Error("A note line points at a clip that isn't in this project.");
    }
    const ids = new Set(plan.elements.map((e) => e.id));
    if (ids.size !== plan.elements.length) throw new Error("Two graphics have the same id.");

    const { error } = await db
      .from("projects")
      .update({ motion_plan: plan as unknown as Json })
      .eq("id", project.id);
    if (error) throw new Error(error.message);
    return { plan };
  });

// ---------- transcribing ----------

/** The worker's /transcribe address, from RENDER_WORKER_URL (which may end in /jobs). */
function workerTranscribeUrl(): URL {
  const raw = process.env.RENDER_WORKER_URL?.trim();
  if (!raw) throw new Error("RENDER_WORKER_URL is not configured");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RENDER_WORKER_URL must use http or https");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] === "jobs") segments.pop();
  segments.push("transcribe");
  url.pathname = `/${segments.join("/")}`;
  return url;
}

function transcribeCallbackUrl(): string {
  const raw = (process.env.PUBLIC_APP_URL || process.env.PUBLIC_URL || "").trim();
  if (!raw) throw new Error("PUBLIC_APP_URL is not configured");
  const url = new URL(raw);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/public/transcribe-webhook`;
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
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sends the main-track files without a transcript to the worker to be transcribed. */
export const transcribeForPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProjectInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { project } = await projectForEdit(db, data.project_id, context.userId);
    const { missing } = await projectWords(db, project, context.userId);
    // One request per file, even if it's on the timeline more than once.
    const files = [...new Map(missing.map((c) => [c.storage_path, c])).values()];
    if (files.length === 0) return { queued: 0 };

    const secret = process.env.RENDER_WORKER_SECRET?.trim();
    if (!secret)
      throw new Error("Transcribing isn't set up yet (RENDER_WORKER_SECRET is missing).");

    const signed = await Promise.all(
      files.map(async (c) => {
        const { data: s } = await db.storage
          .from("raw-clips")
          .createSignedUrl(c.storage_path, 60 * 60 * 2);
        return {
          storage_path: c.storage_path,
          filename: c.filename ?? "",
          download_url: s?.signedUrl ?? null,
        };
      }),
    );
    if (signed.some((f) => !f.download_url))
      throw new Error("Couldn't read one of the clips. Please try again.");

    const body = JSON.stringify({
      project_id: project.id,
      user_id: context.userId,
      files: signed,
      callback_url: transcribeCallbackUrl(),
    });
    let res: Response;
    try {
      res = await fetch(workerTranscribeUrl().toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stuccord-signature": await hmacHex(secret, body),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Couldn't reach the render worker. Please try again.");
    }
    if (res.status === 503)
      throw new Error("The worker is busy with an export. Try again in a minute.");
    if (res.status === 404)
      throw new Error("The render worker needs updating before it can transcribe.");
    if (res.status !== 202) throw new Error(`The render worker refused (HTTP ${res.status}).`);

    const { error } = await db
      .from("projects")
      .update({
        transcribe_status: "running",
        transcribe_error: null,
        transcribe_started_at: new Date().toISOString(),
      })
      .eq("id", project.id);
    if (error) throw new Error(error.message);
    return { queued: files.length };
  });
