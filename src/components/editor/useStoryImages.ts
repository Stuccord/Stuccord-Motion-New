// Story scenes' pictures in the editor: links to show them, and making,
// remaking and uploading them. Pictures are made one at a time, the story's
// first one first, so later scenes can match it (story-images.functions).
// Right after the AI plans a story, its pictures are made automatically.
// Stage 8: the speaker's cartoon (made here from a photo, with consent);
// scenes with the speaker and cartoon graphics wait for it, then get made.
// Stage 9b: card streams' and profiles' pictures: the user's uploads, or
// frames of their footage (filled in automatically when the AI plans one).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  SCENE_BUCKET,
  SCENE_TYPES,
  PROFILE_GRID,
  maxScenes,
  type MotionElement,
  type MotionPlan,
  type MotionScene,
  type SceneImage,
} from "@/lib/motion-plan";
import type { SpeakerFrame } from "@/lib/speaker-frames";
import {
  makeSceneImage,
  makeSpeakerCartoon,
  sceneUploadSlot,
  signSceneImages,
} from "@/lib/story-images.functions";
import type { MotionPlanState } from "@/lib/motion-plan.functions";

/** Uploaded pictures: these types, up to the bucket's 10 MB. */
export const SCENE_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const SCENE_UPLOAD_MAX = 10 * 1024 * 1024;

type Motion = {
  plan: MotionPlan | null;
  state: MotionPlanState | undefined;
  canEdit: boolean;
  update: (change: (p: MotionPlan) => MotionPlan) => void;
};

/** Frames of the user's footage, for pictures they haven't uploaded. */
export type FootageFrames = {
  /** Frames spread over the footage, as JPEG photos (null: couldn't read it). */
  frames: (count: number) => Promise<Blob[] | null>;
  /** Clear frames of the speaker, best first. */
  speaker: () => Promise<SpeakerFrame[] | null>;
};

/** A picture with no words or description: a card stream's or profile's. */
const pictureScene = (el: MotionElement, image: SceneImage | null): MotionScene => ({
  at: el.start,
  text: "",
  emphasis: null,
  prompt: "",
  image,
});

/** The speaker is in this scene's picture (always, in a cartoon graphic). */
const withSpeaker = (el: MotionElement, index: number) =>
  el.type === "cartoon" || el.scenes?.[index]?.speaker === true;

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

