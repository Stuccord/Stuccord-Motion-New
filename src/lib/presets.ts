// Style presets: the names people see. The stored ids stay as they are so
// existing projects keep working ("gadzhi" is the Motion Explainer style).
// Motion Explainer is the one style today; projects made with the older
// preset ids are edited the same way, so they show the same name.

const PRESET_LABEL: Record<string, string> = {
  gadzhi: "Motion Explainer",
  hormozi: "Motion Explainer",
  cinematic: "Motion Explainer",
  podcast: "Motion Explainer",
};

/** The name shown for a preset id (the id itself if it's not a known one). */
export function presetLabel(id: string | null | undefined): string {
  if (!id) return "";
  return PRESET_LABEL[id] ?? id;
}
