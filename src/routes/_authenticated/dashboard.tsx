import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { listProjects } from "@/lib/projects.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus,
  Film,
  Sparkles,
  Clock,
  ArrowUpRight,
  ArrowRight,
  Wand2,
  Mic,
  Music2,
  Captions,
  Scissors,
  Image as ImageIcon,
  MoreHorizontal,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import phoneShort from "@/assets/phone-short.jpg";
import editingDesk from "@/assets/editing-desk.jpg";
import creatorPortrait from "@/assets/creator-portrait.jpg";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Home — Stuccord Motion" }] }),
  component: Home,
});

const STATUS_META: Record<string, { label: string; className: string; dot: string }> = {
  draft:      { label: "Draft",     className: "bg-muted text-muted-foreground border border-border",        dot: "bg-muted-foreground" },
  queued:     { label: "Queued",    className: "bg-amber-50 text-amber-700 border border-amber-200",         dot: "bg-amber-500" },
  processing: { label: "Rendering", className: "bg-blue-50 text-blue-700 border border-blue-200",            dot: "bg-blue-500 animate-pulse" },
  ready:      { label: "Ready",     className: "bg-emerald-50 text-emerald-700 border border-emerald-200",   dot: "bg-emerald-500" },
  failed:     { label: "Failed",    className: "bg-red-50 text-red-700 border border-red-200",               dot: "bg-red-500" },
};

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <Badge variant="outline" className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}

