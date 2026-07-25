import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listProjects, deleteProject } from "@/lib/projects.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Film,
  MoreHorizontal,
  Trash2,
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
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — Stuccord Motion" }] }),
  component: ProjectsPage,
});

type StatusKey = "draft" | "queued" | "processing" | "ready" | "failed";

const STATUS_META: Record<StatusKey, { label: string; className: string; dot: string }> = {
  draft: { label: "Draft", className: "bg-neutral-100 text-neutral-600", dot: "bg-neutral-400" },
  queued: { label: "Queued", className: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  processing: { label: "Rendering", className: "bg-blue-50 text-blue-700", dot: "bg-blue-500 animate-pulse" },
  ready: { label: "Ready", className: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700", dot: "bg-red-500" },
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

function ProjectThumb({ ratio, title }: { ratio: string; title: string }) {
  const seed = title.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue1 = (seed * 37) % 360;
  const hue2 = (hue1 + 60) % 360;
  const box = ratio === "9:16" ? "aspect-[9/16]" : ratio === "1:1" ? "aspect-square" : "aspect-video";
  return (
    <div className={cn("relative w-full overflow-hidden rounded-lg", box)}
      style={{ background: `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 65% 40%))` }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)]" />
      <div className="absolute inset-0 grid place-items-center"><Film className="w-6 h-6 text-white/80" /></div>
      <div className="absolute bottom-1.5 right-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
        {ratio}
      </div>
    </div>
  );
}

function ProjectsPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const fetchProjects = useServerFn(listProjects);
  const removeProject = useServerFn(deleteProject);
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => fetchProjects() });

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | StatusKey>("all");
  const [view, setView] = useState<"grid" | "list">("grid");

  const del = useMutation({
    mutationFn: (id: string) => removeProject({ data: { id } }),
    onSuccess: () => { toast.success("Project deleted"); router.invalidate(); },
    onError: (e: Error) => toast.error(e.message),
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
      subtitle="Every short you've briefed, rendered, or shipped."
      actions={<Button onClick={() => navigate({ to: "/projects/new" })}><Plus className="w-4 h-4" /> New project</Button>}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-1 bg-white border border-black/5 rounded-lg p-1">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "px-3 h-8 text-xs font-medium rounded-md transition-colors",
                filter === t.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100",
              )}
            >{t.label}</button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by title…"
              className="pl-8 h-9 text-sm bg-white border-black/10 focus:border-black/30"
            />
          </div>
          <div className="hidden sm:flex items-center bg-white border border-black/5 rounded-md p-0.5">
            <button onClick={() => setView("grid")}
              className={cn("w-8 h-8 grid place-items-center rounded", view === "grid" ? "bg-neutral-900 text-white" : "text-neutral-500")}
              aria-label="Grid view"><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")}
              className={cn("w-8 h-8 grid place-items-center rounded", view === "list" ? "bg-neutral-900 text-white" : "text-neutral-500")}
              aria-label="List view"><Rows3 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 bg-white border border-black/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white p-12 text-center">
          <div className="mx-auto w-11 h-11 rounded-full bg-violet-50 text-violet-600 grid place-items-center mb-3">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-sm font-medium">No projects yet.</div>
          <div className="text-xs text-neutral-500 mt-1">Start your first short — usually done in under 5 minutes.</div>
          <Button className="mt-5" onClick={() => navigate({ to: "/projects/new" })}>
            <Plus className="w-4 h-4" /> New project
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-black/10 rounded-2xl p-12 text-center bg-white">
          <div className="mx-auto w-10 h-10 grid place-items-center rounded-full bg-neutral-100 mb-3">
            <Search className="w-4 h-4 text-neutral-500" />
          </div>
          <div className="text-sm font-medium">No matching projects</div>
          <div className="text-xs text-neutral-500 mt-1">Try a different filter or search term.</div>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="group relative bg-white border border-black/5 rounded-2xl p-4 hover:border-black/20 hover:shadow-[0_4px_20px_-8px_rgba(0,0,0,0.1)] transition-all">
              <Link to="/projects/$projectId" params={{ projectId: p.id }} className="absolute inset-0 rounded-2xl" aria-label={p.title} />
              <ProjectThumb ratio={p.aspect_ratio} title={p.title} />
              <div className="mt-4 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{p.title}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <StatusPill status={p.status} />
                <div className="relative z-10 flex items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium">{p.style_preset}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded-md hover:bg-black/5" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="w-4 h-4 text-neutral-500" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-red-600" onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${p.title}"?`)) del.mutate(p.id);
                      }}>
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-black/5 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_120px_120px_140px_40px] gap-4 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-neutral-500 border-b border-black/5 bg-neutral-50">
            <div>Project</div><div>Status</div><div>Format</div><div>Created</div><div />
          </div>
          <ul className="divide-y divide-black/5">
            {filtered.map((p) => (
              <li key={p.id} className="group relative grid grid-cols-[1fr_auto] md:grid-cols-[1fr_120px_120px_140px_40px] gap-3 md:gap-4 items-center px-4 py-3 hover:bg-neutral-50 transition-colors">
                <Link to="/projects/$projectId" params={{ projectId: p.id }} className="absolute inset-0" aria-label={p.title} />
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0"><ProjectThumb ratio="1:1" title={p.title} /></div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.title}</div>
                    <div className="text-[11px] text-neutral-500 truncate">{p.style_preset}</div>
                  </div>
                </div>
                <div className="hidden md:block"><StatusPill status={p.status} /></div>
                <div className="hidden md:block text-xs text-neutral-500">{p.aspect_ratio}</div>
                <div className="hidden md:block text-xs text-neutral-500">{formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</div>
                <div className="relative z-10 justify-self-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1.5 rounded-md hover:bg-black/5" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="w-4 h-4 text-neutral-500" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-red-600" onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${p.title}"?`)) del.mutate(p.id);
                      }}>
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
