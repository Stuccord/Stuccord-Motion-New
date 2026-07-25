import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useState } from "react";
import { TEMPLATES, TEMPLATE_CATS } from "@/lib/templates.data";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({ meta: [{ title: "Templates — Stuccord Motion" }] }),
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

  const useTemplate = (id: string) => {
    navigate({ to: "/projects/new", search: { template: id } as never });
  };

  return (
    <AppShell
      title="Templates"
      subtitle="Battle-tested formats — pick one and swap in your footage."
      actions={<Button onClick={() => navigate({ to: "/projects/new" })}>Start from blank</Button>}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search templates…"
            className="w-full h-9 pl-8 pr-3 text-sm bg-white border border-black/5 rounded-md focus:border-black/20 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 bg-white border border-black/5 rounded-lg p-1 overflow-x-auto">
          {TEMPLATE_CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={cn(
                "px-3 h-8 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                cat === c ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100",
              )}>{c}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((t) => (
          <button key={t.id} onClick={() => useTemplate(t.id)}
            className="group relative overflow-hidden rounded-2xl border border-black/5 bg-white text-left hover:border-black/20 hover:shadow-[0_10px_40px_-16px_rgba(0,0,0,0.2)] transition-all">
            <div className={cn("relative h-40 bg-gradient-to-br", t.gradient)}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.35),transparent_60%)]" />
              <div className="absolute inset-0 p-4 flex items-start justify-between">
                <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur grid place-items-center">
                  <t.icon className="w-4 h-4 text-white" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono font-medium text-white/90 bg-black/25 backdrop-blur rounded px-1.5 py-0.5">{t.ratio}</span>
                  <span className="text-[10px] font-mono font-medium text-white/90 bg-black/25 backdrop-blur rounded px-1.5 py-0.5">{t.duration}</span>
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-medium">{t.cat}</div>
              </div>
            </div>
            <div className="p-4">
              <div className="text-sm font-semibold">{t.title}</div>
              <div className="text-xs text-neutral-500 mt-1 line-clamp-2">{t.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </AppShell>
  );
}
