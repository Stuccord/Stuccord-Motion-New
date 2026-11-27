// The voice's noise removal (render-worker/noise.js): the user's setting,
// saved per project, and the editor's preview of the cleaned voice: each
// recording's sound with the export's own cleanup, made by the render
// worker (/clean-voice) and saved next to the recording.

export const NOISE_MODES = ["auto", "off", "light", "strong"] as const;
export type NoiseMode = (typeof NOISE_MODES)[number];

export const NOISE_MODE_LABEL: Record<NoiseMode, string> = {
  auto: "Auto",
  off: "Off",
  light: "Light",
  strong: "Strong",
};

/** What each setting does, in a line. */
export const NOISE_MODE_HINT: Record<NoiseMode, string> = {
  auto: "Measures each recording and cleans it as much as its room needs",
  light: "Gentler: keeps more of the room, never touches the voice",
  strong: "Harder, for noisy places: the voice may sound a little thinner",
  off: "The voice as recorded (only the low rumble cut)",
};

export const noiseModeOf = (v: unknown): NoiseMode =>
  NOISE_MODES.includes(v as NoiseMode) ? (v as NoiseMode) : "auto";

/** The cleaned voice's path, next to the recording: `<path>.voice-<mode>.m4a`. */
export const cleanVoicePath = (path: string, mode: Exclude<NoiseMode, "off">) =>
  `${path}.voice-${mode}.m4a`;

/** A path that is a cleaned voice itself. */
export const isCleanVoice = (path: string) => /\.voice-(auto|light|strong)\.m4a$/.test(path);
