// Story pictures come from the AI as full-size PNGs of about 6 MB each,
// more than a whole short video. The export uses them as they are; the
// editor shows a small JPEG copy (about 1/20 the size) kept next to each one,
// so the preview and the side panel load quickly on a slow connection.
// Made when a picture is made (story-images.functions keepImage), and for
// older pictures the first time their links are asked for.

/** The preview copy's path, next to the picture: `<name>.preview.jpg`. */
export function previewPathOf(path: string): string {
  return `${path.replace(/\.[a-z0-9]+$/i, "")}.preview.jpg`;
}

/** A path that is itself a preview copy (never given a copy of its own). */
export const isPreviewPath = (path: string) => path.endsWith(".preview.jpg");

/** Clips and other non-picture files don't get a copy. */
export const hasPreview = (path: string) =>
  !isPreviewPath(path) && /\.(png|jpe?g|webp)$/i.test(path);
