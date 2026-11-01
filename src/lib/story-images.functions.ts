// Motion Explainer, stage 7: story scenes' pictures.
//
// The editor asks for one picture at a time (so it can show progress, and
// later scenes can use the story's first picture as a style reference). The
// server checks edit rights and the monthly allowance, makes the picture
// with Gemini (story-images.server.ts), stores it in the private
// motion-images bucket in the project's folder, and returns its path; the
// editor puts the path in the plan, which saveMotionPlan checks. Uploaded
// pictures go straight to that folder through a one-time upload link.
// Anyone who can open the project gets short-lived links to its pictures.
//
// Stage 8: the speaker's cartoon. The editor uploads a photo of the speaker
// (a frame of the footage it picked, or the user's own) and, once the user
// confirms they are that person or have their permission, the server turns
// it into a 3D animated character and stores it on the project. Scenes with
// the speaker in them, and cartoon graphics, get it as a reference.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import {
  MAX_SCENE_PROMPT,
  SCENE_BUCKET,
  sceneImageFolder,
  type SpeakerCartoon,
} from "@/lib/motion-plan";
import {
  hmacHex,
  imageAllowance,
  projectCartoon,
  workerEndpoint,
} from "@/lib/motion-plan.functions";
import { WORKER_SECRET_MISMATCH, workerSecret } from "@/lib/worker-secret";
import { projectAccess, projectForEdit } from "@/lib/projects.functions";

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const LINK_SECONDS = 60 * 60;
const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

const extOf = (mime: string) => UPLOAD_TYPES[mime as keyof typeof UPLOAD_TYPES] ?? "jpg";
const inFolder = (path: string, folder: string) =>
  path.startsWith(folder) && !path.includes("..") && path.length <= 300;

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** Refuses when the month's AI pictures are used up. */
async function checkAllowance(userId: string, teamId: string | null) {
  const allowance = await imageAllowance(userId, teamId);
  if (allowance.used >= allowance.cap) {
    throw new Error(
      allowance.team
        ? `${allowance.team.name} has used all ${allowance.cap} AI pictures this month.`
        : `You've used all ${allowance.cap} AI pictures this month.`,
    );
  }
  return allowance;
}

/** A stored picture's bytes, or null when it's gone. */
async function downloadImage(admin: Admin, path: string) {
  const { data: blob } = await admin.storage.from(SCENE_BUCKET).download(path);
  return blob
    ? { data: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || "image/jpeg" }
    : null;
}

/** Counts a made picture against the allowance, stores it, and links it. */
async function keepImage(
  admin: Admin,
  run: { userId: string; teamId: string | null; projectId: string; model: string },
  folder: string,
  image: { data: Uint8Array; mimeType: string },
) {
  // Counted once made (the service charges for it even if storing fails).
  const { error: runErr } = await admin.from("motion_image_runs").insert({
    user_id: run.userId,
    team_id: run.teamId,
    project_id: run.projectId,
    model: run.model,
  });
  if (runErr) console.warn("[story-images] Couldn't record the picture:", runErr.message);
  const storage = admin.storage.from(SCENE_BUCKET);
  const path = `${folder}${crypto.randomUUID()}.${extOf(image.mimeType)}`;
  const { error: upErr } = await storage.upload(path, image.data, {
    contentType: image.mimeType,
    upsert: false,
  });
  if (upErr) throw new Error(`Couldn't store the picture: ${upErr.message}`);
  const { data: signed } = await storage.createSignedUrl(path, LINK_SECONDS);
  return { path, url: signed?.signedUrl ?? null };
}

/** Makes one scene picture; returns its path and a link to show it. */
export const makeSceneImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        prompt: z.string().trim().min(3).max(MAX_SCENE_PROMPT),
        /** The story's first picture, to match (one of this project's). */
        reference_path: z.string().max(300).nullable(),
        /** The video's colour, for the house style's tint. */
        accent: Hex.nullable(),
        /** Cinematic for stories, 3D animated for cartoon graphics. */
        style: z.enum(["cinematic", "cartoon"]).default("cinematic"),
        /** The speaker is in the picture: send their cartoon along. */
        with_speaker: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const folder = sceneImageFolder(project.user_id, project.id);
    if (data.reference_path && !inFolder(data.reference_path, folder)) {
      throw new Error("That reference picture isn't one of this project's.");
    }
    const cartoon = data.with_speaker ? projectCartoon(project) : null;
    if (data.with_speaker && !cartoon) {
      throw new Error(
        "Make the speaker's cartoon first (Cartoon of the speaker, in the Graphics panel).",
      );
    }
    const allowance = await checkAllowance(context.userId, project.team_id);

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const reference = data.reference_path ? await downloadImage(admin, data.reference_path) : null;
    const character = cartoon ? await downloadImage(admin, cartoon.image) : null;
    if (cartoon && !character) throw new Error("The speaker's cartoon is missing. Make it again.");

    const { generateSceneImage, IMAGE_MODEL, ImageError } =
      await import("@/lib/story-images.server");
    let image;
    try {
      image = await generateSceneImage({
        prompt: data.prompt,
        aspect: project.aspect_ratio,
        accentHex: data.accent,
        reference,
        style: data.style,
        character,
      });
    } catch (e) {
      throw new Error(e instanceof ImageError ? e.message : "Couldn't make the picture.");
    }
    const kept = await keepImage(
      admin,
      {
        userId: context.userId,
        teamId: project.team_id,
        projectId: project.id,
        model: IMAGE_MODEL,
      },
      folder,
      image,
    );
    return { ...kept, images: { ...allowance, used: allowance.used + 1 } };
  });

