// Small preview copies of uploaded videos (render-worker/server.js /preview):
// the editor's preview plays the copy, a fraction of the size, so it loads
// quickly on a slow connection; exports and everything else use the
// original. The copy sits next to the original in raw-clips.

/** The preview copy's path, next to the original: `<path>.preview.mp4`. */
export const footagePreviewPath = (path: string) => `${path}.preview.mp4`;

/** A path that is a preview copy itself (never given one of its own). */
export const isFootagePreview = (path: string) => path.endsWith(".preview.mp4");

/** A video file the preview plays (pictures and sound don't get a copy). */
export const wantsFootagePreview = (path: string) =>
  !isFootagePreview(path) && /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(path);

/** A link that points at a preview copy (its address keeps the file's name). */
export const isFootagePreviewUrl = (url: string | undefined) =>
  !!url && /\.preview\.mp4(?:[?#]|$)/.test(url);
