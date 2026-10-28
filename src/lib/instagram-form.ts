// The Instagram choices in the Publish dialog (src/components/publish-instagram.tsx).

import {
  INSTAGRAM_HASHTAG_MAX,
  REEL_MAX_SECONDS,
  REEL_MIN_SECONDS,
  STORY_MAX_SECONDS,
  countHashtags,
  type InstagramOptions,
} from "@/lib/publishing-shared";

export const NEW_INSTAGRAM_FORM: InstagramOptions = { kind: "reel", share_to_feed: true };

/** Why this Instagram post can't go yet, or null when it can. */
export function instagramFormProblem(
  form: InstagramOptions,
  caption: string,
  videoSeconds: number | null,
): string | null {
  if (form.kind === "story") {
    if (videoSeconds != null && videoSeconds > STORY_MAX_SECONDS) {
      return `Stories can be up to ${STORY_MAX_SECONDS} seconds; this video is ${Math.round(videoSeconds)}`;
    }
    return null;
  }
  if (videoSeconds != null && videoSeconds < REEL_MIN_SECONDS) {
    return `Reels have to be at least ${REEL_MIN_SECONDS} seconds`;
  }
  if (videoSeconds != null && videoSeconds > REEL_MAX_SECONDS) {
    return `Reels can be up to ${REEL_MAX_SECONDS / 60} minutes`;
  }
  if (countHashtags(caption) > INSTAGRAM_HASHTAG_MAX) {
    return `Instagram allows up to ${INSTAGRAM_HASHTAG_MAX} hashtags`;
  }
  return null;
}
