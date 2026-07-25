import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Upload, Search, Film, Trash2, Loader2, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAllClips, removeClip, getClipSignedUrl } from "@/lib/projects.functions";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/assets")({
  head: () => ({ meta: [{ title: "Assets — Stuccord Motion" }] }),
  component: AssetsPage,
});

function formatBytes(n: number | null) {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function AssetsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const fetchClips = useServerFn(listAllClips);
  const removeFn = useServerFn(removeClip);
  const signFn = useServerFn(getClipSignedUrl);

  const { data: clips, isLoading } = useQuery({
    queryKey: ["all-clips"],
    queryFn: () => fetchClips(),
  });

  const del = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Clip removed");
      qc.invalidateQueries({ queryKey: ["all-clips"] });
      qc.invalidateQueries({ queryKey: ["usage-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (clips ?? []).filter(
    (c) =>
      !q ||
      c.filename.toLowerCase().includes(q.toLowerCase()) ||
      c.project_title.toLowerCase().includes(q.toLowerCase()),
  );

  async function preview(path: string) {
    try {
      const { url } = await signFn({ data: { path } });
      window.open(url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open clip");
    }
  }

  const totalBytes = (clips ?? []).reduce((sum, c) => sum + (c.size_bytes ?? 0), 0);

  return (
    <AppShell
      title="Assets"
      subtitle="Every clip you've uploaded across your projects — reuse, preview, or remove."
      actions={<Button onClick={() => navigate({ to: "/projects/new" })}><Upload className="w-4 h-4" /> New project</Button>}
    >
      <div className="grid gap-4 grid-cols-3 mb-5">
        <div className="bg-white border border-black/5 rounded-xl p-4">
          <div className="text-xs font-medium text-neutral-500">Total clips</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{clips?.length ?? 0}</div>
        </div>
        <div className="bg-white border border-black/5 rounded-xl p-4">
          <div className="text-xs font-medium text-neutral-500">Storage used</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{formatBytes(totalBytes)}</div>
        </div>
        <div className="bg-white border border-black/5 rounded-xl p-4">
          <div className="text-xs font-medium text-neutral-500">Latest upload</div>
          <div className="mt-2 text-sm font-medium truncate">
            {clips?.[0] ? formatDistanceToNow(new Date(clips[0].created_at), { addSuffix: true }) : "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="text-sm font-semibold">Clip library</div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clips or projects…"
            className="w-full h-9 pl-8 pr-3 text-sm bg-white border border-black/5 rounded-md focus:border-black/20 focus:outline-none" />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl bg-white border border-black/5 p-10 text-center text-sm text-neutral-500">
          <Loader2 className="w-4 h-4 mx-auto animate-spin mb-2" /> Loading your clips…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-black/10 bg-white/50 p-12 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-violet-50 text-violet-600 grid place-items-center mb-3">
            <Upload className="w-5 h-5" />
          </div>
          <div className="text-sm font-semibold">No clips yet</div>
          <div className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
            Start a project and upload your footage — every clip you add there shows up here for reuse.
          </div>
          <div className="mt-5">
            <Button onClick={() => navigate({ to: "/projects/new" })}>
              <Upload className="w-4 h-4" /> Start a project
            </Button>
          </div>
        </div>
      ) : (
        <ul className="rounded-2xl bg-white border border-black/5 divide-y divide-black/5 overflow-hidden">
          {filtered.map((c) => (
            <li key={c.id} className="flex items-center gap-3 p-3 hover:bg-neutral-50">
              <div className="w-10 h-10 grid place-items-center rounded-lg bg-neutral-100 shrink-0">
                <Film className="w-4 h-4 text-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.filename}</div>
                <div className="text-[11px] text-neutral-500 flex items-center gap-2 mt-0.5">
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: c.project_id }}
                    className="hover:text-neutral-900 hover:underline truncate"
                  >
                    {c.project_title}
                  </Link>
                  <span>·</span>
                  <span>{formatBytes(c.size_bytes)}</span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                </div>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider bg-neutral-100 rounded px-1.5 py-0.5 text-neutral-600">
                {c.aspect_ratio}
              </span>
              <button
                onClick={() => preview(c.storage_path)}
                className="p-1.5 rounded-md hover:bg-black/5"
                title="Preview"
              >
                <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
              </button>
              <button
                onClick={() => {
                  if (confirm(`Remove "${c.filename}"? This deletes the file from storage.`)) {
                    del.mutate(c.id);
                  }
                }}
                className="p-1.5 rounded-md hover:bg-red-50 text-neutral-500 hover:text-red-600"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
