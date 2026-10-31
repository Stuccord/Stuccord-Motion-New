import {
  Zap, Radio, Rocket, PlayCircle, Mic, Camera, Sparkles, MessageCircle,
  BookOpen, Newspaper, ShoppingBag, GraduationCap, Type, Film,
} from "lucide-react";

export type TemplateDef = {
  id: string;
  cat: string;
  title: string;
  desc: string;
  icon: typeof Zap;
  gradient: string;
  ratio: "9:16" | "16:9" | "1:1";
  duration: string;
  preset: string;
  brief: string;
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "hook", cat: "Hooks", title: "3-second hook",
    desc: "Vertical short that opens with a punchy AI-written hook.",
    icon: Zap, gradient: "from-violet-500 via-purple-500 to-fuchsia-500",
    ratio: "9:16", duration: "0:15", preset: "hormozi",
    brief: "Open with a pattern interrupt in the first 0.5s. Burn a punchy 3-5 word hook caption top-center in bold sans-serif with a black outline. Fast jump cuts, no dead air. Keep the whole clip under 15 seconds.",
  },
  {
    id: "talking", cat: "Talking head", title: "Talking head + b-roll",
    desc: "Talk to camera on V1, add B-roll on top, captions from your words.",
    icon: Radio, gradient: "from-blue-500 to-cyan-500",
    ratio: "9:16", duration: "0:45", preset: "gadzhi",
    brief: "Cut aggressively on filler words and silences. Zoom in slightly on every new idea. Overlay word-by-word captions with yellow keyword highlights.",
  },
  {
    id: "product", cat: "Product", title: "Product demo",
    desc: "Landscape walkthrough of your product, with captions and music.",
    icon: Rocket, gradient: "from-emerald-500 to-teal-500",
    ratio: "16:9", duration: "1:30", preset: "cinematic",
    brief: "Smooth cursor tracking, soft zoom-ins on UI elements being demoed. Add subtle callout arrows and highlights. Ambient underscore, no vocal.",
  },
  {
    id: "podcast", cat: "Podcast", title: "Podcast clip",
    desc: "Square clip from a podcast or interview, captioned.",
    icon: Mic, gradient: "from-orange-500 to-rose-500",
    ratio: "1:1", duration: "0:60", preset: "podcast",
    brief: "Two-camera bounces on speaker change. Animated waveform bottom third. Large legible captions with speaker labels.",
  },
  {
    id: "vlog", cat: "Lifestyle", title: "Cinematic vlog",
    desc: "Landscape vlog with music under your footage.",
    icon: Camera, gradient: "from-pink-500 to-rose-500",
    ratio: "16:9", duration: "2:00", preset: "cinematic",
    brief: "Filmic color grade — teal shadows, warm highlights. Slow-motion b-roll on emotional beats. Ambient score at -18 LUFS.",
  },
  {
    id: "quote", cat: "Inspiration", title: "Quote reel",
    desc: "Vertical quote or motivation reel over B-roll and music.",
    icon: Sparkles, gradient: "from-amber-500 to-orange-500",
    ratio: "9:16", duration: "0:20", preset: "cinematic",
    brief: "Word-by-word typographic reveal centered on screen. Blurred slow-motion b-roll behind. Ambient piano.",
  },
  {
    id: "minimal", cat: "Education", title: "Minimal explainer",
    desc: "Clean type and thin lines over your talk, with calm cuts.",
    icon: Type, gradient: "from-neutral-500 to-neutral-800",
    ratio: "9:16", duration: "0:60", preset: "minimal",
    brief: "Calm and clear. Few graphics, each with lots of space: one key line, a number or a short list at a time. No hype.",
  },
  {
    id: "film", cat: "Storytime", title: "Cinematic story",
    desc: "Your story with film colour, grain, black bars and slow push-ins.",
    icon: Film, gradient: "from-amber-600 to-teal-800",
    ratio: "9:16", duration: "1:00", preset: "film",
    brief: "Tell it like a short film. Few graphics, each given room to breathe: chapter titles between parts, a story scene for each turn. Calm and serious.",
  },
  {
    id: "story", cat: "Storytime", title: "Storytime narration",
    desc: "A story told to camera, with word-by-word captions.",
    icon: MessageCircle, gradient: "from-indigo-500 to-violet-500",
    ratio: "9:16", duration: "0:60", preset: "gadzhi",
    brief: "VO-driven. Cut on story beats. Word-highlight captions synced to speech. Subtle background music, ducked under narration.",
  },
  {
    id: "explainer", cat: "Education", title: "Explainer breakdown",
    desc: "Landscape explainer with captions and B-roll.",
    icon: BookOpen, gradient: "from-sky-500 to-blue-600",
    ratio: "16:9", duration: "1:15", preset: "gadzhi",
    brief: "Numbered chapters with big title cards. Motion callouts and arrows over b-roll. Clear voice-forward mix.",
  },
  {
    id: "news", cat: "News", title: "News drop",
    desc: "Vertical update that opens with a strong hook.",
    icon: Newspaper, gradient: "from-red-500 to-rose-600",
    ratio: "9:16", duration: "0:30", preset: "hormozi",
    brief: "Breaking-news energy. Bottom ticker with source citations. Punchy lower-thirds. Urgent underscore.",
  },
  {
    id: "unbox", cat: "Product", title: "Unboxing edit",
    desc: "Vertical unboxing with music and B-roll cutaways.",
    icon: ShoppingBag, gradient: "from-fuchsia-500 to-purple-600",
    ratio: "9:16", duration: "0:45", preset: "cinematic",
    brief: "Beat-synced cuts on music drop. Hero reveal shot slowed down. Product name burned in on reveal frame.",
  },
  {
    id: "lesson", cat: "Education", title: "Micro-lesson",
    desc: "Square micro-lesson with captions.",
    icon: GraduationCap, gradient: "from-teal-500 to-emerald-600",
    ratio: "1:1", duration: "0:60", preset: "gadzhi",
    brief: "Three-tip format. Progress dots top-right (1/3, 2/3, 3/3). Big number cards between tips.",
  },
  {
    id: "trailer", cat: "Hooks", title: "Announcement trailer",
    desc: "Landscape announcement with music and a bold opening hook.",
    icon: PlayCircle, gradient: "from-neutral-800 to-neutral-950",
    ratio: "16:9", duration: "0:30", preset: "cinematic",
    brief: "Big kinetic type reveal. Drop-in sound design on each cut. Dark cinematic grade. End card with date and CTA.",
  },
];

export const TEMPLATE_CATS = [
  "All", "Hooks", "Talking head", "Product", "Podcast",
  "Lifestyle", "Education", "Storytime", "News", "Inspiration",
];
