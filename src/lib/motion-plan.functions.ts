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
  elementSpan,
  FULL_SCREEN_TYPES,
  wordsByKey,
  sceneImageFolder,
  mainSegments,
  numberedTranscript,
  parseMotionPlan,
  parseSpeakerCartoon,
  SCENE_BUCKET,
  SCENE_CLIP_MODEL,
  spokenWords,
  type MotionPlan,
  type PlanClip,
  type SpeakerCartoon,
} from "@/lib/motion-plan";
import { planFor, UNLIMITED, type Plan } from "@/lib/plans";
import { defaultLook } from "@/motion/looks";
import { parseUserPictures } from "@/lib/user-pictures";
import { applyClipCuts, projectAccess, projectForEdit } from "@/lib/projects.functions";
import { pauseCuts, placeBroll } from "@/lib/auto-edit";
import {
  allFillerDrops,
  fillerDrops,
  mergeDrops,
  takeDrops,
  type DropRange,
} from "@/lib/take-cuts";
import { requestBadTakes } from "@/lib/take-cuts.server";

import { WORKER_SECRET_MISMATCH, workerSecret } from "@/lib/worker-secret";
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
  planCapOf: (plan: Plan, team: boolean) => number,
): Promise<PlanAllowance> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  // The app's owner has no monthly limits (owner.server.ts).
  const { isAppOwner } = await import("@/lib/owner.server");
  const capOf = (plan: Plan, team: boolean) =>
    isAppOwner(userId) ? UNLIMITED : planCapOf(plan, team);
  let q = admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte("created_at", monthStartIso());
  // Animated clips are counted in the same table but have their own
  // allowance (story-clips.functions.ts), so they don't use up pictures.
  if (table === "motion_image_runs") q = q.neq("model", SCENE_CLIP_MODEL);
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

export async function projectWords(db: Db, project: ProjectRow, userId: string): Promise<ProjectWords> {
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
  .validator((d: unknown) => ProjectInput.parse(d))
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

// ---------- the automatic edit's cut ----------

/**
 * Cuts the pauses out of the main track for the automatic edit, from the
 * transcript's word times (src/lib/auto-edit.ts pauseCuts), saved like the
 * editor's Auto-cut. Only before the graphics are planned: a plan is anchored
 * to clips, and cutting moves words to new clip pieces. Returns how much
 * was cut.
 */
export const cutPausesForAutoEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ProjectInput.parse(d))
  .handler(({ data, context }) => cutPausesFor(context.supabase, context.userId, data));

export async function cutPausesFor(
  db: SupabaseClient<Database>,
  userId: string,
  data: { project_id: string },
) {
        const { project } = await projectForEdit(db, data.project_id, userId);
    if (parseMotionPlan(project.motion_plan))
      return { cutMs: 0, clips: 0, skipped: "planned", fillers: 0, takes: 0 };
    const { clips, missing, transcripts } = await projectWords(db, project, userId);
    if (missing.length) throw new Error("Some clips have no transcript yet.");
    // Filler sounds and bad takes go with the pauses. Bad takes need Claude;
    // without an answer only the pauses and fillers are cut.
    const fillers = allFillerDrops(transcripts);
    const spoken = spokenWords(mainSegments(clips), transcripts);
    const draft = await requestBadTakes(numberedTranscript(spoken), spoken.length);
    const takes = draft ? takeDrops(spoken, transcripts, draft) : new Map();
    const drops = mergeDrops(fillers, takes);
    const count = (m: Map<string, unknown[]>) => [...m.values()].reduce((n, l) => n + l.length, 0);
    const found = { fillers: count(fillers), takes: count(takes) };
    console.log(
      `[auto-edit] ${data.project_id}: ${found.fillers} filler(s), ${found.takes} bad take(s)` +
        (draft ? "" : " (bad takes not checked)"),
    );
    const cuts = pauseCuts(clips, transcripts, undefined, drops);
    if (!cuts.length) return { cutMs: 0, clips: 0, skipped: null, ...found };
    const byId = new Map(clips.map((c) => [c.id, c]));
    let cutMs = 0;
    for (const c of cuts) {
      const clip = byId.get(c.id);
      const was = (clip?.trim_out_ms ?? clip?.duration_ms ?? 0) - (clip?.trim_in_ms ?? 0);
      cutMs += Math.max(0, was - c.keep.reduce((n, k) => n + (k.out_ms - k.in_ms), 0));
    }
    await applyClipCuts(db, project.id, cuts);
    return { cutMs, clips: cuts.length, skipped: null, ...found };
}

