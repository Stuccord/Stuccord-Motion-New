// The TikTok choices in the Publish dialog (src/components/publish-tiktok.tsx):
// the form, whether it's ready to post, and the options it sends.

import type { TikTokCreatorInfo, TikTokOptions, TikTokPrivacy } from "@/lib/publishing-shared";

export type TikTokForm = {
  mode: "direct" | "draft";
  privacy: TikTokPrivacy | "";
  allow_comment: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  /** "Disclose video content" is on. */
  disclose: boolean;
  brand_organic: boolean;
  brand_content: boolean;
};

export const NEW_TIKTOK_FORM: TikTokForm = {
  mode: "direct",
  privacy: "",
  allow_comment: false,
  allow_duet: false,
  allow_stitch: false,
  disclose: false,
  brand_organic: false,
  brand_content: false,
};

/** Why this TikTok post can't go yet, or null when it can. */
export function tiktokFormProblem(
  form: TikTokForm,
  info: TikTokCreatorInfo | undefined,
  videoSeconds: number | null,
): string | null {
  if (form.mode === "draft") return null;
  if (!info) return "Checking the account…";
  if (
    videoSeconds != null &&
    info.max_video_post_duration_sec != null &&
    videoSeconds > info.max_video_post_duration_sec
  ) {
    return `This account can post videos up to ${info.max_video_post_duration_sec} seconds`;
  }
  if (!form.privacy) return "Choose who can see it";
  if (form.disclose && !form.brand_organic && !form.brand_content) {
    return "Say whether it promotes your brand, another brand, or both";
  }
  if (form.brand_content && form.privacy === "SELF_ONLY") {
    return "Branded content can't be set to Only me";
  }
  return null;
}

/** The options to send for this form. */
export function tiktokOptions(form: TikTokForm): TikTokOptions {
  if (form.mode === "draft") return { mode: "draft" };
  return {
    mode: "direct",
    privacy_level: form.privacy as TikTokPrivacy,
    allow_comment: form.allow_comment,
    allow_duet: form.allow_duet,
    allow_stitch: form.allow_stitch,
    brand_organic: form.disclose && form.brand_organic,
    brand_content: form.disclose && form.brand_content,
  };
}
