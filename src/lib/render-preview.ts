// A small copy of each finished export for playing it in the app (the
// ready page, the editor): 720p at a modest bitrate, about a quarter of the
// export's size, so it starts playing on a slow connection. Made by the
// render worker right after the export; Download always gives the export
// itself. Old exports have none: the app plays the export then.

/** The play copy's path, next to the export: `<name>.preview.mp4`. */
export const renderPreviewPath = (outputPath: string) =>
  outputPath.replace(/\.[^./]+$/, "") + ".preview.mp4";
