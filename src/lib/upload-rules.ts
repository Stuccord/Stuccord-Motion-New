// What can be uploaded: the editor's uploader (uploads/presign) and the API
// (/api/v1) accept the same files.

import { IMAGE_MIME_TYPES } from "@/lib/media-kind";

/**
 * Largest upload, in MB. Supabase's Free plan stores files of up to 50 MB;
 * on Pro (up to 500 GB, set in the Supabase dashboard's storage settings)
 * raise it with VITE_MAX_UPLOAD_MB (read when the app is built).
 */
export const MAX_UPLOAD_MB = Math.max(
  1,
  Math.min(5000, Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 50),
);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  // Audio for the music / SFX tracks. Browsers report several names for the
  // same formats (e.g. MP3 as audio/mpeg or audio/mp3, WAV as audio/wav,
  // audio/x-wav or audio/wave), so accept each of them.
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  // Images (photos, screenshots) for the video tracks.
  ...IMAGE_MIME_TYPES,
]);

export const UPLOAD_TYPES_MESSAGE =
  "Upload MP4, MOV or WebM video, MP3, WAV, M4A, AAC or OGG audio, or JPG, PNG, WebP or GIF images.";
