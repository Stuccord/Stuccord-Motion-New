// AI music (ElevenLabs Music): each video gets its own instrumental track,
// matched to its look and length, made by the render worker (it holds the
// key). Shared by the server functions (music.functions.ts) and the pages.

import { MOTION_LOOK_IDS, type MotionLookId } from "@/motion/looks";

/** Tracks one person can make a month in the free beta (the owner: unlimited). */
export const AI_MUSIC_MONTHLY_TRACKS = 3;
/** Shortest and longest track made (the worker allows the same). */
export const AI_MUSIC_MIN_MS = 10_000;
export const AI_MUSIC_MAX_MS = 300_000;

/**
 * Each look's music: genre, instruments, tempo and feel. Instrumental only,
 * and always "under a voice", so it supports the speaker instead of
 * competing with them.
 */
const LOOK_MUSIC: Record<MotionLookId, string> = {
  glass:
    "Modern cinematic electronic underscore for a premium explainer video: warm synth pads, soft pulsing bass, light percussion, steady 100 BPM, confident and inspiring",
  paper:
    "Warm, playful acoustic storytelling music: plucked acoustic guitar, soft piano, light glockenspiel and gentle hand percussion, 95 BPM, curious and friendly",
  minimal:
    "Minimal, calm ambient piano: sparse felt piano notes, soft sustained strings, lots of space, slow 70 BPM, thoughtful and clear",
  film:
    "Cinematic indie film score: gentle piano, warm strings, soft guitar, slowly building, 85 BPM, nostalgic and hopeful",
  saas:
    "Bright, upbeat modern tech product launch music: clean electronic beat, plucky synths, light claps, 115 BPM, optimistic and fresh",
  docu:
    "Documentary underscore: soft piano ostinato, low strings, subtle ticking percussion, 90 BPM, curious, serious and steady",
  cine3d:
    "Dark cinematic trailer underscore: deep pulsing bass, low brass swells, tense strings, sparse heavy hits, 90 BPM, powerful and dramatic",
  bulletin:
    "News broadcast underscore: urgent ticking percussion, staccato strings, deep synth bass, 120 BPM, focused and serious",
  impact:
    "Hard-hitting energetic trap beat: punchy 808 bass, crisp hi-hats, bold synth stabs, 140 BPM half-time, aggressive and exciting",
  noir:
    "Dark film noir jazz: brushed drums, upright bass, smoky muted trumpet and moody piano, slow 75 BPM, mysterious and melancholic",
  monument:
    "Epic, solemn orchestral music: slow rising strings, soft choir pads, deep low brass, gentle timpani, 70 BPM, inspiring and timeless",
  talk:
    "Warm lo-fi podcast background music: mellow Rhodes piano, soft vinyl crackle, laid-back hip-hop drums, 85 BPM, relaxed and cozy",
  notebook:
    "Light, friendly educational music: bouncy pizzicato strings, marimba, soft claps, 105 BPM, cheerful and focused",
  hud:
    "Sleek tech product review music: crisp electronic beat, glitchy synth arpeggios, deep sub bass, 110 BPM, precise and modern",
  studio:
    "Clean, modern product demo music: soft electronic beat, airy synth pads, gentle plucks, 105 BPM, polished, calm and confident",
};

/** The description sent to the music model for a video in this look. */
export function musicPrompt(look: string | null | undefined): string {
  const id = (MOTION_LOOK_IDS as readonly string[]).includes(look ?? "")
    ? (look as MotionLookId)
    : "glass";
  return `${LOOK_MUSIC[id]}. Instrumental background music that sits under a speaking voice: no vocals, no lead melody that competes with speech, consistent energy, clean ending.`;
}

/** The length to make for a video of `videoMs` (a little longer, within limits). */
export function musicLengthMs(videoMs: number): number {
  const ms = Math.round(videoMs + 1500);
  return Math.min(AI_MUSIC_MAX_MS, Math.max(AI_MUSIC_MIN_MS, ms));
}
