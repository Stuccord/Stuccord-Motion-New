import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Search, BookOpen, PlayCircle, MessageCircle, Mail, ArrowUpRight, Zap, Wand2, Upload, Film } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({ meta: [{ title: "Help & docs — Stuccord Motion" }] }),
  component: HelpPage,
});

const GUIDES = [
  { icon: Upload, title: "Uploading footage", desc: "What formats work best and how to keep uploads snappy." },
  { icon: Wand2, title: "Picking a style preset", desc: "How Gadzhi, Documentary and Kinetic compare." },
  { icon: Zap, title: "Writing a great script", desc: "Structure hooks, beats and CTAs the engine loves." },
  { icon: Film, title: "Editing after render", desc: "Tweak captions, swap clips, re-render in seconds." },
];

const FAQS = [
  { q: "How long does a render take?", a: "Most 30-60 second shorts finish in 3-5 minutes. Longer pieces or 4K renders can take up to 15 minutes on the Pro plan." },
  { q: "Can I bring my own music?", a: "Yes — upload MP3 or WAV to Assets and select it in the project's Audio panel. We normalize to -14 LUFS automatically." },
  { q: "Do you keep my uploaded footage?", a: "Only for as long as you keep the project. Deleting a project removes the source clips from our storage within 24 hours." },
  { q: "Can I edit the AI's cut manually?", a: "Absolutely. The editor lets you re-order beats, trim clips, and rewrite captions before re-rendering." },
  { q: "How do I connect TikTok, Reels or Shorts?", a: "Head to Settings → Channels. We'll auto-format and publish directly once you've authorised the platform." },
];

function HelpPage() {
  const [q, setQ] = useState("");
  const filtered = FAQS.filter((f) => !q || f.q.toLowerCase().includes(q.toLowerCase()) || f.a.toLowerCase().includes(q.toLowerCase()));

  return (
    <AppShell title="Help & docs" subtitle="Search the docs, watch walkthroughs, or talk to a human.">
      <div className="relative rounded-3xl bg-gradient-to-br from-violet-600 via-violet-700 to-fuchsia-700 text-white p-8 md:p-12 overflow-hidden mb-8">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">How can we help?</h2>
          <p className="text-sm text-white/70 mt-2">Search the docs or browse popular guides below.</p>
          <div className="mt-6 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search articles…"
              className="w-full h-12 pl-11 pr-4 text-sm bg-white text-neutral-900 rounded-full focus:outline-none focus:ring-2 focus:ring-white/30 shadow-xl"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-10">
        <ContactCard icon={BookOpen} title="Read the docs" desc="Deep-dive guides and API reference." cta="Open docs" />
        <ContactCard icon={PlayCircle} title="Watch tutorials" desc="60-second walkthroughs of every feature." cta="Watch now" />
        <ContactCard icon={MessageCircle} title="Talk to support" desc="Weekdays 9am-6pm UK · replies in &lt; 4h." cta="Start chat" />
      </div>

      <section className="mb-10">
        <h3 className="text-sm font-semibold mb-3">Popular guides</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GUIDES.map((g) => (
            <a key={g.title} href="#" className="group rounded-xl border border-black/5 bg-white p-4 hover:border-black/20 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-violet-50 text-violet-700 grid place-items-center mb-3">
                <g.icon className="w-4 h-4" />
              </div>
              <div className="text-sm font-semibold flex items-center gap-1">
                {g.title} <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-xs text-neutral-500 mt-1">{g.desc}</div>
            </a>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Frequently asked</h3>
        <div className="rounded-2xl bg-white border border-black/5 divide-y divide-black/5">
          {filtered.map((f) => (
            <details key={f.q} className="group">
              <summary className="cursor-pointer flex items-start justify-between gap-4 p-4 list-none">
                <div className="text-sm font-medium">{f.q}</div>
                <div className="text-neutral-400 group-open:rotate-45 transition-transform text-xl leading-none">+</div>
              </summary>
              <div className="px-4 pb-4 text-sm text-neutral-600 leading-relaxed">{f.a}</div>
            </details>
          ))}
          {filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-neutral-500">No articles matched "{q}". <a href="mailto:support@stuccord.com" className="text-violet-700 font-medium">Email us</a> instead.</div>
          )}
        </div>
      </section>

      <div className="mt-10 rounded-2xl border border-black/5 bg-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-900 text-white grid place-items-center"><Mail className="w-4 h-4" /></div>
          <div>
            <div className="text-sm font-semibold">Still stuck?</div>
            <div className="text-xs text-neutral-500">Send a note and we'll get back within a few hours.</div>
          </div>
        </div>
        <Button asChild><a href="mailto:support@stuccord.com">Email support</a></Button>
      </div>
    </AppShell>
  );
}

function ContactCard({ icon: Icon, title, desc, cta }: { icon: typeof BookOpen; title: string; desc: string; cta: string }) {
  return (
    <div className="rounded-2xl bg-white border border-black/5 p-5">
      <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 grid place-items-center mb-3">
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-neutral-500 mt-1" dangerouslySetInnerHTML={{ __html: desc }} />
      <Button variant="ghost" size="sm" className="mt-3 -ml-2">{cta} <ArrowUpRight className="w-3.5 h-3.5" /></Button>
    </div>
  );
}
