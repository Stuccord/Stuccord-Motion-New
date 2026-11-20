import {
  Zap, Radio, Rocket, PlayCircle, Mic, Camera, Sparkles, MessageCircle,
  BookOpen, Newspaper, ShoppingBag, GraduationCap, Type, Film,
} from "lucide-react";

// Each template starts a project with a shape, one of the app's real looks
// (NEW_PROJECT_STYLES in presets.ts) and a brief. The brief goes to Claude,
// which plans the graphics (src/lib/motion-plan.server.ts) and writes the
// opening hook (render-worker/ai.js), so it only asks for what those can do:
// the planner's graphic types, zooms, graphics behind the speaker, AI story
// pictures and the speaker's cartoon. Captions, music and cuts are set in the
// editor, not by the brief. `duration` is a suggested length, not enforced.

export type TemplateDef = {
  id: string;
  cat: string;
  title: string;
  desc: string;
  icon: typeof Zap;
  gradient: string;
  ratio: "9:16" | "16:9" | "1:1";
  /** Suggested length; nothing trims the video to it. */
  duration: string;
  /** One of NEW_PROJECT_STYLES' ids: gadzhi, minimal, film, saas, docu or cine3d. */
  preset: "gadzhi" | "minimal" | "film" | "saas" | "docu" | "cine3d";
  brief: string;
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "hook", cat: "Hooks", title: "3-second hook",
    desc: "Vertical short that opens on a punchy key line behind you and moves fast.",
    icon: Zap, gradient: "from-violet-500 via-purple-500 to-fuchsia-500",
    ratio: "9:16", duration: "0:15", preset: "gadzhi",
    brief: "A short, fast video. Put the hook's key line behind the speaker in the first seconds. Keep a visual every 2-3 seconds: key lines, numbers as counters, punch-in zooms on emphatic words. No long graphics.",
  },
  {
    id: "talking", cat: "Talking head", title: "Talking head + graphics",
    desc: "Talk to camera; Motion Explainer graphics land on what you say.",
    icon: Radio, gradient: "from-blue-500 to-cyan-500",
    ratio: "9:16", duration: "0:45", preset: "gadzhi",
    brief: "Give every concrete thing said a visual: numbers as counters, lists, comparisons, key lines. Punch-in zooms on emphatic words between graphics. Keep the speaker on screen for personal moments.",
  },
  {
    id: "product", cat: "Product", title: "Product demo",
    desc: "Landscape walkthrough with app screens, feature lists and numbers.",
    icon: Rocket, gradient: "from-emerald-500 to-teal-500",
    ratio: "16:9", duration: "1:30", preset: "saas",
    brief: "A product walkthrough. Show an app screen whenever the product, a page or a result is mentioned. Features as short lists, results as counters or a dashboard screen, a chapter for each part of the demo. Calm pace.",
  },
  {
    id: "saas", cat: "Product", title: "SaaS launch",
    desc: "Talk about your app with light motion design and app screens.",
    icon: Sparkles, gradient: "from-sky-400 to-indigo-500",
    ratio: "9:16", duration: "0:45", preset: "saas",
    brief: "Show the product whenever it's mentioned: an app screen for each feature, page or result. Numbers as clean counters, benefits as short lists. Bright, friendly and fast.",
  },
  {
    id: "podcast", cat: "Podcast", title: "Podcast clip",
    desc: "Square clip from a podcast or interview, with calm type for the key lines.",
    icon: Mic, gradient: "from-orange-500 to-rose-500",
    ratio: "1:1", duration: "0:60", preset: "minimal",
    brief: "A conversation clip. Few graphics: the strongest key line or two, any number said as a counter, a label naming the topic. Leave the speakers on screen most of the time.",
  },
  {
    id: "vlog", cat: "Lifestyle", title: "Cinematic vlog",
    desc: "Landscape vlog with film colour, grain and slow push-ins.",
    icon: Camera, gradient: "from-pink-500 to-rose-500",
    ratio: "16:9", duration: "2:00", preset: "film",
    brief: "Tell it like a short film. Very few graphics: chapter titles between parts, a story with AI pictures for a moment told over a few sentences. Calm, slow zooms. Leave the footage to breathe.",
  },
  {
    id: "quote", cat: "Inspiration", title: "Quote reel",
    desc: "Vertical quote or motivation reel: the line written out as you say it.",
    icon: Sparkles, gradient: "from-amber-500 to-orange-500",
    ratio: "9:16", duration: "0:20", preset: "film",
    brief: "A short quote or motivational line. Write the main line out as a key line while it's said, the key word emphasised; put it behind the speaker once. Nothing else on screen.",
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
    desc: "A story told to camera, with AI pictures for each turn of it.",
    icon: MessageCircle, gradient: "from-indigo-500 to-violet-500",
    ratio: "9:16", duration: "0:60", preset: "gadzhi",
    brief: "A story told to camera. Use a story with AI pictures for the journey, and the speaker's cartoon for a funny or painful moment. Key lines for the turning points; otherwise keep the speaker on screen.",
  },
  {
    id: "explainer", cat: "Education", title: "Explainer breakdown",
    desc: "Landscape explainer with chapters, steps and notes.",
    icon: BookOpen, gradient: "from-sky-500 to-blue-600",
    ratio: "16:9", duration: "1:15", preset: "gadzhi",
    brief: "A chapter title for each part. Processes as steps, cycles as loops, long teaching stretches as notes beside the speaker. Numbers as counters.",
  },
  {
    id: "news", cat: "News", title: "News drop",
    desc: "Vertical update that opens on the headline and the numbers.",
    icon: Newspaper, gradient: "from-red-500 to-rose-600",
    ratio: "9:16", duration: "0:30", preset: "gadzhi",
    brief: "Breaking-news energy. Open with the headline as a key line behind the speaker. Every number said as a counter, names of things as labels, the before/after as a comparison. Fast, a visual every 3 seconds.",
  },
  {
    id: "unbox", cat: "Product", title: "Unboxing edit",
    desc: "Vertical unboxing with film colour and the product's details on screen.",
    icon: ShoppingBag, gradient: "from-fuchsia-500 to-purple-600",
    ratio: "9:16", duration: "0:45", preset: "film",
    brief: "An unboxing. Name the product as a label when it appears, what's in the box as a list, specs and prices as counters, a key line for the verdict. Leave the product shots clear.",
  },
  {
    id: "lesson", cat: "Education", title: "Micro-lesson",
    desc: "Square three-tip lesson with a chapter for each tip.",
    icon: GraduationCap, gradient: "from-teal-500 to-emerald-600",
    ratio: "1:1", duration: "0:60", preset: "gadzhi",
    brief: "A three-tip format: a chapter title for each tip (they number themselves), then a card or list for the tip's points. End on a call to action if one is said.",
  },
  {
    id: "trailer", cat: "Hooks", title: "Announcement trailer",
    desc: "Landscape announcement with a bold opening line and film colour.",
    icon: PlayCircle, gradient: "from-neutral-800 to-neutral-950",
    ratio: "16:9", duration: "0:30", preset: "film",
    brief: "An announcement. Open on the big line behind the speaker, then the key facts as key lines and counters, the date or launch as a label, and a call to action at the end if one is said.",
  },
];

export const TEMPLATE_CATS = [
  "All", "Hooks", "Talking head", "Product", "Podcast",
  "Lifestyle", "Education", "Storytime", "News", "Inspiration",
];
