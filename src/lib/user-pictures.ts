// The creator's own pictures for a video (screenshots, photos), added on the
// New project page with an optional note each. Stored on the project
// (projects.user_pictures) and in its folder of motion-images; the graphics
// planner looks at them and shows each one where the speaker talks about it:
// a screenshot in an app screen, a photo as a story scene.

import { z } from "zod";

/** Most pictures one video takes (each is sent to the planner). */
export const MAX_USER_PICTURES = 8;
/** Longest note on one picture. */
export const MAX_PICTURE_NOTE = 200;
/** Longest side a picture is shrunk to before it's uploaded (sharp in a 4K frame, small for the planner). */
const MAX_SIDE = 2048;

/** Picture types the New project page takes (photos and screenshots; GIFs don't animate in a graphic). */
export const USER_PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const USER_PICTURE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export const UserPicture = z.object({
  /** In the project's folder of motion-images. */
  path: z.string().min(1).max(300),
  /** What the creator said about it ("" for none). */
  note: z.string().max(MAX_PICTURE_NOTE),
});
export type UserPicture = z.infer<typeof UserPicture>;

/** The project's pictures; [] when there are none (or the stored value doesn't parse). */
export function parseUserPictures(raw: unknown): UserPicture[] {
  const r = z.array(UserPicture).max(MAX_USER_PICTURES).safeParse(raw);
  return r.success ? r.data : [];
}

/** The picture's type by its file, or by its extension when the browser doesn't say; null when it isn't one we take. */
export function userPictureType(file: File): (typeof USER_PICTURE_TYPES)[number] | null {
  const t = file.type.toLowerCase();
  if ((USER_PICTURE_TYPES as readonly string[]).includes(t)) {
    return t as (typeof USER_PICTURE_TYPES)[number];
  }
  if (t) return null;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return null;
}

/**
 * The picture at most MAX_SIDE on its longest side, as a JPEG (a PNG stays a
 * PNG, so a screenshot's text stays crisp). A picture already small enough is
 * kept as it is. Browser only.
 */
export async function shrinkPicture(
  file: File,
): Promise<{ blob: Blob; type: (typeof USER_PICTURE_TYPES)[number] }> {
  const type = userPictureType(file) ?? "image/jpeg";
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 4 * 1024 * 1024) return { blob: file, type };
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, type };
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, out, 0.9));
    return blob ? { blob, type: out } : { blob: file, type };
  } finally {
    bitmap.close();
  }
}
