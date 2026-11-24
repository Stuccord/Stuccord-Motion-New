// Brings a story picture to life (server only: HF_API_KEY_ID / _SECRET).
// MiniMax H3 on Higgsfield takes the picture as the clip's first frame and
// makes 5 seconds of 2K video in the same shape; the looks play it in place
// of the still (src/motion/scene-media.tsx). Started and collected in two
// steps (story-clips.functions.ts), so no request stays open for minutes.

import {
  HiggsfieldError,
  OUT_OF_CREDIT,
  isOutOfCredit,
  fetchResult,
  generationStatus,
  submitGeneration,
  uploadToHiggsfield,
} from "@/lib/higgsfield.server";
import { SCENE_CLIP_MODEL } from "@/lib/motion-plan";

/** A problem the user can act on; its message is shown as is. */
export class ClipError extends Error {}

/** Longest a clip may take before it's given up (Higgsfield keeps going; it just isn't waited for). */
export const CLIP_TIMEOUT_MS = 12 * 60 * 1000;

/**
 * What the clip does: the scene as pictured, with gentle, natural motion
 * and a slow camera move, and nothing that would break the picture (cuts,
 * new people, words). The still stays the first frame.
 */
export function clipPrompt(scene: string): string {
  return [
    scene.trim(),
    "Bring this exact picture to life as one continuous cinematic shot: subtle, natural motion (people breathe, blink and move a little, hair and fabric shift, light and shadows drift), and a slow, smooth camera push-in.",
    "Keep the same people, faces, place, colours and lighting as the picture. No cuts, no new people or objects, no text, letters, logos or watermarks.",
  ].join(" ");
}

/** Starts a clip from a picture's bytes; returns Higgsfield's request id. */
export async function startClip(
  picture: { data: Uint8Array; mimeType: string },
  scene: string,
  aspect: string,
): Promise<string> {
  try {
    const imageUrl = await uploadToHiggsfield(picture);
    return await submitGeneration(SCENE_CLIP_MODEL, {
      prompt: clipPrompt(scene),
      image_url: imageUrl,
      duration: 5,
      resolution: "2K",
      aspect_ratio: ["9:16", "16:9", "1:1"].includes(aspect) ? aspect : "9:16",
    });
  } catch (e) {
    if (e instanceof HiggsfieldError) throw new ClipError(e.message);
    throw e;
  }
}

/**
 * Where a clip is: still being made, done (its MP4's bytes), or failed with
 * a message. A network blip while checking counts as still being made.
 */
export async function checkClip(requestId: string): Promise<
  | { state: "running" }
  | { state: "done"; video: Uint8Array }
  /** `retry`: worth starting the clip again (a failure on the AI service's side). */
  | { state: "failed"; error: string; retry: boolean }
> {
  let result;
  try {
    result = await generationStatus(requestId);
  } catch (e) {
    if (e instanceof HiggsfieldError && e.transient) return { state: "running" };
    if (e instanceof HiggsfieldError) return { state: "failed", error: e.message, retry: false };
    throw e;
  }
  if (result.status === "queued" || result.status === "in_progress") return { state: "running" };
  if (result.status !== "completed") {
    // Higgsfield's whole answer, so the server log says why (it isn't shown to the user).
    console.warn(
      `[story-clips] clip ${requestId} ended ${result.status}:`,
      JSON.stringify(result).slice(0, 600),
    );
  }
  if (result.status !== "completed" && isOutOfCredit(result)) {
    return { state: "failed", error: OUT_OF_CREDIT, retry: false };
  }
  if (result.status === "nsfw") {
    return {
      state: "failed",
      error: "The AI service turned this scene down for animation.",
      retry: false,
    };
  }
  if (result.status !== "completed") {
    return { state: "failed", error: "The AI service couldn't animate this picture.", retry: true };
  }
  const url = result.video?.url;
  if (!url) return { state: "failed", error: "The AI service didn't return a clip.", retry: true };
  let file;
  try {
    file = await fetchResult(url);
  } catch (e) {
    // The clip is made and kept for 7 days: a failed download is tried
    // again on the next check.
    if (e instanceof HiggsfieldError) return { state: "running" };
    throw e;
  }
  // An MP4 has "ftyp" at byte 4; anything else isn't a clip we can play.
  const head = String.fromCharCode(...file.data.slice(4, 8));
  if (head !== "ftyp")
    return { state: "failed", error: "The AI service returned a clip we can't use.", retry: true };
  return { state: "done", video: file.data };
}
