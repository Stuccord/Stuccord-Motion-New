import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listProjects, getClipSignedUrl, setClipThumbnail } from "@/lib/projects.functions";
import { useThumbnailMaker } from "@/lib/clip-thumbnails";
import { useWorkspace } from "@/lib/use-workspace";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus,
  Check,
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
import editingDesk from "@/assets/editing-desk.jpg";
import creatorPortraitGraded from "@/assets/creator-portrait-graded.jpg";
import creator2 from "@/assets/creator-2.jpg";
import btsStudio from "@/assets/bts-studio.jpg";
import { LookPreview } from "@/components/look-preview";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Home — Stuccord Motion" }] }),
  component: Home,
});

const STATUS_META: Record<string, { label: string; className: string; dot: string }> = {
  draft:      { label: "Draft",     className: "bg-muted text-muted-foreground border border-border",        dot: "bg-muted-foreground" },
  queued:     { label: "Queued",    className: "bg-amber-500/10 text-amber-300 border border-amber-500/30",         dot: "bg-amber-500" },
  processing: { label: "Rendering", className: "bg-blue-500/10 text-blue-300 border border-blue-500/30",            dot: "bg-blue-500 animate-pulse" },
  ready:      { label: "Ready",     className: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",   dot: "bg-emerald-500" },
  failed:     { label: "Failed",    className: "bg-red-500/10 text-red-300 border border-red-500/30",               dot: "bg-red-500" },
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

/** A frame from the project's first clip; a coloured card until there is one. */
function ProjectThumb({ ratio, title, src }: { ratio: string; title: string; src?: string | null }) {
  const seed = title.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue1 = (seed * 37) % 360;
  const hue2 = (hue1 + 60) % 360;
  const box = ratio === "9:16" ? "aspect-[9/16]" : ratio === "1:1" ? "aspect-square" : "aspect-video";
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg bg-surface-2", box)}
      style={
        src
          ? undefined
          : { background: `linear-gradient(135deg, hsl(${hue1} 65% 58%), hsl(${hue2} 60% 44%))` }
      }
    >
      {src ? (
        <img src={src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.30),transparent_55%)]" />
          <div className="absolute inset-0 grid place-items-center">
            <Film className="w-5 h-5 text-white/70" />
          </div>
        </>
      )}
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  const fetchProjects = useServerFn(listProjects);
  const ws = useWorkspace();
  const { data, isLoading } = useQuery({
    queryKey: ["projects", ws.id],
    queryFn: () => fetchProjects({ data: { workspace: ws.id } }),
  });

  const recent = useMemo(() => (data ?? []).slice(0, 4), [data]);

  // Recent projects without a thumbnail get one in the background.
  const queryClient = useQueryClient();
  const signFn = useServerFn(getClipSignedUrl);
  const recordThumbFn = useServerFn(setClipThumbnail);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useThumbnailMaker(
    recent.flatMap((p) => (p.thumbnail_source ? [p.thumbnail_source] : [])),
    signFn,
    recordThumbFn,
    () => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      }, 1500);
    },
  );

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-10">

        {/* Hero: the one thing the app does — raw footage in, finished edit out */}
        <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-[radial-gradient(ellipse_80%_120%_at_0%_0%,color-mix(in_oklab,var(--color-primary)_28%,transparent),transparent_60%),linear-gradient(180deg,var(--color-card),var(--color-background))] p-6 sm:p-10">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
          <div className="relative grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              <div className="caps-label text-[11px] text-primary-glow">Motion Explainer · auto-edit</div>
              <h1 className="mt-3 text-[30px] sm:text-[40px] leading-[1.02] font-bold tracking-[-0.03em] text-foreground">
                What would you like to create?
              </h1>
              <p className="mt-3 max-w-md text-sm text-muted-foreground leading-relaxed">
                Drop a raw take and your script. The AI plans the graphics, makes the story
                pictures and renders the finished edit.
              </p>
              <Link
                to="/projects"
                className="group mt-5 inline-flex items-center gap-2 rounded-full bg-white/[0.06] border border-border pl-1 pr-3 py-1 text-[12px] font-medium text-foreground hover:border-primary/40 transition-all"
              >
                <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-2 py-0.5">New</span>
                Studio sound and colour on every export
                <ArrowRight className="w-3 h-3 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: "/projects/new" })}
              className="group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 bg-black/30 px-6 py-8 sm:py-10 text-center transition-all hover:border-primary/70 hover:bg-primary/[0.06] cursor-pointer"
            >
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_30px_-8px_color-mix(in_oklab,var(--color-primary)_80%,transparent)] group-hover:scale-105 transition-transform">
                <Plus className="w-6 h-6" />
              </span>
              <span className="text-base font-semibold text-foreground">Make a video</span>
              <span className="text-xs text-muted-foreground">MP4 · MOV · WebM — talking-head footage works best</span>
            </button>
          </div>
        </section>

        {/* Primary create cards: the real ways in */}
        <div className="grid gap-4 md:grid-cols-3">
          <CreateCard
            title="Make a video"
            desc="Upload a take. Stuccord makes the whole edit: graphics, AI scenes, captions, sound and colour."
            onClick={() => navigate({ to: "/projects/new" })}
            visual={
              <div className="relative h-full w-full bg-[radial-gradient(ellipse_at_30%_0%,color-mix(in_oklab,var(--color-primary)_28%,transparent),transparent_70%)] p-4">
                <div className="absolute left-4 top-4 right-[42%] space-y-1.5 rounded-xl border border-white/10 bg-black/40 p-2.5 backdrop-blur">
                  {["Transcribed", "Graphics planned", "Story scenes made", "Sound mastered", "Rendered"].map((s) => (
                    <div key={s} className="flex items-center gap-1.5 text-[10px] text-foreground/90">
                      <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                      {s}
                    </div>
                  ))}
                </div>
                <div className="absolute right-4 top-3 bottom-3">
                  <LookPreview
                    look="glass"
                    ratio="9:16"
                    image={creatorPortraitGraded}
                    line="Most people quit before it works"
                    emphasis="works"
                  />
                </div>
              </div>
            }
          />
          <CreateCard
            title="Start from a template"
            desc="Hooks, talking heads, product demos, podcasts and more, each with its own shape and look."
            onClick={() => navigate({ to: "/templates" })}
            visual={
              <div className="relative flex h-full w-full items-center justify-center gap-2.5 bg-[radial-gradient(ellipse_at_50%_100%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_70%)] px-3 py-4">
                <div className="h-[118px] -rotate-6">
                  <LookPreview look="film" ratio="9:16" image={btsStudio} line="That night" />
                </div>
                <div className="z-10 h-[140px]">
                  <LookPreview look="glass" ratio="9:16" image={creator2} line="Three habits" emphasis="habits" />
                </div>
                <div className="h-[118px] rotate-6">
                  <LookPreview look="saas" ratio="9:16" image={editingDesk} line="Ship faster" emphasis="faster" />
                </div>
              </div>
            }
          />
          <CreateCard
            title="Brand kit"
            desc="Your caption colours, font and logo on every export"
            onClick={() => navigate({ to: "/settings", search: { tab: "brand" } as never })}
            visual={
              <div className="relative h-full w-full bg-gradient-to-br from-amber-500/15 via-card to-rose-500/15 p-4">
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
          {/* Tools that aren't built yet say so and do nothing. */}
          {/* Voiceover, Auto-cut and Thumbnail open in the latest project (or start one). */}
          {[
            { label: "Captions", icon: Captions, to: "/projects/new" },
            {
              label: "Voiceover",
              icon: Mic,
              to: recent[0] ? "/projects/$projectId" : "/projects/new",
              params: recent[0] ? { projectId: recent[0].id } : undefined,
              search: recent[0] ? { voiceover: 1 as const } : undefined,
              title: recent[0] ? `Opens in “${recent[0].title}”` : "Start a project first",
            },
            { label: "Music & SFX", icon: Music2, to: "/projects/new" },
            {
              label: "Auto-cut",
              icon: Scissors,
              to: recent[0] ? "/projects/$projectId" : "/projects/new",
              params: recent[0] ? { projectId: recent[0].id } : undefined,
              search: recent[0] ? { autocut: 1 as const } : undefined,
              title: recent[0] ? `Opens in “${recent[0].title}”` : "Start a project first",
            },
            {
              label: "Thumbnail",
              icon: ImageIcon,
              to: recent[0] ? "/projects/$projectId" : "/projects/new",
              params: recent[0] ? { projectId: recent[0].id } : undefined,
              search: recent[0] ? { thumbnail: 1 as const } : undefined,
              title: recent[0] ? `Opens in “${recent[0].title}”` : "Start a project first",
            },
            { label: "Templates", icon: MoreHorizontal, to: "/templates" },
          ].map((t) =>
            t.to ? (
              <Link
                key={t.label}
                to={t.to}
                params={"params" in t ? t.params : undefined}
                search={"search" in t ? t.search : undefined}
                title={"title" in t ? t.title : undefined}
                className="group flex items-center gap-2.5 rounded-xl bg-card border border-border px-3.5 py-3 hover:border-primary/30 hover:shadow-sm transition-all duration-150"
              >
                <span className="w-7 h-7 rounded-lg bg-surface grid place-items-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-150">
                  <t.icon className="w-3.5 h-3.5" />
                </span>
                <span className="text-[13px] font-medium text-foreground truncate">{t.label}</span>
              </Link>
            ) : (
              <div
                key={t.label}
                aria-disabled
                title="Coming soon"
                className="flex items-center gap-2.5 rounded-xl bg-card/60 border border-dashed border-border px-3.5 py-3 cursor-default"
              >
                <span className="w-7 h-7 rounded-lg bg-surface grid place-items-center text-muted-foreground">
                  <t.icon className="w-3.5 h-3.5" />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-[13px] font-medium text-muted-foreground truncate">
                    {t.label}
                  </span>
                  <span className="block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Soon
                  </span>
                </span>
              </div>
            ),
          )}
        </div>

        {/* Feature banner */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="grid md:grid-cols-[1fr_240px] items-stretch">
            <div className="p-6 md:p-8">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">What you can do today</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-[13px] text-foreground max-w-md">
                {[
                  "The whole edit, made automatically",
                  "Motion graphics on your words",
                  "AI story scenes",
                  "Word-by-word captions",
                  "Studio sound: voice cleanup & mastering",
                  "Colour correction & five looks",
                  "Music & SFX, quieter under your voice",
                  "Auto-cut silences",
                  "Voiceovers: your mic or AI voice",
                  "9:16, 16:9 & 1:1 exports",
                ].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="text-muted-foreground">{f}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative bg-primary/10 border-t md:border-t-0 md:border-l border-border text-foreground p-6 md:p-8 flex flex-col justify-between overflow-hidden">
              <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">Coming next</div>
                <ul className="space-y-1 text-[12.5px] text-foreground/80">
                  {["AI video scenes: short generated clips in your edit"].map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
              <Button
                size="sm"
                className="relative mt-4 w-fit"
                onClick={() => navigate({ to: "/projects/new" })}
              >
                Start a project <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Recent projects */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="caps-label text-[15px] text-foreground">Recent projects</h2>
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
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
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
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {recent.map((p) => (
                <Link
                  key={p.id}
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="group block"
                >
                  <Card className="p-2.5 hover:border-primary/40 hover:bg-surface transition-all duration-150 cursor-pointer">
                    <CardContent className="p-0">
                      <ProjectThumb ratio={p.aspect_ratio} title={p.title} src={p.thumbnail_signed_url} />
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

/** "Soon": shown on things that aren't built yet. */
function SoonTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full bg-surface-2 border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      Soon
    </span>
  );
}

function CreateCard({
  title,
  desc,
  visual,
  onClick,
  soon = false,
}: {
  title: string;
  desc: string;
  visual: React.ReactNode;
  /** Opens it (not given for things that aren't built yet). */
  onClick?: () => void;
  /** Not built yet: shown as coming soon, not clickable. */
  soon?: boolean;
}) {
  return (
    <Card
      onClick={soon ? undefined : onClick}
      aria-disabled={soon || undefined}
      className={cn(
        "group relative overflow-hidden transition-all duration-150",
        soon
          ? "cursor-default opacity-75"
          : "cursor-pointer hover:border-primary/40 hover:-translate-y-0.5",
      )}
    >
      <div className="h-[172px] overflow-hidden border-b border-border">{visual}</div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="caps-label text-[14px] text-foreground">{title}</div>
          {soon ? (
            <SoonTag />
          ) : (
            <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all shrink-0" />
          )}
        </div>
        <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">{desc}</p>
      </CardContent>
    </Card>
  );
}