/**
 * The filler sounds and bad takes in some of the main track's clips, for the
 * editor's Auto-cut list (ms into each clip's file, inside its visible part).
 * Clips whose file has no transcript yet come back in `untranscribed`;
 * `takesChecked` is false when Claude couldn't be asked.
 */
export const suggestTakeCuts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({ project_id: z.string().uuid(), clip_ids: z.array(z.string().uuid()).max(500) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const { clips, transcripts } = await projectWords(context.supabase, project, context.userId);
    const wanted = new Set(data.clip_ids);
    const segs = mainSegments(clips).filter((s) => wanted.has(s.clipId));
    const untranscribed = segs.filter((s) => !transcripts.has(s.storagePath)).map((s) => s.clipId);
    const heard = segs.filter((s) => transcripts.has(s.storagePath));

    type Suggestion = { fromMs: number; toMs: number; why: "filler" | "take"; text: string; reason: string };
    const out: Record<string, Suggestion[]> = {};
    const add = (clipId: string, d: DropRange) =>
      (out[clipId] ??= []).push({
        fromMs: d.fromMs,
        toMs: d.toMs,
        why: d.why,
        text: d.text ?? "",
        reason: d.reason ?? "",
      });

    for (const s of heard) {
      const from = s.trimInMs;
      const to = s.trimInMs + s.durationMs;
      for (const d of fillerDrops(transcripts.get(s.storagePath) ?? [])) {
        if (d.fromMs >= from && d.toMs <= to) add(s.clipId, d);
      }
    }
    const spoken = spokenWords(heard, transcripts);
    const draft = await requestBadTakes(numberedTranscript(spoken), spoken.length);
    if (draft) {
      for (const list of takeDrops(spoken, transcripts, draft).values()) {
        for (const d of list) if (d.clipId) add(d.clipId, d);
      }
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.fromMs - b.fromMs);
    return { clips: out, untranscribed, takesChecked: !!draft || spoken.length === 0 };
  });

/**
 * Places the B-roll for the automatic edit (src/lib/auto-edit.ts
 * placeBroll): spread over the video after the opening, each cut to a few
 * seconds, off the full-screen graphics. Only B-roll not placed by hand (and
 * only when there's a main track for it to go over).
 */
export const placeBrollForAutoEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ProjectInput.parse(d))
  .handler(({ data, context }) => placeBrollFor(context.supabase, context.userId, data));

export async function placeBrollFor(
  db: SupabaseClient<Database>,
  userId: string,
  data: { project_id: string },
) {
        const { project } = await projectForEdit(db, data.project_id, userId);
    const { clips, transcripts } = await projectWords(db, project, userId);
    const main = mainSegments(clips);
    const mainIds = new Set(main.map((m) => m.clipId));
    const broll = clips
      .filter((c) => c.role === "broll" && !mainIds.has(c.id) && c.start_ms == null)
      .sort((a, b) => a.ordinal - b.ordinal);
    if (!broll.length || !main.length) return { placed: 0, of: broll.length };
    const mainEndMs = Math.max(...main.map((m) => m.offsetMs + m.durationMs));

    // Moments full-screen graphics already cover.
    const plan = parseMotionPlan(project.motion_plan);
    const byKey = wordsByKey(spokenWords(main, transcripts));
    const busy = plan && plan.enabled !== false
      ? plan.elements
          .filter((e) => FULL_SCREEN_TYPES.has(e.type))
          .map((e) => elementSpan(e, byKey))
          .filter((x): x is { startMs: number; endMs: number } => !!x)
          .map((x) => ({ fromMs: x.startMs, toMs: x.endMs }))
      : [];

    const places = placeBroll(
      broll.map((c) => {
        const inMs = c.trim_in_ms ?? 0;
        const outMs = c.trim_out_ms ?? c.duration_ms ?? inMs + 4000;
        return { id: c.id, trimInMs: inMs, lengthMs: Math.max(0, outMs - inMs) };
      }),
      mainEndMs,
      busy,
    );
    for (const p of places) {
      const { error } = await db
        .from("clips")
        .update({ start_ms: p.startMs, trim_in_ms: p.trimInMs, trim_out_ms: p.trimOutMs })
        .eq("id", p.id)
        .eq("project_id", project.id);
      if (error) throw new Error(error.message);
    }
    return { placed: places.length, of: broll.length };
}

