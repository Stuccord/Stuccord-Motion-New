import { useWorkspace } from "@/lib/use-workspace";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createProject, attachClip, getSignedClipUploadUrl } from "@/lib/projects.functions";
import { probeFileDurationMs } from "@/lib/media-duration";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadCloud, X, Loader2, Film, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { TEMPLATES } from "@/lib/templates.data";
import { NEW_PROJECT_STYLES } from "@/lib/presets";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-rules";
import { z } from "zod";

const searchSchema = z.object({
  template: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/projects/new")({
  head: () => ({ meta: [{ title: "New project — Stuccord Motion" }] }),
  validateSearch: (search) => searchSchema.parse(search),
  component: NewProject,
});

type PendingFile = {
  id: string;
  file: File;
  role: "auto" | "aroll" | "broll";
  progress: number;
  uploaded: boolean;
  storagePath?: string;
  error?: string;
};

function NewProject() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const createFn = useServerFn(createProject);
  const ws = useWorkspace();
  const attachFn = useServerFn(attachClip);
  const getSignedClipUploadFn = useServerFn(getSignedClipUploadUrl);
  
  const inputRef = useRef<HTMLInputElement>(null);

  const template = useMemo(
    () => (search.template ? TEMPLATES.find((t) => t.id === search.template) : undefined),
    [search.template],
  );

  const [title, setTitle] = useState(template ? template.title : "");
  const [script, setScript] = useState("");
  const [brief, setBrief] = useState(template?.brief ?? "");
  // The style: Motion Explainer unless the template is one of the others.
  const [preset, setPreset] = useState<string>(
    NEW_PROJECT_STYLES.find((s) => s.id === template?.preset)?.id ?? "gadzhi",
  );
  const [ratio, setRatio] = useState<"9:16" | "16:9" | "1:1">(template?.ratio ?? "9:16");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) => f.type.startsWith("video/"));
    setFiles((prev) => [
      ...prev,
      ...arr.map((file) => ({
        id: crypto.randomUUID(),
        file,
        role: "auto" as const,
        progress: 0,
        uploaded: false,
      })),
    ]);
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function setRole(id: string, role: "auto" | "aroll" | "broll") {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, role } : f)));
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Give your project a title");
      if (files.length === 0) throw new Error("Upload at least one video clip");
      // Checked before the project is made, so a too-big file doesn't leave an empty project.
      const tooBig = files.find((f) => f.file.size > MAX_UPLOAD_BYTES);
      if (tooBig) throw new Error(`${tooBig.file.name} is over the ${MAX_UPLOAD_MB} MB limit`);

      const project = await createFn({
        data: {
          title: title.trim(),
          script: script || null,
          brief: brief || null,
          style_preset: preset,
          aspect_ratio: ratio,
          team_id: ws.team?.id ?? null,
        },
      });

      // Upload each file to storage via signed upload URL, then attach to project
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const contentType = f.file.type || "video/mp4";
        const { data: authData } = await supabase.auth.getSession();
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (authData?.session?.access_token) {
          headers["Authorization"] = `Bearer ${authData.session.access_token}`;
        }

        const presignRes = await fetch("/api/authenticated/uploads/presign", {
          method: "POST",
          headers,
          body: JSON.stringify({
            projectId: project.id,
            filename: f.file.name,
            contentType,
            size: f.file.size,
          }),
        });

        if (!presignRes.ok) {
          const errText = await presignRes.text().catch(() => "Upload presign failed");
          throw new Error(`${f.file.name}: ${errText}`);
        }

        const { bucket, path, token } = (await presignRes.json()) as {
          bucket: string;
          path: string;
          token: string;
        };

        const { error: upErr } = await supabase.storage
          .from(bucket)
          .uploadToSignedUrl(path, token, f.file, {
            contentType,
            upsert: true,
          });

        if (upErr) {
          setFiles((prev) =>
            prev.map((x) => (x.id === f.id ? { ...x, error: upErr.message } : x)),
          );
          throw new Error(`${f.file.name}: ${upErr.message}`);
        }

        setFiles((prev) =>
          prev.map((x) =>
            x.id === f.id ? { ...x, uploaded: true, progress: 100, storagePath: path } : x,
          ),
        );

        // Record the clip's real length so the editor timeline draws it correctly.
        const durationMs = await probeFileDurationMs(f.file);
        await attachFn({
          data: {
            project_id: project.id,
            storage_path: path,
            filename: f.file.name,
            size_bytes: f.file.size,
            role: f.role,
            ordinal: i,
            duration_ms: durationMs ?? undefined,
          },
        });
      }

      // Clips are attached: the app now makes the video by itself (the make page).
      return { project };
    },
    onSuccess: ({ project }) => {
      toast.success("Project created — making your video");
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["usage-stats"] });
      qc.invalidateQueries({ queryKey: ["all-clips"] });
      navigate({ to: "/projects/$projectId/make", params: { projectId: project.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="max-w-3xl">
        <div className="caps-label text-[11px] text-primary-glow mb-2">Motion Explainer · auto-edit</div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">New project</h1>
        {ws.team && (
          <p className="text-sm text-muted-foreground mt-1" data-new-in-team>
            {ws.canEdit
              ? `Made in ${ws.team.name}: everyone in the team can open it.`
              : `You're a Viewer in ${ws.team.name}, so you can't make projects there. Switch to Personal or ask an admin.`}
          </p>
        )}
        <p className="text-sm text-muted-foreground mt-1">
          Drop your clips, add your script if you have one, and the AI plans the graphics from
          what you say.
        </p>

        {template && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 to-fuchsia-500/10 p-4">
            <div className="w-9 h-9 rounded-lg bg-card grid place-items-center shrink-0 shadow-sm">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-violet-300">Using template</div>
              <div className="text-sm font-semibold mt-0.5">{template.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Look, shape and brief pre-filled — change anything below.
              </div>
            </div>
            <button
              onClick={() => navigate({ to: "/projects/new", search: {} as never })}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              Clear
            </button>
          </div>
        )}

        <div className="mt-8 space-y-5 pb-24 sm:pb-0">
          <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
            <h2 className="flex items-center gap-2.5 text-base font-semibold"><span className="grid place-items-center w-6 h-6 rounded-full bg-primary/15 border border-primary/30 text-[11px] font-bold text-primary-glow font-display">1</span>Title & format</h2>
            <div className="grid grid-cols-1 gap-4 mt-4 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="title">Project title</Label>
                <Input
                  id="title"
                  placeholder="Ep. 14 — Why nobody watches your reels"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Aspect ratio</Label>
                <Select value={ratio} onValueChange={(v) => setRatio(v as typeof ratio)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="9:16">9:16 — Reels / Shorts / TikTok</SelectItem>
                    <SelectItem value="16:9">16:9 — YouTube long-form</SelectItem>
                    <SelectItem value="1:1">1:1 — Feed square</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Style preset</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NEW_PROJECT_STYLES.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
            <h2 className="flex items-center gap-2.5 text-base font-semibold"><span className="grid place-items-center w-6 h-6 rounded-full bg-primary/15 border border-primary/30 text-[11px] font-bold text-primary-glow font-display">2</span>Upload your clips</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Your talking clips (A-roll) and any B-roll. They go on the timeline in the order
              you add them; mark each one or leave it on auto-detect.
            </p>
            <div
              className={`mt-4 border-2 border-dashed rounded-2xl px-6 py-10 sm:py-12 text-center cursor-pointer transition-colors ${
                dragOver ? "border-primary bg-primary/10" : "border-white/15 bg-white/[0.02] hover:border-primary/60 hover:bg-primary/[0.04]"
              }`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 grid place-items-center">
                <UploadCloud className="w-6 h-6 text-primary-glow" />
              </div>
              <p className="mt-4 text-base font-semibold">Drop videos or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">
                MP4, MOV, WebM · up to {MAX_UPLOAD_MB} MB per clip
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="video/*"
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <ul className="mt-4 divide-y divide-border border border-border rounded-xl">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 p-3">
                    <div className="w-9 h-9 grid place-items-center rounded-md bg-surface-2">
                      <Film className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{f.file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {(f.file.size / 1024 / 1024).toFixed(1)} MB
                        {f.error && <span className="text-red-400 ml-2">· {f.error}</span>}
                      </div>
                    </div>
                    <Select value={f.role} onValueChange={(v) => setRole(f.id, v as PendingFile["role"])}>
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto-detect</SelectItem>
                        <SelectItem value="aroll">A-roll</SelectItem>
                        <SelectItem value="broll">B-roll</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      onClick={() => removeFile(f.id)}
                      className="p-1.5 rounded-md hover:bg-white/5"
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
            <h2 className="flex items-center gap-2.5 text-base font-semibold"><span className="grid place-items-center w-6 h-6 rounded-full bg-primary/15 border border-primary/30 text-[11px] font-bold text-primary-glow font-display">3</span>Script (optional)</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Paste the script if you have one. The AI reads it alongside what you actually say
              when it plans the graphics and writes your opening hook.
            </p>
            <Textarea
              className="mt-4 min-h-32 font-mono text-sm"
              placeholder="Most creators fail because…"
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          </section>

          <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
            <h2 className="flex items-center gap-2.5 text-base font-semibold"><span className="grid place-items-center w-6 h-6 rounded-full bg-primary/15 border border-primary/30 text-[11px] font-bold text-primary-glow font-display">4</span>Brief the edit (optional)</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Tell the AI which graphics you want and how fast. Captions, music and cuts are
              set in the editor.
            </p>
            <Textarea
              className="mt-4 min-h-24"
              placeholder="Fast and punchy. Put the hook's key line behind me, every number as a counter, a chapter for each tip, punch-in zooms on emphatic words."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </section>

          <div className="fixed sm:static inset-x-0 bottom-0 z-20 flex justify-end gap-3 border-t sm:border-0 border-border bg-background/90 sm:bg-transparent backdrop-blur-xl sm:backdrop-blur-none px-4 py-3 sm:p-0">
            <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
              Cancel
            </Button>
            <Button size="lg" className="rounded-full px-6 flex-1 sm:flex-none" onClick={() => submit.mutate()} disabled={submit.isPending || !ws.canEdit}>
              {submit.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Create project
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
