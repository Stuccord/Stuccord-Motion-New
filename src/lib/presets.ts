// Style presets: the names people see. The stored ids stay as they are so
// existing projects keep working ("gadzhi" is the Motion Explainer style).
// Projects made with the older preset ids are edited the Motion Explainer
// way, so they show that name. "minimal" starts its graphics in the Minimal
// look (src/motion/looks.ts defaultLook).

const PRESET_LABEL: Record<string, string> = {
  gadzhi: "Motion Explainer",
  hormozi: "Motion Explainer",
  cinematic: "Motion Explainer",
  podcast: "Motion Explainer",
  minimal: "Minimal",
};

/** The styles a new project can pick. */
export const NEW_PROJECT_STYLES = [
  { id: "gadzhi", label: "Motion Explainer — premium motion graphics" },
  { id: "minimal", label: "Minimal — clean type, thin lines, calm cuts" },
] as const;

/** The name shown for a preset id (the id itself if it's not a known one). */
export function presetLabel(id: string | null | undefined): string {
  if (!id) return "";
  return PRESET_LABEL[id] ?? id;
}
