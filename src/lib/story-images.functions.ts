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

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { MAX_SCENE_PROMPT, SCENE_BUCKET, sceneImageFolder } from "@/lib/motion-plan";
import { imageAllowance } from "@/lib/motion-plan.functions";
import { projectAccess, projectForEdit } from "@/lib/projects.functions";

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const LINK_SECONDS = 60 * 60;
const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

const extOf = (mime: string) => UPLOAD_TYPES[mime as keyof typeof UPLOAD_TYPES] ?? "jpg";
const inFolder = (path: string, folder: string) =>
  path.startsWith(folder) && !path.includes("..") && path.length <= 300;

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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project } = await projectForEdit(context.supabase, data.project_id, context.userId);
    const folder = sceneImageFolder(project.user_id, project.id);
    if (data.reference_path && !inFolder(data.reference_path, folder)) {
      throw new Error("That reference picture isn't one of this project's.");
    }
    const allowance = await imageAllowance(context.userId, project.team_id);
    if (allowance.used >= allowance.cap) {
      throw new Error(
        allowance.team
          ? `${allowance.team.name} has used all ${allowance.cap} AI pictures this month.`
          : `You've used all ${allowance.cap} AI pictures this month.`,
      );
    }

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const storage = admin.storage.from(SCENE_BUCKET);
    let reference = null;
    if (data.reference_path) {
      const { data: blob } = await storage.download(data.reference_path);
      if (blob)
        reference = {
          data: new Uint8Array(await blob.arrayBuffer()),
          mimeType: blob.type || "image/jpeg",
        };
    }

    const { generateSceneImage, IMAGE_MODEL, ImageError } =
      await import("@/lib/story-images.server");
    let image;
    try {
      image = await generateSceneImage({
        prompt: data.prompt,
        aspect: project.aspect_ratio,
        accentHex: data.accent,
        reference,
      });
    } catch (e) {
      throw new Error(e instanceof ImageError ? e.message : "Couldn't make the picture.");
    }
    // Counted once made (the service charges for it even if storing fails).
    const { error: runErr } = await admin.from("motion_image_runs").insert({
      user_id: context.userId,
      team_id: project.team_id,
      project_id: project.id,
      model: IMAGE_MODEL,
    });
    if (runErr) console.warn("[story-images] Couldn't record the picture:", runErr.message);

    const path = `${folder}${crypto.randomUUID()}.${extOf(image.mimeType)}`;
    const { error: upErr } = await storage.upload(path, image.data, {
      contentType: image.mimeType,
      upsert: false,
    });
    if (upErr) throw new Error(`Couldn't store the picture: ${upErr.message}`);
    const { data: signed } = await storage.createSignedUrl(path, LINK_SECONDS);
    return {
      path,
      url: signed?.signedUrl ?? null,
      images: { ...allowance, used: allowance.used + 1 },
    };
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
