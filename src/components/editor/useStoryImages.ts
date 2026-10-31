// Story scenes' pictures in the editor: links to show them, and making,
// remaking and uploading them. Pictures are made one at a time, the story's
// first one first, so later scenes can match it (story-images.functions).
// Right after the AI plans a story, its pictures are made automatically.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SCENE_BUCKET, type MotionPlan, type SceneImage } from "@/lib/motion-plan";
import { makeSceneImage, sceneUploadSlot, signSceneImages } from "@/lib/story-images.functions";
import type { MotionPlanState } from "@/lib/motion-plan.functions";

/** Uploaded pictures: these types, up to the bucket's 10 MB. */
export const SCENE_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const SCENE_UPLOAD_MAX = 10 * 1024 * 1024;

type Motion = {
  plan: MotionPlan | null;
  canEdit: boolean;
  update: (change: (p: MotionPlan) => MotionPlan) => void;
};

/** Sets one scene's picture, if the scene still asks for what was made. */
function withSceneImage(
  p: MotionPlan,
  elementId: string,
  index: number,
  image: SceneImage,
  prompt: string | null,
): MotionPlan {
  return {
    ...p,
    elements: p.elements.map((e) =>
      e.id !== elementId ||
      !e.scenes?.[index] ||
      (prompt !== null && e.scenes[index].prompt !== prompt)
        ? e
        : {
            ...e,
            scenes: e.scenes.map((sc, i) => (i === index ? { ...sc, image } : sc)),
          },
    ),
  };
}

export function useStoryImages(projectId: string, motion: Motion, accent: string | null) {
  const qc = useQueryClient();
  const makeFn = useServerFn(makeSceneImage);
  const slotFn = useServerFn(sceneUploadSlot);
  const signFn = useServerFn(signSceneImages);

  // Links for every picture in the plan (refreshed before they run out).
  const paths = useMemo(
    () =>
      [
        ...new Set(
          (motion.plan?.elements ?? [])
            .flatMap((e) => e.scenes ?? [])
            .map((sc) => sc.image?.path)
            .filter((x): x is string => !!x),
        ),
      ].sort(),
    [motion.plan],
  );
  const signed = useQuery({
    queryKey: ["scene-images", projectId, paths],
    queryFn: () => signFn({ data: { project_id: projectId, paths } }),
    enabled: typeof window !== "undefined" && paths.length > 0,
    staleTime: 45 * 60 * 1000,
    refetchInterval: 45 * 60 * 1000,
  });
  // Links for pictures made just now, until the list above catches up.
  const [fresh, setFresh] = useState<Record<string, string>>({});
  const urls = useMemo(() => ({ ...fresh, ...(signed.data?.urls ?? {}) }), [fresh, signed.data]);

  // Scenes being made or uploaded: "elementId:index".
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const mark = (key: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const latestPlan = useRef(motion.plan);
  latestPlan.current = motion.plan;

  /** Makes one scene's picture (matching the story's first picture, if it has one). */
  const make = useCallback(
    async (elementId: string, index: number, reference?: string | null): Promise<string | null> => {
      const el = latestPlan.current?.elements.find((e) => e.id === elementId);
      const scene = el?.scenes?.[index];
      if (!el || !scene) return null;
      if (scene.prompt.trim().length < 3) {
        toast.error("Describe the picture first.");
        return null;
      }
      // The story's first picture (just made, or already in the plan).
      const first = reference !== undefined ? reference : (el.scenes?.[0]?.image?.path ?? null);
      const key = `${elementId}:${index}`;
      mark(key, true);
      try {
        const r = await makeFn({
          data: {
            project_id: projectId,
            prompt: scene.prompt,
            reference_path: index > 0 ? first : null,
            accent,
          },
        });
        if (r.url) setFresh((f) => ({ ...f, [r.path]: r.url as string }));
        motion.update((p) =>
          withSceneImage(p, elementId, index, { path: r.path, source: "ai" }, scene.prompt),
        );
        qc.setQueryData<MotionPlanState>(["motion-plan", projectId], (old) =>
          old ? { ...old, images: r.images } : old,
        );
        return r.path;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't make the picture");
        return null;
      } finally {
        mark(key, false);
      }
    },
    [accent, makeFn, motion, projectId, qc],
  );

  /** Makes every scene of a story still without a picture, first scene first. */
  const makeMissing = useCallback(
    async (elementId: string) => {
      const scenes = latestPlan.current?.elements.find((e) => e.id === elementId)?.scenes ?? [];
      let first = scenes[0]?.image?.path ?? null;
      for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].image) continue;
        const made = await make(elementId, i, i === 0 ? null : first);
        if (!made) break;
        if (i === 0) first = made;
      }
    },
    [make],
  );

  /** Uses the user's own picture for a scene. */
  const upload = useCallback(
    async (elementId: string, index: number, file: File) => {
      if (!SCENE_UPLOAD_TYPES.includes(file.type as (typeof SCENE_UPLOAD_TYPES)[number])) {
        toast.error("Use a JPG, PNG or WebP picture.");
        return;
      }
      if (file.size > SCENE_UPLOAD_MAX) {
        toast.error("That picture is over 10 MB.");
        return;
      }
      const key = `${elementId}:${index}`;
      mark(key, true);
      try {
        const slot = await slotFn({
          data: {
            project_id: projectId,
            content_type: file.type as (typeof SCENE_UPLOAD_TYPES)[number],
          },
        });
        const { error } = await supabase.storage
          .from(SCENE_BUCKET)
          .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
        setFresh((f) => ({ ...f, [slot.path]: URL.createObjectURL(file) }));
        motion.update((p) =>
          withSceneImage(p, elementId, index, { path: slot.path, source: "upload" }, null),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't upload the picture");
      } finally {
        mark(key, false);
      }
    },
    [motion, projectId, slotFn],
  );

  // Right after the AI plans a story: make its pictures (once per plan).
  const started = useRef(new Set<string>());
  useEffect(() => {
    const plan = motion.plan;
    if (!plan || !motion.canEdit) return;
    for (const el of plan.elements) {
      if (el.type !== "story" || el.source !== "ai") continue;
      const key = `${plan.created_at}:${el.id}`;
      if (started.current.has(key)) continue;
      if (!(el.scenes ?? []).some((sc) => !sc.image)) continue;
      started.current.add(key);
      void makeMissing(el.id);
    }
  }, [motion.plan, motion.canEdit, makeMissing]);

  return { urls, busy, make, makeMissing, upload };
}