/**
 * Makes the project's cartoon of its speaker from a photo of them (already
 * uploaded to the project's folder), once the user confirms consent; it
 * replaces any earlier one.
 */
export const makeSpeakerCartoon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        photo_path: z.string().max(300),
        from: z.enum(["footage", "upload"]),
        /** "I am this person, or I have their permission." */
        consent: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const folder = sceneImageFolder(project.user_id, project.id);
    if (!inFolder(data.photo_path, folder))
      throw new Error("That photo isn't one of this project's.");
    const allowance = await checkAllowance(context.userId, project.team_id);

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const photo = await downloadImage(admin, data.photo_path);
    if (!photo) throw new Error("The photo didn't upload. Try again.");

    const { generateSpeakerCartoon, IMAGE_MODEL, ImageError } =
      await import("@/lib/story-images.server");
    let image;
    try {
      image = await generateSpeakerCartoon(photo);
    } catch (e) {
      throw new Error(e instanceof ImageError ? e.message : "Couldn't make the cartoon.");
    }
    const kept = await keepImage(
      admin,
      {
        userId: context.userId,
        teamId: project.team_id,
        projectId: project.id,
        model: IMAGE_MODEL,
      },
      folder,
      image,
    );
    const now = new Date().toISOString();
    const character: SpeakerCartoon = {
      image: kept.path,
      photo: data.photo_path,
      from: data.from,
      consent_by: context.userId,
      consent_at: now,
      made_at: now,
    };
    const { error } = await admin
      .from("projects")
      .update({ motion_character: character as unknown as Json })
      .eq("id", project.id);
    if (error) throw new Error(error.message);
    return { character, url: kept.url, images: { ...allowance, used: allowance.used + 1 } };
  });

/** A one-time link to upload the user's own picture for a scene. */
export const sceneUploadSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        content_type: z.enum(Object.keys(UPLOAD_TYPES) as [keyof typeof UPLOAD_TYPES]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const path = `${sceneImageFolder(project.user_id, project.id)}${crypto.randomUUID()}.${extOf(data.content_type)}`;
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: slot, error } = await admin.storage
      .from(SCENE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !slot) throw new Error(error?.message ?? "Couldn't prepare the upload");
    return { path, token: slot.token };
  });

/** Short-lived links to the project's story pictures, by path. */
export const signSceneImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        paths: z.array(z.string().max(300)).max(60),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Anyone who can open the project (projectAccess refuses anyone else).
    const { project } = await projectAccess(context.supabase, data.project_id, context.userId);
    const folder = sceneImageFolder(project.user_id, project.id);
    const paths = [...new Set(data.paths.filter((p) => inFolder(p, folder)))];
    if (!paths.length) return { urls: {} as Record<string, string> };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await admin.storage
      .from(SCENE_BUCKET)
      .createSignedUrls(paths, LINK_SECONDS);
    if (error) throw new Error(error.message);
    const urls: Record<string, string> = {};
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
    return { urls };
  });

// ---------- capturing a web page for an app screen ----------

/** Captures per person: one at a time, and at most this many an hour (per server). */
const CAPTURES_PER_HOUR = 20;
const captureLog = new Map<string, number[]>();
const capturingNow = new Set<string>();

/** The biggest screenshot taken back from the worker. */
const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;

/**
 * Has the worker screenshot a public web page (render-worker/capture.js,
 * which refuses internal addresses) and stores it in the project's pictures.
 */
export const captureScreenPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        url: z.string().trim().min(3).max(500),
        device: z.enum(["phone", "browser"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const now = Date.now();
    const recent = (captureLog.get(context.userId) ?? []).filter((t) => now - t < 3_600_000);
    if (capturingNow.has(context.userId)) throw new Error("A page is already being captured.");
    if (recent.length >= CAPTURES_PER_HOUR)
      throw new Error("That's a lot of captures for one hour. Try again a little later.");
    const secret = workerSecret();
    if (!secret) throw new Error("Capturing isn't set up yet (RENDER_WORKER_SECRET is missing).");

    captureLog.set(context.userId, [...recent, now]);
    capturingNow.add(context.userId);
    try {
      const body = JSON.stringify({ url: data.url, device: data.device });
      let res: Response;
      try {
        res = await fetch(workerEndpoint("capture").toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stuccord-signature": await hmacHex(secret, body),
          },
          body,
          signal: AbortSignal.timeout(75_000),
        });
      } catch {
        throw new Error("Couldn't reach the render worker. Please try again.");
      }
      if (res.status === 401) throw new Error(WORKER_SECRET_MISMATCH);
      if (res.status === 404)
        throw new Error("The render worker needs updating before it can capture pages.");
      if (res.status === 503)
        throw new Error("Another page is being captured. Try again in a few seconds.");
      if (res.status === 422) {
        const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          typeof j?.error === "string" ? j.error.slice(0, 300) : "Couldn't capture that page.",
        );
      }
      if (!res.ok) throw new Error(`The render worker refused (HTTP ${res.status}).`);
      const png = new Uint8Array(await res.arrayBuffer());
      const isPng = png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
      if (!isPng || png.length > MAX_CAPTURE_BYTES)
        throw new Error("The capture didn't come through properly. Please try again.");

      const path = `${sceneImageFolder(project.user_id, project.id)}${crypto.randomUUID()}.png`;
      const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
      const { error } = await admin.storage
        .from(SCENE_BUCKET)
        .upload(path, png, { contentType: "image/png", upsert: false });
      if (error) throw new Error(error.message);
      const { data: signed } = await admin.storage
        .from(SCENE_BUCKET)
        .createSignedUrl(path, LINK_SECONDS);
      return { path, url: signed?.signedUrl ?? null };
    } finally {
      capturingNow.delete(context.userId);
    }
  });
