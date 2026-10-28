import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUsageStats } from "@/lib/projects.functions";
import { useWorkspace } from "@/lib/use-workspace";
import { listPosts } from "@/lib/publishing.functions";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Eye, Play, Clock, TrendingUp, Film, TrendingDown, ThumbsUp, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { presetLabel } from "@/lib/presets";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Stuccord Motion" }] }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const fetchStats = useServerFn(getUsageStats);
  const ws = useWorkspace();
  const { data, isLoading } = useQuery({
    queryKey: ["usage-stats", ws.id],
    queryFn: () => fetchStats({ data: { workspace: ws.id } }),
  });
  const fetchPosts = useServerFn(listPosts);
  const posts = useQuery({
    queryKey: ["social-posts", ws.id],
    queryFn: () => fetchPosts({ data: { workspace: ws.id } }),
    retry: false,
  });

  // Reach from posted videos (view counts are updated daily).
  const reach = useMemo(() => {
    const posted = (posts.data ?? []).filter((p) => p.status === "published");
    const sum = (k: "views" | "likes") => posted.reduce((a, p) => a + (p[k] ?? 0), 0);
    const top = [...posted].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 5);
    return { count: posted.length, views: sum("views"), likes: sum("likes"), top };
  }, [posts.data]);
  const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);

  const chart = useMemo(() => {
    const days = data?.days ?? [];
    const points = days.map((d) => d.renders);
    const max = Math.max(1, ...points);
    const last15 = points.slice(-15).reduce((a, b) => a + b, 0);
    const prev15 = points.slice(0, 15).reduce((a, b) => a + b, 0);
    const delta = prev15 === 0 ? (last15 > 0 ? 100 : 0) : Math.round(((last15 - prev15) / prev15) * 100);
    return { points, max, delta };
  }, [data]);

  const total = data?.totalProjects ?? 0;
  const ready = data?.readyProjects ?? 0;
  const minutes = data?.totalMinutes ?? 0;
  const topPreset = data?.topPreset ?? null;
  const formatMix = data?.formatMix ?? [];

  return (
    <AppShell title="Analytics" subtitle="Live numbers from your studio — updates in real time.">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Projects created" value={total} icon={Film} tone="primary" />
        <StatCard label="Shorts rendered" value={ready} icon={Play} tone="success" />
        <StatCard label="Minutes rendered" value={`${minutes}m`} icon={Clock} />
        <StatCard
          label="Views on posted videos"
          value={reach.count ? compact(reach.views) : "—"}
          icon={Eye}
          tone={reach.count ? "primary" : "muted"}
          trend={
            reach.count
              ? `${reach.count} post${reach.count === 1 ? "" : "s"} · ${compact(reach.likes)} likes`
              : "Post a video from Publishing"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl bg-white border border-black/5 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-sm font-semibold">Renders over the last 30 days</div>
              <div className="text-xs text-neutral-500 mt-0.5">
                {isLoading ? "Loading…" : `${chart.points.reduce((a, b) => a + b, 0)} renders total`}
              </div>
            </div>
            {!isLoading && chart.points.some((p) => p > 0) && (
              <div className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full",
                chart.delta >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50",
              )}>
                {chart.delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {chart.delta >= 0 ? "+" : ""}{chart.delta}% vs prior 15d
              </div>
            )}
          </div>
          <div className="h-56 relative">
            {chart.points.length === 0 || chart.points.every((p) => p === 0) ? (
              <div className="absolute inset-0 grid place-items-center text-xs text-neutral-400">
                No renders yet — your chart fills in as you ship projects.
              </div>
            ) : (
              <svg viewBox="0 0 300 120" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 30, 60, 90, 120].map((y) => (
                  <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#0000000a" />
                ))}
                <path
                  d={
                    `M0 ${120 - (chart.points[0] / chart.max) * 100} ` +
                    chart.points.map((p, i) => `L${(i / (chart.points.length - 1)) * 300} ${120 - (p / chart.max) * 100}`).join(" ") +
                    ` L300 120 L0 120 Z`
                  }
                  fill="url(#fill)"
                />
                <path
                  d={
                    `M0 ${120 - (chart.points[0] / chart.max) * 100} ` +
                    chart.points.map((p, i) => `L${(i / (chart.points.length - 1)) * 300} ${120 - (p / chart.max) * 100}`).join(" ")
                  }
                  fill="none"
                  stroke="#7C3AED"
                  strokeWidth="1.5"
                />
              </svg>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-neutral-400 mt-2 font-mono">
            <span>30d ago</span><span>15d</span><span>today</span>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-black/5 p-5">
          <div className="text-sm font-semibold mb-4">Format mix</div>
          {formatMix.every((r) => r.count === 0) ? (
            <div className="text-xs text-neutral-500 py-8 text-center">
              No projects yet.
            </div>
          ) : (
            <div className="space-y-4">
              {formatMix.map((r) => (
                <div key={r.ratio}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-neutral-700">
                      {r.ratio === "9:16" ? "9:16 vertical" : r.ratio === "16:9" ? "16:9 landscape" : "1:1 square"}
                    </span>
                    <span className="font-medium tabular-nums">{r.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                    <div
                      className={cn(
                        "h-full",
                        r.ratio === "9:16" ? "bg-violet-500" : r.ratio === "16:9" ? "bg-blue-500" : "bg-emerald-500",
                      )}
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-black/5">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">Top style</div>
            {topPreset ? (
              <div className="rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 p-3 text-white">
                <div className="text-[10px] uppercase tracking-wider text-white/70">Preset</div>
                <div className="text-sm font-semibold mt-0.5">{presetLabel(topPreset.preset)}</div>
                <div className="text-[11px] text-white/70 mt-1">Used in {topPreset.count} project{topPreset.count === 1 ? "" : "s"}</div>
              </div>
            ) : (
              <div className="text-xs text-neutral-500">No style preferences yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white border border-black/5 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold">Top posts</div>
            <div className="text-xs text-neutral-500 mt-0.5">Views are updated once a day.</div>
          </div>
          <Link to="/publishing" className="text-xs font-medium text-violet-700 hover:underline">
            Publishing
          </Link>
        </div>
        {reach.top.length === 0 ? (
          <div className="text-xs text-neutral-500 py-6 text-center">
            Nothing posted yet. Publish a video and its views show here.
          </div>
        ) : (
          <div className="divide-y divide-black/5">
            {reach.top.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {p.title || p.caption.split("\n")[0] || "Post"}
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate">
                    {p.account_name}
                    {p.published_at ? ` · ${new Date(p.published_at).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <span className="flex items-center gap-1 text-xs tabular-nums text-neutral-700">
                  <Eye className="w-3.5 h-3.5" /> {p.views == null ? "—" : compact(p.views)}
                </span>
                <span className="flex items-center gap-1 text-xs tabular-nums text-neutral-500">
                  <ThumbsUp className="w-3.5 h-3.5" /> {p.likes == null ? "—" : compact(p.likes)}
                </span>
                {p.external_url && (
                  <a
                    href={p.external_url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open post"
                    className="text-violet-700"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, icon: Icon, tone = "default", trend }: {
  label: string; value: string | number; icon: typeof Film;
  tone?: "default" | "primary" | "success" | "muted"; trend?: string;
}) {
  const toneMap = {
    default: "bg-neutral-100 text-neutral-600",
    primary: "bg-violet-100 text-violet-700",
    success: "bg-emerald-100 text-emerald-700",
    muted: "bg-neutral-100 text-neutral-400",
  };
  return (
    <div className="bg-white border border-black/5 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-neutral-500">{label}</div>
        <div className={cn("w-7 h-7 rounded-lg grid place-items-center", toneMap[tone])}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {trend && <div className="text-[11px] text-neutral-500 mt-1">{trend}</div>}
    </div>
  );
}