// ---------- planning ----------

export const planMotionGraphics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ProjectInput.parse(d))
  .handler(({ data, context }) => planGraphicsFor(context.supabase, context.userId, data));

export async function planGraphicsFor(
  db: SupabaseClient<Database>,
  userId: string,
  data: { project_id: string },
) {
        const { project } = await projectForEdit(db, data.project_id, userId);
    const { clips, missing, transcripts } = await projectWords(db, project, userId);

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

    const allowance = await planAllowance(userId, project.team_id);
    if (allowance.used >= allowance.cap) {
      throw new Error(
        allowance.team
          ? `${allowance.team.name} has used all ${allowance.cap} AI plans this month.`
          : `You've used all ${allowance.cap} AI plans this month.`,
      );
    }

    // The creator's own pictures, for Claude to look at and place.
    const own = await loadUserPictures(project);

    let result;
    try {
      result = await requestPlan({
        pictures: own.map((p) => p.picture),
        title: project.title,
        script: project.script,
        brief: project.brief,
        look: parseMotionPlan(project.motion_plan)?.look ?? defaultLook(project.style_preset),
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
      user_id: userId,
      team_id: project.team_id,
      project_id: project.id,
      model: result.model.slice(0, 64),
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });
    if (runErr) console.error("[planMotionGraphics] Recording the plan failed:", runErr.message);

    const elements = draftsToElements(
      result.draft.elements,
      words,
      undefined,
      own.map((p) => p.path),
    );
    // The sound switch and volume carry over; hand-moved or deleted sounds
    // belonged to the old graphics, so they don't. The colour (the same
    // video's) carries over too, and so does the colour LUT.
    const old = parseMotionPlan(project.motion_plan);
    const before = old?.sound;
    const colourBefore = old?.colour;
    const look = old?.look ?? defaultLook(project.style_preset);
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
      look,
      ...(old?.lut !== undefined ? { lut: old.lut } : {}),
      elements,
    };

    // The plan it replaces is kept once, for Undo.
    const previous = parseMotionPlan(project.motion_plan);
    const { error } = await db
      .from("projects")
      .update({
        motion_plan: plan as unknown as Json,
        ...(previous ? { motion_plan_previous: previous as unknown as Json } : {}),
        ...renderOutOfDate(project.status),
      })
      .eq("id", project.id);
    if (error) throw new Error(error.message);

    const shown = new Set(
      elements.flatMap((e) => (e.scenes ?? []).map((sc) => sc.image?.path).filter(Boolean)),
    );
    return {
      plan,
      dropped: result.draft.elements.length - elements.length,
      /** The creator's pictures, and how many of them the plan shows. */
      pictures: { of: own.length, placed: own.filter((p) => shown.has(p.path)).length },
    };
}

/** Claude takes pictures up to 5 MB each. */
const MAX_PLAN_PICTURE_BYTES = 5 * 1024 * 1024;

/**
 * The project's own pictures (projects.user_pictures) from storage, ready for
 * the planner; one that's missing or too big is left out (and logged).
 */
async function loadUserPictures(project: { id: string; user_pictures?: Json | null }) {
  const list = parseUserPictures(project.user_pictures);
  if (!list.length) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const loaded = await Promise.all(
    list.map(async (p) => {
      const { data: blob, error } = await supabaseAdmin.storage.from(SCENE_BUCKET).download(p.path);
      if (error || !blob) {
        console.warn("[planMotionGraphics] A picture of the creator's is missing:", p.path);
        return null;
      }
      if (blob.size > MAX_PLAN_PICTURE_BYTES) {
        console.warn(
          "[planMotionGraphics] A picture of the creator's is too big to plan with:",
          p.path,
        );
        return null;
      }
      const type =
        blob.type === "image/png" || blob.type === "image/webp" ? blob.type : "image/jpeg";
      return {
        path: p.path,
        picture: {
          data: Buffer.from(await blob.arrayBuffer()).toString("base64"),
          mediaType: type as "image/jpeg" | "image/png" | "image/webp",
          note: p.note,
        },
      };
    }),
  );
  return loaded.filter((p): p is NonNullable<typeof p> => p !== null);
}

