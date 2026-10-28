// Images (photos, screenshots) as timeline clips.
//
// An image has no length of its own, so its clip records IMAGE_MAX_MS as the
// "file" length and shows the first IMAGE_DEFAULT_MS of it (trim_out_ms).
// The usual trim handles then stretch it up to IMAGE_MAX_MS, with no extra
// database column. While on screen it slowly zooms in by IMAGE_ZOOM (a
// Ken Burns push-in), the same in the preview and both exports.

export const IMAGE_DEFAULT_MS = 3000;
export const IMAGE_MAX_MS = 60_000;
/** How far an image zooms in over its clip: 1 → 1 + IMAGE_ZOOM. */
export const IMAGE_ZOOM = 0.08;

/** Image types that browsers and the cloud export can both read. */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** Whether a clip's file is an image (clips don't store a type; the name does). */
export const isImageFilename = (filename: string) => IMAGE_EXT.test(filename);

/** Whether a picked or dropped file is an image the app can use. */
export const isImageFile = (f: File) =>
  IMAGE_MIME_TYPES.includes(f.type) || (!f.type && IMAGE_EXT.test(f.name));

/** iPhone photos (HEIC/HEIF) don't show in most browsers. */
export const isHeicFile = (f: File) =>
  /image\/hei[cf]/.test(f.type) || /\.(heic|heif)$/i.test(f.name);

/** Clip roles that are sound only: music and SFX (A2) and voiceovers (VO). */
export const AUDIO_ROLES = ["music", "sfx", "voiceover"] as const;
export const isAudioRole = (role: string | null | undefined) =>
  role === "music" || role === "sfx" || role === "voiceover";