function ProjectThumb({ ratio, title }: { ratio: string; title: string }) {
  const seed = title.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue1 = (seed * 37) % 360;
  const hue2 = (hue1 + 60) % 360;
  const box = ratio === "9:16" ? "aspect-[9/16]" : ratio === "1:1" ? "aspect-square" : "aspect-video";
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg", box)}
      style={{ background: `linear-gradient(135deg, hsl(${hue1} 65% 58%), hsl(${hue2} 60% 44%))` }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.30),transparent_55%)]" />
      <div className="absolute inset-0 grid place-items-center">
        <Film className="w-5 h-5 text-white/70" />
      </div>
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  const fetchProjects = useServerFn(listProjects);
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => fetchProjects() });

  const recent = useMemo(() => (data ?? []).slice(0, 4), [data]);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-10">

        {/* Page header */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] md:text-[30px] font-semibold tracking-tight text-foreground">
            What would you like to create?
          </h1>
          <Link
            to="/templates"
            className="group inline-flex items-center gap-2 rounded-full bg-card border border-border pl-1 pr-3 py-1 text-[12px] font-medium text-foreground shadow-sm hover:border-primary/30 hover:bg-accent transition-all"
          >
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-2 py-0.5">New</span>
            Auto-Caption 2.0
            <ArrowRight className="w-3 h-3 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Primary create cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <CreateCard
            title="Short from footage"
            desc="Drop clips, get a scroll-stopping short with captions & score"
            onClick={() => navigate({ to: "/projects/new" })}
            visual={
              <div className="relative h-full w-full bg-gradient-to-br from-surface to-muted p-4 grid place-items-center">
                <div className="relative w-[110px] rotate-[-6deg] rounded-[14px] overflow-hidden shadow-[0_20px_50px_-20px_rgba(0,0,0,0.25)] border border-border">
                  <img src={phoneShort} alt="" className="aspect-[9/16] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 p-1.5">
                    <div className="rounded-md bg-black/60 backdrop-blur px-1.5 py-1 text-[8px] font-semibold text-white text-center leading-tight">
                      "…and that's when it clicked."
                    </div>
                  </div>
                </div>
                <div className="absolute top-4 right-4 w-16 rotate-6 rounded-lg overflow-hidden shadow-md border border-border">
                  <img src={editingDesk} alt="" className="aspect-video w-full object-cover" />
                </div>
              </div>
            }
          />
          <CreateCard
            title="Talking-head clip"
            desc="Turn a raw selfie video into captioned, cut-tight content"
            onClick={() => navigate({ to: "/projects/new" })}
            visual={
              <div className="relative h-full w-full bg-gradient-to-br from-accent/60 via-card to-primary/5 p-4">
                <div className="absolute top-4 left-4 w-[92px] rounded-xl overflow-hidden shadow-md border border-border">
                  <img src={creatorPortrait} alt="" className="aspect-[3/4] w-full object-cover" />
                </div>
                <div className="absolute right-4 top-6 max-w-[130px] rounded-lg bg-card shadow-sm border border-border p-2">
                  <div className="text-[9px] font-mono text-muted-foreground mb-1">00:04 · Hook</div>
                  <div className="text-[10px] font-medium text-foreground leading-tight">
                    Three habits that changed my morning routine…
                  </div>
                </div>
                <div className="absolute bottom-4 right-4 left-4 flex items-center gap-1.5">
                  {Array.from({ length: 22 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-full bg-primary/70"
                      style={{ height: `${6 + Math.abs(Math.sin(i * 0.9)) * 22}px` }}
                    />
                  ))}
                </div>
              </div>
            }
          />
          <CreateCard
            title="Brand kit"
            desc="Set fonts, colors & intros — apply to every render automatically"
            onClick={() => navigate({ to: "/settings" })}
            visual={
              <div className="relative h-full w-full bg-gradient-to-br from-amber-50 via-card to-rose-50 p-4">
                <div className="grid grid-cols-2 gap-2">
                  {["#0F172A", "#4F46E5", "#F59E0B", "#EC4899"].map((c) => (
                    <div key={c} className="rounded-lg shadow-sm border border-border overflow-hidden">
                      <div className="h-9" style={{ background: c }} />
                      <div className="px-2 py-1 bg-card text-[9px] font-mono text-muted-foreground">{c}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-lg bg-card shadow-sm border border-border px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Display</div>
                  <div className="text-sm font-semibold tracking-tight text-foreground">Inter · DM Sans</div>
                </div>
              </div>
            }
          />
        </div>

        {/* Quick tools */}
        <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Captions",   icon: Captions,       to: "/projects/new" },
            { label: "Voiceover",  icon: Mic,            to: "/projects/new" },
            { label: "Score & SFX",icon: Music2,          to: "/projects/new" },
            { label: "Auto-cut",   icon: Scissors,       to: "/projects/new" },
            { label: "Thumbnail",  icon: ImageIcon,      to: "/projects/new" },
            { label: "More tools", icon: MoreHorizontal, to: "/templates" },
          ].map((t) => (
            <Link
              key={t.label}
              to={t.to}
              className="group flex items-center gap-2.5 rounded-xl bg-card border border-border px-3.5 py-3 hover:border-primary/30 hover:shadow-sm transition-all duration-150"
            >
              <span className="w-7 h-7 rounded-lg bg-surface grid place-items-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-150">
                <t.icon className="w-3.5 h-3.5" />
              </span>
              <span className="text-[13px] font-medium text-foreground truncate">{t.label}</span>
            </Link>
          ))}
        </div>

        {/* Feature banner */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="grid md:grid-cols-[1fr_240px] items-stretch">
            <div className="p-6 md:p-8">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Everything included</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-[13px] text-foreground max-w-md">
                {[
                  "Publish to 6 platforms",
                  "Auto-cut silences",
                  "Multi-language captions",
                  "Brand-safe scoring",
                  "4K export",
                  "Team collaboration",
                ].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="text-muted-foreground">{f}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative bg-foreground text-background p-6 md:p-8 flex flex-col justify-between overflow-hidden">
              <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-background/50 mb-2">Now live</div>
                <div className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                  Motion <span className="inline-flex items-center rounded-full bg-background/15 px-2 py-0.5 text-[11px] font-semibold">v2</span>
                </div>
              </div>
              <Button
                size="sm"
                className="relative mt-4 w-fit bg-background text-foreground hover:bg-background/90"
                onClick={() => navigate({ to: "/projects/new" })}
              >
                Launch <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Recent projects */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Recent projects</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Pick up where you left off.</p>
            </div>
            <Link
              to="/projects"
              className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-56 bg-card border border-border rounded-xl animate-pulse" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <div className="mx-auto w-11 h-11 rounded-full bg-accent text-accent-foreground grid place-items-center mb-3">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="text-sm font-medium text-foreground">Your studio is a blank page.</div>
              <div className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                Kick things off with a template or start from scratch — most creators ship their first short in under 5 minutes.
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <Button onClick={() => navigate({ to: "/projects/new" })}>
                  <Plus className="w-4 h-4" /> Start your first project
                </Button>
                <Button variant="outline" onClick={() => navigate({ to: "/templates" })}>
                  <Wand2 className="w-4 h-4" /> Browse templates
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recent.map((p) => (
                <Link
                  key={p.id}
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="group block"
                >
                  <Card className="p-3 hover:border-primary/20 hover:shadow-md transition-all duration-150 cursor-pointer">
                    <CardContent className="p-0">
                      <ProjectThumb ratio={p.aspect_ratio} title={p.title} />
                      <div className="mt-3">
                        <div className="text-sm font-medium truncate text-foreground">{p.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <StatusPill status={p.status} />
                          <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function CreateCard({
  title,
  desc,
  visual,
  onClick,
}: {
  title: string;
  desc: string;
  visual: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className="group relative overflow-hidden cursor-pointer hover:border-primary/25 hover:shadow-lg transition-all duration-150"
    >
      <div className="h-[172px] overflow-hidden border-b border-border">{visual}</div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[14px] font-semibold tracking-tight text-foreground">{title}</div>
          <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all shrink-0" />
        </div>
        <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">{desc}</p>
      </CardContent>
    </Card>
  );
}