/** Puts back the plan the last "Plan graphics" replaced (and keeps the newer one for Redo). */
export const undoMotionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ProjectInput.parse(d))
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const previous = parseMotionPlan(project.motion_plan_previous);
    if (!previous) throw new Error("There's no earlier plan to go back to.");
    const { error } = await context.supabase
      .from("projects")
      .update({
        motion_plan: previous as unknown as Json,
        motion_plan_previous: project.motion_plan,
        ...renderOutOfDate(project.status),
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
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        plan: z.unknown(),
      })
      .parse(d),
  )
  .handler(({ data, context }) => savePlanFor(context.supabase, context.userId, data));

export async function savePlanFor(
  db: SupabaseClient<Database>,
  userId: string,
  data: { project_id: string; plan?: unknown },
) {
        const parsed = MotionPlanSchema.safeParse(data.plan);
    if (!parsed.success) throw new Error("These graphics couldn't be saved (they aren't valid).");
    const plan = parsed.data;
    const { project } = await projectForEdit(db, data.project_id, userId);

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
      const clip = sc.image?.clip;
      if (clip && (!clip.startsWith(folder) || clip.includes("..") || !clip.endsWith(".mp4"))) {
        throw new Error("A scene clip isn't one of this project's.");
      }
    }
    // Notes lines: on this project's clips.
    if (plan.elements.some((e) => (e.lines ?? []).some((l) => !clipIds.has(l.at.clip_id)))) {
      throw new Error("A note line points at a clip that isn't in this project.");
    }
    const ids = new Set(plan.elements.map((e) => e.id));
    if (ids.size !== plan.elements.length) throw new Error("Two graphics have the same id.");

    // Only a real change makes the render out of date: not saving the same
    // plan again, nor the editor filling in, the first time it opens a plan,
    // the video's colours and where the speaker is.
    const changed = !current || renderSide(current, current) !== renderSide(plan, current);
    const { error } = await db
      .from("projects")
      .update({
        motion_plan: plan as unknown as Json,
        ...(changed ? renderOutOfDate(project.status) : {}),
      })
      .eq("id", project.id);
    if (error) throw new Error(error.message);
    return { plan };
}

/**
 * A finished render no longer matches once the graphics change (their
 * look, colour LUT, words or timing): a "ready" project goes back to
 * "draft", so the next export renders again instead of handing out the old
 * video (as clip edits do: projects.functions markProjectEdited).
 */
function renderOutOfDate(status: string | null): { status?: "draft" } {
  return status === "ready" ? { status: "draft" } : {};
}

/**
 * A plan for comparing, with what the editor fills in by itself left out
 * while `saved` doesn't have it yet (the footage's colours, the speaker's
 * place); missing and empty count the same.
 */
function renderSide(plan: MotionPlan, saved: MotionPlan): string {
  const { colour, angles, ...rest } = plan;
  return JSON.stringify({
    ...rest,
    colour: {
      ...colour,
      footage: saved.colour?.footage != null ? (colour?.footage ?? null) : null,
    },
    angles: {
      ...angles,
      center: saved.angles?.center !== undefined ? (angles?.center ?? null) : null,
    },
  });
}

// ---------- transcribing ----------

/** A worker address (/transcribe, /capture...), from RENDER_WORKER_URL (which may end in /jobs). */
export function workerEndpoint(name: string): URL {
  const raw = process.env.RENDER_WORKER_URL?.trim();
  if (!raw) throw new Error("RENDER_WORKER_URL is not configured");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RENDER_WORKER_URL must use http or https");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] === "jobs") segments.pop();
  segments.push(name);
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

/** The worker's request signature: HMAC-SHA256 of the body, in hex. */
export async function hmacHex(secret: string, body: string): Promise<string> {
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
  .validator((d: unknown) => ProjectInput.parse(d))
  .handler(({ data, context }) => transcribeFor(context.supabase, context.userId, data));

export async function transcribeFor(
  db: SupabaseClient<Database>,
  userId: string,
  data: { project_id: string },
) {
        const { project } = await projectForEdit(db, data.project_id, userId);
    const { missing } = await projectWords(db, project, userId);
    // One request per file, even if it's on the timeline more than once.
    const files = [...new Map(missing.map((c) => [c.storage_path, c])).values()];
    if (files.length === 0) return { queued: 0 };

    const secret = workerSecret();
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
      user_id: userId,
      files: signed,
      callback_url: transcribeCallbackUrl(),
    });
    let res: Response;
    try {
      res = await fetch(workerEndpoint("transcribe").toString(), {
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
    if (res.status === 401) throw new Error(WORKER_SECRET_MISMATCH);
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
}
