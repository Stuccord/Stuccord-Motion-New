// Colours of the Motion Explainer graphic types on the timeline and in the inspector.

import type { ElementType } from "@/lib/motion-plan";

export const GRAPHIC_TINT: Record<ElementType, string> = {
  keyline: "bg-violet-500/25 border-violet-400/50 text-violet-100",
  counter: "bg-amber-500/20 border-amber-400/50 text-amber-100",
  list: "bg-cyan-500/20 border-cyan-400/50 text-cyan-100",
  card: "bg-sky-500/20 border-sky-400/50 text-sky-100",
  compare: "bg-pink-500/20 border-pink-400/50 text-pink-100",
  story: "bg-orange-500/20 border-orange-400/50 text-orange-100",
  cartoon: "bg-fuchsia-500/20 border-fuchsia-400/50 text-fuchsia-100",
  chapter: "bg-emerald-500/20 border-emerald-400/50 text-emerald-100",
  label: "bg-white/10 border-white/25 text-neutral-200",
  cta: "bg-red-500/20 border-red-400/50 text-red-100",
  zoom: "bg-white/[0.06] border-white/20 text-neutral-300 border-dashed",
};