export function useStoryImages(
  projectId: string,
  motion: Motion,
  accent: string | null,
  footage: FootageFrames,
) {
  const qc = useQueryClient();
  const makeFn = useServerFn(makeSceneImage);
  const slotFn = useServerFn(sceneUploadSlot);
  const signFn = useServerFn(signSceneImages);
  const cartoonFn = useServerFn(makeSpeakerCartoon);
  const character = motion.state?.character ?? null;

  // Links for every picture in the plan and the speaker's cartoon
  // (refreshed before they run out).
  const paths = useMemo(
    () =>
      [
        ...new Set(
          [
            ...(motion.plan?.elements ?? [])
              .flatMap((e) => e.scenes ?? [])
              .map((sc) => sc.image?.path),
            character?.image,
          ].filter((x): x is string => !!x),
        ),
      ].sort(),
    [motion.plan, character?.image],
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
  const hasCartoon = !!character;
  const latestHasCartoon = useRef(hasCartoon);
  latestHasCartoon.current = hasCartoon;

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
      const speaker = withSpeaker(el, index);
      if (speaker && !latestHasCartoon.current) {
        toast.error("Make the speaker's cartoon first (Cartoon of the speaker).");
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
            reference_path: el.type === "story" && index > 0 ? first : null,
            accent,
            style: el.type === "cartoon" ? "cartoon" : "cinematic",
            with_speaker: speaker,
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

  /**
   * Makes every scene of a story still without a picture, first scene first
   * (and a cartoon's one). Scenes with the speaker wait for their cartoon.
   */
  const makeMissing = useCallback(
    async (elementId: string) => {
      const el = latestPlan.current?.elements.find((e) => e.id === elementId);
      const scenes = el?.scenes ?? [];
      let first = scenes[0]?.image?.path ?? null;
      for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].image) continue;
        if (el && withSpeaker(el, i) && !latestHasCartoon.current) {
          // Later scenes can't match a first picture that isn't made yet.
          if (i === 0) break;
          continue;
        }
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

  // Right after the AI plans a story or cartoon: make its pictures (once per
  // plan, and again once the speaker's cartoon is there for the ones that
  // waited for it).
  const started = useRef(new Set<string>());
  useEffect(() => {
    const plan = motion.plan;
    if (!plan || !motion.canEdit) return;
    for (const el of plan.elements) {
      if (!SCENE_TYPES.has(el.type) || el.source !== "ai") continue;
      const waiting = (el.scenes ?? []).some((sc, i) => !sc.image && withSpeaker(el, i));
      const key = `${plan.created_at}:${el.id}:${waiting ? (character?.image ?? "-") : ""}`;
      if (started.current.has(key)) continue;
      const ready = (el.scenes ?? []).some(
        (sc, i) => !sc.image && (hasCartoon || !withSpeaker(el, i)),
      );
      if (!ready) continue;
      started.current.add(key);
      void makeMissing(el.id);
    }
  }, [motion.plan, motion.canEdit, makeMissing, hasCartoon, character?.image]);

  // ---------- the speaker's cartoon ----------

  const [cartoonBusy, setCartoonBusy] = useState(false);

  /** Puts a picture in the project's folder; returns its path. */
  const store = useCallback(
    async (file: Blob, type: (typeof SCENE_UPLOAD_TYPES)[number]) => {
      const slot = await slotFn({ data: { project_id: projectId, content_type: type } });
      const { error } = await supabase.storage
        .from(SCENE_BUCKET)
        .uploadToSignedUrl(slot.path, slot.token, file, { contentType: type });
      if (error) throw new Error(error.message);
      return slot.path;
    },
    [projectId, slotFn],
  );

  /**
   * Makes the speaker's cartoon from a photo of them (a frame of the footage
   * or the user's own), after the user has confirmed consent.
   */
  const makeCartoon = useCallback(
    async (photo: Blob, from: "footage" | "upload"): Promise<boolean> => {
      const type = photo.type as (typeof SCENE_UPLOAD_TYPES)[number];
      if (!SCENE_UPLOAD_TYPES.includes(type)) {
        toast.error("Use a JPG, PNG or WebP photo.");
        return false;
      }
      if (photo.size > SCENE_UPLOAD_MAX) {
        toast.error("That photo is over 10 MB.");
        return false;
      }
      setCartoonBusy(true);
      try {
        const photoPath = await store(photo, type);
        const r = await cartoonFn({
          data: { project_id: projectId, photo_path: photoPath, from, consent: true },
        });
        if (r.url) setFresh((f) => ({ ...f, [r.character.image]: r.url as string }));
        qc.setQueryData<MotionPlanState>(["motion-plan", projectId], (old) =>
          old ? { ...old, images: r.images, character: r.character } : old,
        );
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't make the cartoon");
        return false;
      } finally {
        setCartoonBusy(false);
      }
    },
    [cartoonFn, projectId, qc, store],
  );

  // ---------- card streams' and profiles' pictures ----------

  /** Stores pictures and adds them to a card stream (up to its limit). */
  const addPictures = useCallback(
    async (elementId: string, files: Blob[], source: "upload" | "footage") => {
      const el = latestPlan.current?.elements.find((e) => e.id === elementId);
      if (!el) return;
      const room = maxScenes(el.type) - (el.scenes?.length ?? 0);
      const ok = files.filter(
        (f) =>
          SCENE_UPLOAD_TYPES.includes(f.type as (typeof SCENE_UPLOAD_TYPES)[number]) &&
          f.size <= SCENE_UPLOAD_MAX,
      );
      if (ok.length < files.length)
        toast.error("Some pictures were skipped (JPG, PNG or WebP, up to 10 MB).");
      if (room <= 0) {
        toast.error(`A card stream holds up to ${maxScenes(el.type)} pictures.`);
        return;
      }
      const key = `${elementId}:pics`;
      mark(key, true);
      try {
        const images: SceneImage[] = [];
        for (const f of ok.slice(0, room)) {
          const path = await store(f, f.type as (typeof SCENE_UPLOAD_TYPES)[number]);
          setFresh((m) => ({ ...m, [path]: URL.createObjectURL(f) }));
          images.push({ path, source });
        }
        motion.update((p) => ({
          ...p,
          elements: p.elements.map((e) =>
            e.id === elementId
              ? {
                  ...e,
                  scenes: [...(e.scenes ?? []), ...images.map((im) => pictureScene(e, im))].slice(
                    0,
                    maxScenes(e.type),
                  ),
                }
              : e,
          ),
        }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add the pictures");
      } finally {
        mark(key, false);
      }
    },
    [motion, store],
  );

  /** Puts one picture in a slot (a profile's photo is slot 0, its grid 1-6); null clears it. */
  const setPicture = useCallback(
    async (elementId: string, index: number, file: Blob | null, source: "upload" | "footage") => {
      const el = latestPlan.current?.elements.find((e) => e.id === elementId);
      if (!el || index >= maxScenes(el.type)) return;
      let image: SceneImage | null = null;
      const key = `${elementId}:${index}`;
      mark(key, true);
      try {
        if (file) {
          const type = file.type as (typeof SCENE_UPLOAD_TYPES)[number];
          if (!SCENE_UPLOAD_TYPES.includes(type) || file.size > SCENE_UPLOAD_MAX) {
            toast.error("Use a JPG, PNG or WebP picture up to 10 MB.");
            return;
          }
          const path = await store(file, type);
          setFresh((m) => ({ ...m, [path]: URL.createObjectURL(file) }));
          image = { path, source };
        }
        motion.update((p) => ({
          ...p,
          elements: p.elements.map((e) => {
            if (e.id !== elementId) return e;
            const scenes = [...(e.scenes ?? [])];
            while (scenes.length <= index) scenes.push(pictureScene(e, null));
            scenes[index] = pictureScene(e, image);
            return { ...e, scenes };
          }),
        }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add the picture");
      } finally {
        mark(key, false);
      }
    },
    [motion, store],
  );

  /** Takes a picture out of a card stream. */
  const removePicture = useCallback(
    (elementId: string, index: number) =>
      motion.update((p) => ({
        ...p,
        elements: p.elements.map((e) =>
          e.id === elementId ? { ...e, scenes: (e.scenes ?? []).filter((_, i) => i !== index) } : e,
        ),
      })),
    [motion],
  );

  /**
   * Fills a card stream with 8 frames of the footage, or a profile's photo
   * with a clear frame of the speaker and its grid with frames.
   */
  const fillFromFootage = useCallback(
    async (elementId: string) => {
      const el = latestPlan.current?.elements.find((e) => e.id === elementId);
      if (!el) return;
      const key = `${elementId}:pics`;
      mark(key, true);
      try {
        if (el.type === "profile") {
          const [best, frames] = await Promise.all([
            footage.speaker(),
            footage.frames(PROFILE_GRID),
          ]);
          if (!frames) throw new Error("Couldn't read the video here.");
          if (best?.[0]) await setPicture(elementId, 0, best[0].photo, "footage");
          for (let i = 0; i < Math.min(PROFILE_GRID, frames.length); i++) {
            await setPicture(elementId, i + 1, frames[i], "footage");
          }
        } else {
          const frames = await footage.frames(8);
          if (!frames) throw new Error("Couldn't read the video here.");
          await addPictures(elementId, frames, "footage");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't use frames of the video");
      } finally {
        mark(key, false);
      }
    },
    [addPictures, footage, setPicture],
  );

  // Right after the AI plans a card stream or profile: fill it from the
  // footage (once per plan); the user can swap in their own pictures.
  const filled = useRef(new Set<string>());
  useEffect(() => {
    const plan = motion.plan;
    if (!plan || !motion.canEdit) return;
    for (const el of plan.elements) {
      if ((el.type !== "stream" && el.type !== "profile") || el.source !== "ai") continue;
      if ((el.scenes ?? []).some((sc) => sc.image)) continue;
      const key = `${plan.created_at}:${el.id}`;
      if (filled.current.has(key)) continue;
      filled.current.add(key);
      void fillFromFootage(el.id);
    }
  }, [motion.plan, motion.canEdit, fillFromFootage]);

  return {
    urls,
    busy,
    make,
    makeMissing,
    upload,
    addPictures,
    setPicture,
    removePicture,
    fillFromFootage,
    hasCartoon,
    cartoon: {
      character,
      url: character ? urls[character.image] : undefined,
      busy: cartoonBusy,
      make: makeCartoon,
    },
  };
}
