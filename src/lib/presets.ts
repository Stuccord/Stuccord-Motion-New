// Style presets: the names people see. The stored ids stay as they are so
// existing projects keep working ("gadzhi" is the Motion Explainer style).

const PRESET_LABEL: Record<string, string> = {
  gadzhi: "Motion Explainer",
  hormozi: "Hormozi — pattern-interrupt",
  cinematic: "Cinematic — slow & moody",
  podcast: "Podcast clip",
};

/** The name shown for a preset id (the id itself if it's not a known one). */
export function presetLabel(id: string | null | undefined): string {
  if (!id) return "";
  return PRESET_LABEL[id] ?? id;
}
