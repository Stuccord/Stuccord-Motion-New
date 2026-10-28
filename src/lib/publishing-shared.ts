// Publishing types and limits shared by the app's pages and its server.

export const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

export const TITLE_MAX = 100;
export const CAPTION_MAX = 5000;
/** A scheduled post has to be at least this far ahead… */
export const SCHEDULE_MIN_AHEAD_MS = 5 * 60 * 1000;
/** …and at most this far. */
export const SCHEDULE_MAX_AHEAD_DAYS = 60;
/** Posts a user can have waiting at once. */
export const SCHEDULED_LIMIT = 50;

export type PostStatus = "scheduled" | "uploading" | "published" | "failed" | "canceled";
export type Privacy = "public" | "unlisted" | "private";

export type SocialAccount = {
  id: string;
  platform: Platform;
  name: string;
  avatar_url: string | null;
  status: "active" | "needs_reconnect";
  created_at: string;
};

export type SocialPost = {
  id: string;
  project_id: string | null;
  project_title: string | null;
  account_id: string | null;
  platform: Platform;
  account_name: string;
  title: string;
  caption: string;
  privacy: Privacy;
  scheduled_at: string;
  status: PostStatus;
  error: string | null;
  external_url: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  stats_updated_at: string | null;
};
