import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import {
  listProjects,
  deleteProject,
  moveProject,
  getClipSignedUrl,
  setClipThumbnail,
} from "@/lib/projects.functions";
import { useThumbnailMaker } from "@/lib/clip-thumbnails";
import { useWorkspace } from "@/lib/use-workspace";
import { PERSONAL } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Film,
  MoreHorizontal,
  Trash2,
  User,
  Users,
  Clock,
  Search,
  LayoutGrid,
  Rows3,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { presetLabel } from "@/lib/presets";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — Stuccord Motion" }] }),
  component: ProjectsPage,
});

type StatusKey = "draft" | "queued" | "processing" | "ready" | "failed";

const STATUS_META: Record<StatusKey, { label: string; className: string; dot: string }> = {
  draft: { label: "Draft", className: "bg-surface-2 text-muted-foreground", dot: "bg-muted-foreground/60" },
  queued: { label: "Queued", className: "bg-amber-500/10 text-amber-300", dot: "bg-amber-500" },
  processing: { label: "Rendering", className: "bg-blue-500/10 text-blue-300", dot: "bg-blue-500 animate-pulse" },
  ready: { label: "Ready", className: "bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-500" },
  failed: { label: "Failed", className: "bg-red-500/10 text-red-300", dot: "bg-red-500" },
};

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status as StatusKey] ?? STATUS_META.draft;
  return (
    <Badge variant="outline" className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border-0", meta.className)}>
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
    <div className={cn("relative w-full overflow-hidden rounded-lg bg-surface-2", box)}
      style={src ? undefined : { background: `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 65% 40%))` }}>
      {src ? (
        <img src={src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)]" />
          <div className="absolute inset-0 grid place-items-center"><Film className="w-6 h-6 text-white/80" /></div>
        </>
      )}
      <div className="absolute bottom-1.5 right-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
        {ratio}
      </div>
    </div>
  );
}

function ProjectsPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fetchProjects = useServerFn(listProjects);
  const removeProject = useServerFn(deleteProject);
  const ws = useWorkspace();
  const key = ["projects", ws.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchProjects({ data: { workspace: ws.id } }),
  });

  // Projects without a thumbnail get one in the background; the list
  // refreshes (at most every couple of seconds) as they come in.
  const signFn = useServerFn(getClipSignedUrl);
  const recordThumbFn = useServerFn(setClipThumbnail);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useThumbnailMaker(
    (data ?? []).flatMap((p) => (p.thumbnail_source ? [p.thumbnail_source] : [])),
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

  const moveFn = useServerFn(moveProject);
  const move = useMutation({
    mutationFn: (v: { id: string; to: string }) => moveFn({ data: v }),
    onSuccess: (_r, v) => {
      const name = v.to === PERSONAL ? "your personal space" : (ws.teams.find((t) => t.id === v.to)?.name ?? "the team");
      toast.success(`Moved to ${name}`);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["all-clips"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** The project's menu: move it, delete it (what the caller may do). */
  function ProjectMenu({
    p,
    onDelete,
    onMove,
  }: {
    p: NonNullable<typeof data>[number];
    onDelete: () => void;
    onMove: (to: string) => void;
  }) {
    // Into a team: whoever made it, to teams where they edit.
    const intoTeams = !p.team_id && p.made_by_you ? ws.teams.filter((t) => t.role !== "viewer") : [];
    // Out of a team: its owner and admins.
    const outOfTeam = !!p.team_id && (ws.team?.role === "owner" || ws.team?.role === "admin");
    if (!intoTeams.length && !outOfTeam && !p.can_delete) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-md hover:bg-white/5"
            onClick={(e) => e.stopPropagation()}
            aria-label={`More for ${p.title}`}
          >
            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {intoTeams.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Move "${p.title}" to ${t.name}? Everyone in the team will be able to open it.`)) onMove(t.id);
              }}
            >
              <Users className="w-4 h-4 mr-2" /> Move to {t.name}
            </DropdownMenuItem>
          ))}
          {outOfTeam && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Move "${p.title}" out of the team to your personal space? Only you will have it.`)) onMove(PERSONAL);
              }}
            >
              <User className="w-4 h-4 mr-2" /> Move to Personal
            </DropdownMenuItem>
          )}
          {(intoTeams.length > 0 || outOfTeam) && p.can_delete && <DropdownMenuSeparator />}
          {p.can_delete && (
            <DropdownMenuItem
              className="text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${p.title}"?`)) onDelete();
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | StatusKey>("all");
  const [view, setView] = useState<"grid" | "list">("grid");

  const del = useMutation({
    mutationFn: (id: string) => removeProject({ data: { id } }),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<any[]>(key);
      queryClient.setQueryData(key, (old: any[] | undefined) =>
        (old ?? []).filter((p) => p.id !== id)
      );
      return { previous };
    },
    onError: (e: Error, _id, context) => {
      toast.error(e.message);
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["usage-stats"] });
      router.invalidate();
    },
  });

  const filtered = useMemo(() => {
    const list = data ?? [];
    return list.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (q && !p.title.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [data, q, filter]);

  const filterTabs: { key: "all" | StatusKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "processing", label: "Rendering" },
    { key: "ready", label: "Ready" },
    { key: "draft", label: "Drafts" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <AppShell
      title="Projects"
      subtitle={ws.team ? `${ws.team.name}'s projects: everyone in the team can open them.` : "Every short you've briefed, rendered, or shipped."}
      actions={<Button onClick={() => navigate({ to: "/projects/new" })} disabled={!ws.canEdit}><Plus className="w-4 h-4" /> New project</Button>}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-1 bg-card border border-border rounded-lg p-1">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "px-3 h-8 text-xs font-medium rounded-md transition-colors",
                filter === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-surface-2",
              )}
            >{t.label}</button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by title…"
              className="pl-8 h-9 text-sm bg-card border-border focus:border-white/15"
            />
          </div>
          <div className="hidden sm:flex items-center bg-card border border-border rounded-md p-0.5">
            <button onClick={() => setView("grid")}
              className={cn("w-8 h-8 grid place-items-center rounded", view === "grid" ? "bg-foreground text-background" : "text-muted-foreground")}
              aria-label="Grid view"><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")}
              className={cn("w-8 h-8 grid place-items-center rounded", view === "list" ? "bg-foreground text-background" : "text-muted-foreground")}
              aria-label="List view"><Rows3 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 bg-card border border-border rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <div className="mx-auto w-11 h-11 rounded-full bg-violet-500/10 text-violet-400 grid place-items-center mb-3">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-sm font-medium">No projects yet.</div>
          <div className="text-xs text-muted-foreground mt-1">Start your first short — usually done in under 5 minutes.</div>
          <Button className="mt-5" onClick={() => navigate({ to: "/projects/new" })}>
            <Plus className="w-4 h-4" /> New project
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center bg-card">
          <div className="mx-auto w-10 h-10 grid place-items-center rounded-full bg-surface-2 mb-3">
            <Search className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium">No matching projects</div>
          <div className="text-xs text-muted-foreground mt-1">Try a different filter or search term.</div>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <div key={p.id} className="group relative bg-card border border-border rounded-2xl p-2.5 sm:p-3 hover:border-primary/40 hover:bg-surface transition-all">
              <Link to="/projects/$projectId" params={{ projectId: p.id }} className="absolute inset-0 rounded-2xl" aria-label={p.title} />
              <ProjectThumb ratio={p.aspect_ratio} title={p.title} src={p.thumbnail_signed_url} />
              <div className="mt-3 flex items-start justify-between gap-2 px-0.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{p.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 px-0.5">
                <StatusPill status={p.status} />
                <div className="relative z-10 flex items-center gap-1">
                  <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{presetLabel(p.style_preset)}</span>
                  <ProjectMenu p={p} onDelete={() => del.mutate(p.id)} onMove={(to) => move.mutate({ id: p.id, to })} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_120px_120px_140px_40px] gap-4 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground border-b border-border bg-surface">
            <div>Project</div><div>Status</div><div>Format</div><div>Created</div><div />
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((p) => (
              <li key={p.id} className="group relative grid grid-cols-[1fr_auto] md:grid-cols-[1fr_120px_120px_140px_40px] gap-3 md:gap-4 items-center px-4 py-3 hover:bg-surface transition-colors">
                <Link to="/projects/$projectId" params={{ projectId: p.id }} className="absolute inset-0" aria-label={p.title} />
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0"><ProjectThumb ratio="1:1" title={p.title} src={p.thumbnail_signed_url} /></div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.title}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{presetLabel(p.style_preset)}</div>
                  </div>
                </div>
                <div className="hidden md:block"><StatusPill status={p.status} /></div>
                <div className="hidden md:block text-xs text-muted-foreground">{p.aspect_ratio}</div>
                <div className="hidden md:block text-xs text-muted-foreground">{formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</div>
                <div className="relative z-10 justify-self-end">
                  <ProjectMenu p={p} onDelete={() => del.mutate(p.id)} onMove={(to) => move.mutate({ id: p.id, to })} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
