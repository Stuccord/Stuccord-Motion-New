// Animated story scenes: a story picture brought to life as a 5-second clip
// on Higgsfield (story-clips.server.ts). Two steps, so no request stays open
// for the minutes a clip takes: start (checks edit rights and the monthly
// allowance, sends the picture, returns a signed ticket), then check, again
// every few seconds, until the clip is stored next to its picture in the
// project's folder of motion-images; the caller puts its path on the scene's
// picture (image.clip) and saves the plan.
//
// The allowance is per video: SCENE_CLIP_MONTHLY_VIDEOS projects a month for
// a person (or a team), any number of clips in each; the app's owner has no
// limit. Clips are counted in motion_image_runs under their own model, which
// the picture allowance leaves out.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  MAX_SCENE_PROMPT,
  SCENE_BUCKET,
  SCENE_CLIP_MODEL,
  SCENE_CLIP_MONTHLY_VIDEOS,
  sceneImageFolder,
} from "@/lib/motion-plan";
import { hmacHex } from "@/lib/motion-plan.functions";
import { projectForEdit } from "@/lib/projects.functions";

const inFolder = (path: string, folder: string) =>
  path.startsWith(folder) && !path.includes("..") && path.length <= 300;

function monthStartIso() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** The ticket that ties a Higgsfield request to the project and picture it was started for. */
async function ticketFor(projectId: string, requestId: string, imagePath: string) {
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (!secret) throw new Error("AI clips aren't set up yet (the Higgsfield key is missing).");
  return hmacHex(`scene-clip:${secret}`, `${projectId}\n${requestId}\n${imagePath}`);
}

/**
 * This month's videos with animated pictures against the allowance; `ok` when
 * this project may have (more) clips: it already has some this month, or
 * there's room for one more video.
 */
export async function clipAllowance(userId: string, teamId: string | null, projectId: string) {
  const { isAppOwner } = await import("@/lib/owner.server");
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  let q = admin
    .from("motion_image_runs")
    .select("project_id")
    .eq("model", SCENE_CLIP_MODEL)
    .gte("created_at", monthStartIso());
  q = teamId ? q.eq("team_id", teamId) : q.eq("user_id", userId).is("team_id", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const videos = new Set((data ?? []).map((r) => r.project_id).filter(Boolean));
  const unlimited = isAppOwner(userId);
  const cap = unlimited ? null : SCENE_CLIP_MONTHLY_VIDEOS;
  const ok = unlimited || videos.has(projectId) || videos.size < SCENE_CLIP_MONTHLY_VIDEOS;
  return { used: videos.size, cap, ok };
}

/** Starts bringing one of the project's story pictures to life; returns a ticket to check it with. */
export const startSceneClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        /** The picture (one of this project's) to animate. */
        image_path: z.string().min(1).max(300),
        /** What the scene shows (its picture's description). */
        prompt: z.string().trim().min(3).max(MAX_SCENE_PROMPT),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const folder = sceneImageFolder(project.user_id, project.id);
    if (!inFolder(data.image_path, folder) || data.image_path.endsWith(".mp4")) {
      throw new Error("That picture isn't one of this project's.");
    }
    const allowance = await clipAllowance(context.userId, project.team_id, project.id);
    if (!allowance.ok) {
      throw new Error(
        `You've used all ${SCENE_CLIP_MONTHLY_VIDEOS} videos with animated pictures this month; this one keeps its still pictures.`,
      );
    }
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: blob } = await admin.storage.from(SCENE_BUCKET).download(data.image_path);
    if (!blob) throw new Error("That picture is missing. Make it again.");
    const { startClip, ClipError } = await import("@/lib/story-clips.server");
    let requestId: string;
    try {
      requestId = await startClip(
        { data: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || "image/png" },
        data.prompt,
        project.aspect_ratio,
      );
    } catch (e) {
      throw new Error(e instanceof ClipError ? e.message : "Couldn't start the clip.");
    }
    return {
      request_id: requestId,
      ticket: await ticketFor(project.id, requestId, data.image_path),
      started_at: Date.now(),
    };
  });

/** Checks a started clip: still being made, or stored (its path), or failed (a message). */
export const checkSceneClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        request_id: z.string().min(1).max(200),
        image_path: z.string().min(1).max(300),
        ticket: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    if (data.ticket !== (await ticketFor(project.id, data.request_id, data.image_path))) {
      throw new Error("That clip wasn't started for this picture.");
    }
    const { checkClip } = await import("@/lib/story-clips.server");
    const result = await checkClip(data.request_id);
    if (result.state === "running") return { state: "running" as const };
    if (result.state === "failed") {
      return { state: "failed" as const, error: result.error, retry: result.retry };
    }

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    // Counted once made (Higgsfield charges for it even if storing fails).
    const { error: runErr } = await admin.from("motion_image_runs").insert({
      user_id: context.userId,
      team_id: project.team_id,
      project_id: project.id,
      model: SCENE_CLIP_MODEL,
    });
    if (runErr) console.warn("[story-clips] Couldn't record the clip:", runErr.message);
    const folder = sceneImageFolder(project.user_id, project.id);
    const path = `${folder}${crypto.randomUUID()}.mp4`;
    const { error: upErr } = await admin.storage
      .from(SCENE_BUCKET)
      .upload(path, result.video, { contentType: "video/mp4", upsert: false });
    if (upErr) throw new Error(`Couldn't store the clip: ${upErr.message}`);
    return { state: "done" as const, path };
  });
