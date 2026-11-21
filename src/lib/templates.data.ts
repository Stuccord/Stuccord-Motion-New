import {
  Zap, Radio, Rocket, PlayCircle, Mic, Camera, Sparkles, MessageCircle,
  BookOpen, Newspaper, ShoppingBag, GraduationCap, Type, Film,
} from "lucide-react";

// Each template starts a project with a shape, one of the app's real looks
// (NEW_PROJECT_STYLES in presets.ts) and a brief. The brief goes to Claude,
// which plans the graphics (src/lib/motion-plan.server.ts) and writes the
// opening hook (render-worker/ai.js), so it only asks for what those can do:
// the planner's graphic types, zooms, graphics behind the speaker and AI
// story pictures - not the speaker's cartoon, card streams or profiles, which
// the automatic edit leaves out (they need the user's own photos). Captions,
// music and pause cuts are automatic, not set by the brief. `duration` is a
// suggested length, not enforced.

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
  /**
   * One of NEW_PROJECT_STYLES' ids. Each template is moving to a look of its
   * own (docs/templates-unique-plan.md); the look also picks the AI
   * pictures' style (story-images.server.ts LOOK_PICTURE).
   */
  preset: "gadzhi" | "minimal" | "film" | "saas" | "paper" | "docu" | "cine3d" | "bulletin" | "impact" | "noir" | "monument" | "talk" | "notebook" | "hud" | "studio";
  brief: string;
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "hook", cat: "Hooks", title: "3-second hook",
    desc: "Vertical short in the Impact look: huge stamped capitals behind you, black and acid yellow, a cut every beat.",
    icon: Zap, gradient: "from-lime-300 to-neutral-950",
    ratio: "9:16", duration: "0:15", preset: "impact",
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
    desc: "Landscape walkthrough in the Studio 3D look: your app screens floating in a light 3D studio, feature stacks and stat cards. Add screenshots in the editor to show your real product.",
    icon: Rocket, gradient: "from-neutral-200 to-blue-600",
    ratio: "16:9", duration: "1:30", preset: "studio",
    brief: "A product walkthrough. Show an app screen whenever the product, a page or a result is mentioned. Features as short lists, results as counters or a dashboard screen, a chapter for each part of the demo. Calm pace.",
  },
  {
    id: "saas", cat: "Product", title: "SaaS launch",
    desc: "Talk about your app with light motion design and app screens. Add screenshots in the editor to show your real app.",
    icon: Sparkles, gradient: "from-sky-400 to-indigo-500",
    ratio: "9:16", duration: "0:45", preset: "saas",
    brief: "Show the product whenever it's mentioned: an app screen for each feature, page or result. Numbers as clean counters, benefits as short lists. Bright, friendly and fast.",
  },
  {
    id: "podcast", cat: "Podcast", title: "Podcast clip",
    desc: "Square podcast or interview moment (upload just the part you want) in the Studio Talk look: warm pull-quote cards, topic pills and stat cards.",
    icon: Mic, gradient: "from-amber-400 to-stone-900",
    ratio: "1:1", duration: "0:60", preset: "talk",
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
    desc: "Vertical quote reel in the Monument look: the line set like an inscription in ivory and gold, big ideas as marble sculptures.",
    icon: Sparkles, gradient: "from-amber-300 to-stone-950",
    ratio: "9:16", duration: "0:20", preset: "monument",
    brief: "A short quote or motivational line. Write the main line out as a key line while it's said, the key word emphasised; put it behind the speaker once. If the line holds one big image (time, a key, a crown, a mountain), make it a metaphor with a single object. Nothing else on screen.",
  },
  {
    id: "minimal", cat: "Education", title: "Minimal explainer",
    desc: "Your key lines as quiet black scenes with thin hanging lines and serif type; calm and spacious.",
    icon: Type, gradient: "from-neutral-500 to-neutral-800",
    ratio: "9:16", duration: "0:60", preset: "minimal",
    brief: "Calm and clear. Few graphics, each with lots of space: one key line, a number or a short list at a time. No hype.",
  },
  {
    id: "film", cat: "Storytime", title: "Cinematic story",
    desc: "Your story as a black-and-white noir film: typewriter chapter titles, iris cuts and noir AI stills.",
    icon: Film, gradient: "from-neutral-300 to-neutral-950",
    ratio: "9:16", duration: "1:00", preset: "noir",
    brief: "Tell it like a short noir film. Few graphics, each given room to breathe: chapter titles between parts, a story with AI pictures for each turn, a label when a place or a year is named, the one line that hurts most as a key line. Calm and serious.",
  },
  {
    id: "story", cat: "Storytime", title: "Storytime narration",
    desc: "A story told to camera, on paper prints with a pen reading along, and painted storybook AI pictures for each turn of it.",
    icon: MessageCircle, gradient: "from-amber-200 to-orange-400",
    ratio: "9:16", duration: "0:60", preset: "paper",
    brief: "A story told to camera. Use a story with AI pictures for the journey (its first scenes matter most). Key lines for the turning points and a zoom on a funny or painful moment; otherwise keep the speaker on screen.",
  },
  {
    id: "explainer", cat: "Education", title: "Explainer breakdown",
    desc: "Landscape explainer as drawn documentary scenes: chapters, steps and the big ideas drawn as pictures on a light stage.",
    icon: BookOpen, gradient: "from-neutral-200 to-red-500",
    ratio: "16:9", duration: "1:15", preset: "docu",
    brief: "A chapter title for each part. Processes as steps, cycles as loops, long teaching stretches as notes beside the speaker. Numbers as counters. When an idea is said that a picture says better (a long road, a crossroads, a balance, a rising line), make it a metaphor.",
  },
  {
    id: "news", cat: "News", title: "News drop",
    desc: "Vertical update in the Bulletin look: headline bars, stat boxes and lower thirds in news red and navy.",
    icon: Newspaper, gradient: "from-red-600 to-blue-950",
    ratio: "9:16", duration: "0:30", preset: "bulletin",
    brief: "Breaking-news energy. Open with the headline as a key line behind the speaker. Every number said as a counter, names of things as labels, the before/after as a comparison. Fast, a visual every 3 seconds.",
  },
  {
    id: "unbox", cat: "Product", title: "Unboxing edit",
    desc: "Vertical unboxing in the Spec HUD look: a callout naming the product, an in-the-box inventory, spec readouts and a scanned verdict.",
    icon: ShoppingBag, gradient: "from-lime-300 to-neutral-950",
    ratio: "9:16", duration: "0:45", preset: "hud",
    brief: "An unboxing. Name the product as a label when it appears, what's in the box as a list, specs and prices as counters, a chapter for each stage (unboxing, setup, first use), a key line for the verdict. Leave the product shots clear; no AI pictures.",
  },
  {
    id: "lesson", cat: "Education", title: "Micro-lesson",
    desc: "Square three-tip lesson in the Notebook look: a handwritten tip page for each tip, checklists, circled numbers and sticky notes.",
    icon: GraduationCap, gradient: "from-yellow-200 to-blue-800",
    ratio: "1:1", duration: "0:60", preset: "notebook",
    brief: "A three-tip format: a chapter title for each tip (they number themselves), then a list for the tip's points. Numbers said as counters, the name of a rule or method as a label, the most important sentence as a key line. End on a call to action if one is said.",
  },
  {
    id: "trailer", cat: "Hooks", title: "Announcement trailer",
    desc: "Landscape announcement in 3D Cinematic: photo-real AI objects under red light and big glowing words.",
    icon: PlayCircle, gradient: "from-red-900 to-neutral-950",
    ratio: "16:9", duration: "0:30", preset: "cine3d",
    brief: "An announcement. Open on the big line behind the speaker, then the key facts as key lines and counters, the date or launch as a label, and a call to action at the end if one is said. Make the one or two biggest ideas metaphors with a single hero object.",
  },
];

export const TEMPLATE_CATS = [
  "All", "Hooks", "Talking head", "Product", "Podcast",
  "Lifestyle", "Education", "Storytime", "News", "Inspiration",
];
