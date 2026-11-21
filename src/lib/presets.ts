// Style presets: the names people see. The stored ids stay as they are so
// existing projects keep working ("gadzhi" is the Motion Explainer style).
// Projects made with the older preset ids are edited the Motion Explainer
// way, so they show that name ("cinematic" included: the Cinematic style is
// "film"). "minimal", "film", "saas", "paper", "docu", "cine3d", "bulletin", "impact", "noir", "monument", "talk", "notebook", "hud" and "studio" start their graphics in that look
// (src/motion/looks.ts defaultLook).

const PRESET_LABEL: Record<string, string> = {
  gadzhi: "Motion Explainer",
  hormozi: "Motion Explainer",
  cinematic: "Motion Explainer",
  podcast: "Motion Explainer",
  minimal: "Minimal",
  film: "Cinematic",
  saas: "SaaS",
  paper: "Paper",
  docu: "Documentary",
  cine3d: "3D Cinematic",
  bulletin: "Bulletin",
  impact: "Impact",
  noir: "Noir",
  monument: "Monument",
  talk: "Studio Talk",
  notebook: "Notebook",
  hud: "Spec HUD",
  studio: "Studio 3D",
};

/** The styles a new project can pick. */
export const NEW_PROJECT_STYLES = [
  { id: "gadzhi", label: "Motion Explainer — premium motion graphics" },
  { id: "minimal", label: "Minimal — black frames, thin lines, quiet type" },
  { id: "film", label: "Cinematic — film colour, grain, bars, slow push-ins" },
  { id: "saas", label: "SaaS — light pages, white cards, app screens" },
  { id: "paper", label: "Paper — paper prints on a desk, a pen reading along" },
  { id: "docu", label: "Documentary — drawn scenes, a light stage, one red accent" },
  { id: "cine3d", label: "3D Cinematic — 3D objects, red light, glowing words" },
  { id: "bulletin", label: "Bulletin — newsroom headline bars, stat boxes, red and navy" },
  { id: "impact", label: "Impact — huge stamped capitals, black and acid yellow" },
  { id: "noir", label: "Noir — black and white, typewriter type, one red word" },
  { id: "monument", label: "Monument — gold-and-ivory inscriptions, marble sculptures" },
  { id: "talk", label: "Studio Talk — warm podcast cards, pull quotes, amber" },
  { id: "notebook", label: "Notebook — grid paper, handwriting, marker and red pen" },
  { id: "hud", label: "Spec HUD — tech readout callouts, scan lines, lime on black" },
  { id: "studio", label: "Studio 3D — app screens in a light 3D studio, one blue" },
] as const;

/** The name shown for a preset id (the id itself if it's not a known one). */
export function presetLabel(id: string | null | undefined): string {
  if (!id) return "";
  return PRESET_LABEL[id] ?? id;
}
