import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createProject, attachClip, getSignedClipUploadUrl } from "@/lib/projects.functions";
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
  const [preset, setPreset] = useState(template?.preset ?? "gadzhi");
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

      const project = await createFn({
        data: {
          title: title.trim(),
          script: script || null,
          brief: brief || null,
          style_preset: preset,
          aspect_ratio: ratio,
        },
      });

      // Upload each file to storage via signed upload URL, then attach to project
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const signed = await getSignedClipUploadFn({
          data: { project_id: project.id, filename: f.file.name, ordinal: i },
        });

        const { error: upErr } = await supabase.storage
          .from("raw-clips")
          .uploadToSignedUrl(signed.path, signed.token, f.file, {
            contentType: f.file.type,
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
            x.id === f.id ? { ...x, uploaded: true, progress: 100, storagePath: signed.path } : x,
          ),
        );

        await attachFn({
          data: {
            project_id: project.id,
            storage_path: signed.path,
            filename: f.file.name,
            size_bytes: f.file.size,
            role: f.role,
            ordinal: i,
          },
        });
      }

      // Clips are attached; user opens the editor and hits Export to render.
      return { project };
    },
    onSuccess: ({ project }) => {
      toast.success("Project created — opening editor");
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["usage-stats"] });
      qc.invalidateQueries({ queryKey: ["all-clips"] });
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Drop your clips in any order. Add a script if you have one — Stuccord will match
          it against the footage.
        </p>

        {template && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
            <div className="w-9 h-9 rounded-lg bg-white grid place-items-center shrink-0 shadow-sm">
              <Sparkles className="w-4 h-4 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-violet-700">Using template</div>
              <div className="text-sm font-semibold mt-0.5">{template.title}</div>
              <div className="text-xs text-neutral-600 mt-0.5">
                Preset, aspect ratio & edit brief pre-filled — tweak anything below.
              </div>
            </div>
            <button
              onClick={() => navigate({ to: "/projects/new", search: {} as never })}
              className="text-xs text-neutral-500 hover:text-neutral-900 shrink-0"
            >
              Clear
            </button>
          </div>
        )}

        <div className="mt-8 space-y-8">
          <section className="bg-white border border-black/5 rounded-2xl p-6">
            <h2 className="text-sm font-semibold">1. Title & format</h2>
            <div className="grid gap-4 mt-4 sm:grid-cols-2">
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
                    <SelectItem value="gadzhi">Gadzhi — high-retention creator</SelectItem>
                    <SelectItem value="hormozi">Hormozi — pattern-interrupt captions</SelectItem>
                    <SelectItem value="cinematic">Cinematic — slower, moody cuts</SelectItem>
                    <SelectItem value="podcast">Podcast clip — 2-cam bounces</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="bg-white border border-black/5 rounded-2xl p-6">
            <h2 className="text-sm font-semibold">2. Upload your clips</h2>
            <p className="text-xs text-neutral-500 mt-1">
              A-roll, B-roll, phone shots, screen recordings — drop them all. Stuccord
              orders them against your script or figures it out from the audio.
            </p>
            <div
              className={`mt-4 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-[#7C3AED] bg-violet-50" : "border-black/10 hover:border-black/25"
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
              <UploadCloud className="mx-auto w-8 h-8 text-neutral-400" />
              <p className="mt-3 text-sm font-medium">Drop videos or click to browse</p>
              <p className="text-xs text-neutral-500 mt-1">
                MP4, MOV, WebM · up to 2GB per clip
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
              <ul className="mt-4 divide-y divide-black/5 border border-black/5 rounded-xl">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 p-3">
                    <div className="w-9 h-9 grid place-items-center rounded-md bg-neutral-100">
                      <Film className="w-4 h-4 text-neutral-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{f.file.name}</div>
                      <div className="text-xs text-neutral-500">
                        {(f.file.size / 1024 / 1024).toFixed(1)} MB
                        {f.error && <span className="text-red-600 ml-2">· {f.error}</span>}
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
                      className="p-1.5 rounded-md hover:bg-black/5"
                    >
                      <X className="w-4 h-4 text-neutral-500" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white border border-black/5 rounded-2xl p-6">
            <h2 className="text-sm font-semibold">3. Script (optional)</h2>
            <p className="text-xs text-neutral-500 mt-1">
              Paste the script if you have one. Stuccord will match takes to lines and know
              exactly when to cut, zoom, and drop B-roll.
            </p>
            <Textarea
              className="mt-4 min-h-32 font-mono text-sm"
              placeholder="Most creators fail because…"
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          </section>

          <section className="bg-white border border-black/5 rounded-2xl p-6">
            <h2 className="text-sm font-semibold">4. Brief the edit (optional)</h2>
            <p className="text-xs text-neutral-500 mt-1">
              Tell the AI how it should feel. Reference creators, pace, energy.
            </p>
            <Textarea
              className="mt-4 min-h-24"
              placeholder="Edit like Iman Gadzhi. Hard zoom-ins on emphasis words. Word-by-word captions in white with yellow highlights. Whoosh SFX on cuts. Background music at -14 LUFS, duck to -22 under VO."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </section>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
              Cancel
            </Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="animate-spin" />}
              Create project
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
