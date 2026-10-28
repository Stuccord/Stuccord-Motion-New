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

// ---------- TikTok ----------

export const TIKTOK_CAPTION_MAX = 2200;

export type TikTokPrivacy =
  "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export const TIKTOK_PRIVACY_LABEL: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

/**
 * How a TikTok post goes out: straight to the profile ("direct"), with the
 * choices TikTok asks the poster to make, or to their TikTok drafts ("draft"),
 * where they finish it in the app.
 */
export type TikTokOptions =
  | {
      mode: "direct";
      privacy_level: TikTokPrivacy;
      allow_comment: boolean;
      allow_duet: boolean;
      allow_stitch: boolean;
      /** Promotes the poster's own business ("Promotional content"). */
      brand_organic: boolean;
      /** Paid partnership with another brand ("Paid partnership"). */
      brand_content: boolean;
    }
  | { mode: "draft" };

/** What TikTok says this account can post right now. */
export type TikTokCreatorInfo = {
  nickname: string;
  username: string;
  avatar_url: string | null;
  privacy_level_options: TikTokPrivacy[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number | null;
};

// ---------- Instagram ----------

export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_HASHTAG_MAX = 30;
/** Reels can be 3 seconds to 15 minutes; Stories up to 60 seconds. */
export const REEL_MIN_SECONDS = 3;
export const REEL_MAX_SECONDS = 15 * 60;
export const STORY_MAX_SECONDS = 60;

/** A Reel (optionally also in the feed and profile grid), or a Story. */
export type InstagramOptions = { kind: "reel"; share_to_feed: boolean } | { kind: "story" };

export const countHashtags = (s: string) => (s.match(/(^|\s)#[^\s#]+/g) ?? []).length;

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
  /** Platform choices: TikTokOptions, InstagramOptions, or {} for YouTube. */
  options: TikTokOptions | InstagramOptions | Record<string, never>;
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
