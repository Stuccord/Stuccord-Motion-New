// The voice's noise removal (render-worker/noise.js): the user's setting,
// saved per project, and the editor's preview of the cleaned voice: each
// recording's sound with the export's own cleanup, made by the render
// worker (/clean-voice) and saved next to the recording.

export const NOISE_MODES = ["auto", "off", "light", "strong", "studio"] as const;
export type NoiseMode = (typeof NOISE_MODES)[number];

export const NOISE_MODE_LABEL: Record<NoiseMode, string> = {
  auto: "Auto",
  off: "Off",
  light: "Light",
  strong: "Strong",
  studio: "Studio",
};

/** What each setting does, in a line. */
export const NOISE_MODE_HINT: Record<NoiseMode, string> = {
  auto: "Measures each recording and cleans it as much as its room needs",
  light: "Gentler: keeps more of the room, never touches the voice",
  strong: "Harder, for noisy places: the voice may sound a little thinner",
  off: "The voice as recorded (only the low rumble cut)",
  studio:
    "AI voice isolation: takes out noise even under your words (street, wind, music). Uses your monthly Studio minutes",
};

/**
 * Studio voice (AI voice isolation) a person can use a month in the free
 * beta, in seconds of recording (the app's owner: no limit). Each recording
 * is isolated once and reused, so it counts once. 2026-11-27: 10 minutes,
 * at most $1.20 a person a month at $0.12 a minute.
 */
export const STUDIO_VOICE_MONTHLY_SECONDS = 10 * 60;

/** A recording's isolated voice (the AI's answer, kept and reused): `<path>.isolated.mp3`. */
export const isolatedVoicePath = (path: string) => `${path}.isolated.mp3`;

export const noiseModeOf = (v: unknown): NoiseMode =>
  NOISE_MODES.includes(v as NoiseMode) ? (v as NoiseMode) : "auto";

/** The cleaned voice's path, next to the recording: `<path>.voice-<mode>.m4a`. */
export const cleanVoicePath = (path: string, mode: Exclude<NoiseMode, "off">) =>
  `${path}.voice-${mode}.m4a`;

/** A path that is a cleaned voice itself. */
export const isCleanVoice = (path: string) =>
  /\.voice-(auto|light|strong|studio)\.m4a$/.test(path) || path.endsWith(".isolated.mp3");
