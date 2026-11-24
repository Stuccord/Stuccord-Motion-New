import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useState } from "react";
import { TEMPLATES, TEMPLATE_CATS } from "@/lib/templates.data";
import { NEW_PROJECT_STYLES } from "@/lib/presets";
import { LookPreview, lookOfPreset } from "@/components/look-preview";
import creatorPortrait from "@/assets/creator-portrait.jpg";
import creator2 from "@/assets/creator-2.jpg";
import creator3 from "@/assets/creator-3.jpg";
import deskOverhead from "@/assets/desk-overhead.jpg";
import editingDesk from "@/assets/editing-desk.jpg";
import studioMics from "@/assets/studio-mics.jpg";
import cameraLens from "@/assets/camera-lens.jpg";
import phoneCaptions from "@/assets/phone-captions.jpg";
import phoneShort from "@/assets/phone-short.jpg";
import btsStudio from "@/assets/bts-studio.jpg";

/** What each template's preview shows: footage that fits, and a sample line. */
const SAMPLE: Record<string, { image: string; line: string; emphasis?: string }> = {
  hook: { image: creatorPortrait, line: "Most people quit right before it works", emphasis: "works" },
  talking: { image: creator2, line: "Three habits changed my mornings", emphasis: "mornings" },
  product: { image: deskOverhead, line: "Ship a landing page in 10 minutes", emphasis: "10 minutes" },
  saas: { image: editingDesk, line: "Your dashboard, finally simple", emphasis: "simple" },
  podcast: { image: studioMics, line: "The best advice I ever got", emphasis: "advice" },
  vlog: { image: cameraLens, line: "A slow morning by the sea" },
  quote: { image: creator3, line: "Discipline beats motivation" },
  minimal: { image: phoneCaptions, line: "Compound interest in 30 seconds", emphasis: "30 seconds" },
  film: { image: btsStudio, line: "That night, everything changed" },
  story: { image: creator3, line: "So I quit my job on a Tuesday", emphasis: "Tuesday" },
  explainer: { image: deskOverhead, line: "How the algorithm really works", emphasis: "really" },
  news: { image: phoneShort, line: "Big update: it just launched", emphasis: "launched" },
  unbox: { image: editingDesk, line: "Unboxing the new setup" },
  lesson: { image: creatorPortrait, line: "One rule for better hooks", emphasis: "better" },
  trailer: { image: btsStudio, line: "Something big is coming" },
};

/** A look's short name ("Motion Explainer" from "Motion Explainer — premium motion graphics"). */
const lookName = (id: string) =>
  NEW_PROJECT_STYLES.find((s) => s.id === id)?.label.split(" — ")[0] ?? id;

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({ meta: [{ title: "Presets — Stuccord Motion" }] }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const navigate = useNavigate();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const filtered = TEMPLATES.filter((t) =>
    (cat === "All" || t.cat === cat) &&
    (!q || t.title.toLowerCase().includes(q.toLowerCase()) || t.desc.toLowerCase().includes(q.toLowerCase()))
  );

  const startFromTemplate = (id: string) => {
    navigate({ to: "/projects/new", search: { template: id } as never });
  };

  return (
    <AppShell
      title="Presets"
      subtitle="Pick the kind of video you’re making. Each preset sets the shape, the look and what the AI focuses on, then makes the whole edit for you."
      actions={<Button onClick={() => navigate({ to: "/projects/new" })}>Start from blank</Button>}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search presets…"
            className="w-full h-10 pl-8 pr-3 text-sm bg-card border border-border rounded-full focus:border-primary/60 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-full p-1 overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TEMPLATE_CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={cn(
                "px-3.5 h-8 text-xs font-medium rounded-full transition-colors whitespace-nowrap",
                cat === c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-surface-2",
              )}>{c}</button>
          ))}
        </div>
      </div>

      {/* Two columns even on phones (like Higgsfield's tool cards): smaller previews there. */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((t) => (
          <button key={t.id} onClick={() => startFromTemplate(t.id)}
            className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-20px_color-mix(in_oklab,var(--color-primary)_50%,transparent)] transition-all">
            <div className="relative h-40 sm:h-52 overflow-hidden bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--color-primary)_22%,transparent),transparent_70%)]">
              {/* What this template makes: its shape, its look, a sample line. */}
              <div className="absolute inset-0 flex items-center justify-center px-3 sm:px-6 pb-3 pt-10 sm:pt-12 transition-transform duration-300 group-hover:scale-[1.03]">
                <LookPreview
                  look={lookOfPreset(t.preset)}
                  ratio={t.ratio}
                  image={(SAMPLE[t.id] ?? SAMPLE.hook).image}
                  line={(SAMPLE[t.id] ?? SAMPLE.hook).line}
                  emphasis={(SAMPLE[t.id] ?? SAMPLE.hook).emphasis}
                  className={t.ratio === "16:9" ? "max-w-full" : ""}
                />
              </div>
              <div className="absolute inset-x-0 top-0 p-2 sm:p-3 flex items-start justify-between">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-white/10 backdrop-blur grid place-items-center">
                  <t.icon className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono font-medium text-white/90 bg-black/25 backdrop-blur rounded px-1.5 py-0.5">{t.ratio}</span>
                  <span
                    title="Suggested length"
                    className="hidden sm:inline text-[10px] font-mono font-medium text-white/90 bg-black/25 backdrop-blur rounded px-1.5 py-0.5"
                  >
                    ~{t.duration}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-3 sm:p-4 border-t border-border">
              <div className="flex items-center justify-between gap-2">
                <div className="hidden sm:block text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t.cat}</div>
                <div className="text-[10px] font-medium text-primary-glow bg-primary/10 rounded px-1.5 py-0.5">
                  {lookName(t.preset)}
                </div>
              </div>
              <div className="font-display font-bold text-[16px] leading-6 tracking-[-0.04em] lg:caps-label lg:text-[14px] lg:leading-tight mt-1 lg:mt-2">{t.title}</div>
              <div className="text-[12px] leading-[18px] lg:text-xs lg:leading-normal text-muted-foreground mt-1 line-clamp-2">{t.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </AppShell>
  );
}
