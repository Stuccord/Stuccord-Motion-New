import { useWorkspace } from "@/lib/use-workspace";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createProject,
  attachClip,
  deleteProject,
  getSignedClipUploadUrl,
} from "@/lib/projects.functions";
import { probeFileDurationMs, probeFileVideoSize } from "@/lib/media-duration";
import { fillFrameTransform } from "@/lib/clip-transform";

/** The video's frame in pixels for each shape (as the export makes it). */
const FRAME_SIZE = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
} as const;
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LookPreview, lookOfPreset } from "@/components/look-preview";
import { cn } from "@/lib/utils";
import creatorPortrait from "@/assets/creator-portrait.jpg";
import { Check, ChevronDown, UploadCloud, X, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { TEMPLATES } from "@/lib/templates.data";
import { NEW_PROJECT_STYLES } from "@/lib/presets";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-rules";
import { FinalUploadError, uploadToSignedUrlWithProgress } from "@/lib/upload-file";
import { z } from "zod";
import { NewProjectPictures, type PendingPicture } from "@/components/new-project-pictures";
import { saveUserPictures, sceneUploadSlot } from "@/lib/story-images.functions";
import { SCENE_BUCKET } from "@/lib/motion-plan";
import { shrinkPicture } from "@/lib/user-pictures";

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
  /** A local URL for the clip's preview (released when it's removed). */
  url: string;
  storagePath?: string;
  error?: string;
  /** The video type sent to storage (from the file, or its extension when the browser doesn't say). */
  contentType: string;
};

/** Video types the uploader takes (the server's upload rules), by file extension too. */
const VIDEO_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
};
const VIDEO_TYPES = new Set(Object.values(VIDEO_BY_EXT));

/** A file's video type, or null when it isn't an MP4, MOV or WebM. */
function videoType(file: File): string | null {
  if (VIDEO_TYPES.has(file.type)) return file.type;
  // Windows often reports no type (or an odd one) for MOV and MP4 files.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_BY_EXT[ext] ?? null;
}

/** A readable title from a file name: "my_first-take.mp4" -> "my first take". */
function titleFromFile(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "My video").slice(0, 120);
}

/**
 * Uploads to a Supabase signed upload URL with progress. Resumable
 * (upload-file.ts): a dropped connection carries on from the last piece
 * that arrived, retried for a couple of minutes, instead of starting over.
 */
async function uploadWithProgress(
  bucket: string,
  path: string,
  token: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  try {
    await uploadToSignedUrlWithProgress(
      bucket,
      path,
      token,
      file,
      (loaded, total) => onProgress(Math.min(99, Math.round((loaded / Math.max(1, total)) * 100))),
      contentType,
    ).done;
    onProgress(100);
  } catch (e) {
    const why = e instanceof Error ? e.message : "upload failed";
    if (e instanceof FinalUploadError) throw new Error(why);
    throw new Error(`${why}. Check your internet connection and try again.`);
  }
}

const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

function NewProject() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const createFn = useServerFn(createProject);
  const ws = useWorkspace();
  const attachFn = useServerFn(attachClip);
  const deleteFn = useServerFn(deleteProject);
  const getSignedClipUploadFn = useServerFn(getSignedClipUploadUrl);
  const pictureSlotFn = useServerFn(sceneUploadSlot);
  const savePicturesFn = useServerFn(saveUserPictures);

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
  const [pictures, setPictures] = useState<PendingPicture[]>([]);

  /** Adds clips, any number at once; says which ones it can't take and why. */
  function addFiles(list: FileList | File[]) {
    const wrongType: string[] = [];
    const tooBig: string[] = [];
    const added: PendingFile[] = [];
    for (const file of Array.from(list)) {
      const contentType = videoType(file);
      if (!contentType) wrongType.push(file.name);
      else if (file.size > MAX_UPLOAD_BYTES) tooBig.push(file.name);
      else if (
        files.some((f) => sameFile(f.file, file)) ||
        added.some((f) => sameFile(f.file, file))
      )
        continue;
      else
        added.push({
          id: crypto.randomUUID(),
          file,
          contentType,
          role: "auto",
          progress: 0,
          uploaded: false,
          url: URL.createObjectURL(file),
        });
    }
    if (wrongType.length) {
      toast.error(`${wrongType.join(", ")}: only MP4, MOV or WebM videos can be added.`);
    }
    if (tooBig.length) {
      toast.error(`${tooBig.join(", ")}: over the ${MAX_UPLOAD_MB} MB limit for one clip.`);
    }
    if (added.length) setFiles((prev) => [...prev, ...added]);
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const gone = prev.find((f) => f.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((f) => f.id !== id);
    });
  }

  function setRole(id: string, role: "auto" | "aroll" | "broll") {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, role } : f)));
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (files.length === 0) throw new Error("Add at least one video clip");
      // Checked before the project is made, so a too-big file doesn't leave an empty project.
      const tooBig = files.find((f) => f.file.size > MAX_UPLOAD_BYTES);
      if (tooBig) throw new Error(`${tooBig.file.name} is over the ${MAX_UPLOAD_MB} MB limit`);

      const project = await createFn({
        data: {
          // No title typed: named after the first clip, so the button never refuses.
          title: title.trim() || titleFromFile(files[0].file.name),
          script: script || null,
          brief: brief || null,
          style_preset: preset,
          aspect_ratio: ratio,
          team_id: ws.team?.id ?? null,
        },
      });

      try {
        // Upload each file to storage via signed upload URL, then attach to project
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const contentType = f.contentType;
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

          try {
            await uploadWithProgress(bucket, path, token, f.file, contentType, (pct) =>
              setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, progress: pct } : x))),
            );
          } catch (e) {
            const why = e instanceof Error ? e.message : "upload failed";
            setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, error: why } : x)));
            throw new Error(`${f.file.name}: ${why}`);
          }

          setFiles((prev) =>
            prev.map((x) =>
              x.id === f.id ? { ...x, uploaded: true, progress: 100, storagePath: path } : x,
            ),
          );

          // Record the clip's real length so the editor timeline draws it correctly.
          const durationMs = await probeFileDurationMs(f.file);
          // A talking clip of another shape (a landscape take in a tall
          // video) is zoomed to fill the frame, as an editor would crop it;
          // B-roll keeps its whole picture over a blurred copy.
          const size = f.role === "broll" ? null : await probeFileVideoSize(f.file);
          const frame = FRAME_SIZE[ratio];
          const transform = size
            ? fillFrameTransform(size.width, size.height, frame.w, frame.h)
            : null;
          await attachFn({
            data: {
              project_id: project.id,
              storage_path: path,
              filename: f.file.name,
              size_bytes: f.file.size,
              role: f.role,
              ordinal: i,
              duration_ms: durationMs ?? undefined,
              ...(transform ? { transform } : {}),
            },
          });
        }

        // The creator's own pictures, shrunk, into the project's pictures
        // folder; the list (with the notes) is kept for the planner.
        if (pictures.length) {
          const saved: { path: string; note: string }[] = [];
          for (const p of pictures) {
            const { blob, type } = await shrinkPicture(p.file);
            const slot = await pictureSlotFn({
              data: { project_id: project.id, content_type: type },
            });
            const { error } = await supabase.storage
              .from(SCENE_BUCKET)
              .uploadToSignedUrl(slot.path, slot.token, blob, { contentType: type });
            if (error) throw new Error(`${p.file.name}: ${error.message}`);
            saved.push({ path: slot.path, note: p.note.trim() });
          }
          await savePicturesFn({ data: { project_id: project.id, pictures: saved } });
        }
      } catch (e) {
        // A failed upload doesn't leave an empty project behind.
        await deleteFn({ data: { id: project.id } }).catch(() => {});
        throw e;
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
    // Stays up until closed: a slow upload's failure must not vanish unseen.
    onError: (e: Error) => toast.error(e.message, { duration: Infinity, closeButton: true }),
  });

  const look = lookOfPreset(preset);
  const style = NEW_PROJECT_STYLES.find((s) => s.id === preset);
  const [lookName, lookHint] = (style?.label ?? "").split(" — ");

  return (
    <AppShell>
      <div className="mx-auto grid max-w-6xl gap-8 pb-28 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-10">
        <div className="min-w-0">
          <div className="caps-label text-[11px] text-foreground/70">New video</div>
          <input
            aria-label="Project title"
            className="mt-2 w-full bg-transparent font-display text-3xl font-bold tracking-tight text-foreground placeholder:text-muted-foreground/50 focus:outline-none sm:text-4xl"
            placeholder="Untitled video"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Drop your take, pick a shape and a look. Stuccord makes the whole edit for you.
          </p>
          {ws.team && (
            <p className="mt-1 text-sm text-muted-foreground" data-new-in-team>
              {ws.canEdit
                ? `Made in ${ws.team.name}: everyone in the team can open it.`
                : `You're a Viewer in ${ws.team.name}, so you can't make projects there. Switch to Personal or ask an admin.`}
            </p>
          )}

          {template && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3">
              <Sparkles className="h-4 w-4 shrink-0 text-foreground/70" />
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{template.title}</span>
                <span className="text-muted-foreground">
                  {" "}
                  template: shape, look and directions are set. Change anything.
                </span>
              </div>
              <button
                onClick={() => navigate({ to: "/projects/new", search: {} as never })}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
          )}

          {/* 1. The footage: the main thing, first. */}
          <div
            className={cn(
              "relative mt-7 cursor-pointer overflow-hidden rounded-3xl border transition-colors",
              dragOver
                ? "border-primary bg-white/[0.06]"
                : "border-border bg-card hover:border-white/10",
            )}
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
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.05),transparent_65%)]" />
            <div className="relative flex flex-col items-center px-6 py-12 text-center sm:py-16">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_12px_40px_-10px_rgba(255,255,255,0.05)]">
                <UploadCloud className="h-6 w-6" />
              </span>
              <p className="mt-5 font-display text-xl font-bold tracking-tight">
                {files.length ? "Add more clips" : "Drop your clips here"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                One take or several clips (they play in order) · or click to browse
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                MP4, MOV or WebM · up to {MAX_UPLOAD_MB} MB a clip
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                // Cleared so the same file can be picked again after removing it.
                e.target.value = "";
              }}
            />
          </div>

          {files.length > 0 && (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {files.map((f, i) => (
                <li
                  key={f.id}
                  className="flex gap-3 rounded-2xl border border-border bg-card p-2.5"
                >
                  <video
                    src={f.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-[88px] w-[66px] shrink-0 rounded-lg bg-black object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{f.file.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Clip {i + 1} · {(f.file.size / 1024 / 1024).toFixed(1)} MB
                          {f.error && <span className="ml-1 text-red-400">· {f.error}</span>}
                        </div>
                        {submit.isPending && !f.error && (
                          <div className="mt-1.5" data-upload-progress>
                            <div className="flex justify-between text-[11px] text-muted-foreground">
                              <span>{f.uploaded ? "Uploaded" : "Uploading…"}</span>
                              <span className="tabular-nums">{f.progress}%</span>
                            </div>
                            <div className="mt-0.5 h-1 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${Math.max(2, f.progress)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeFile(f.id)}
                        aria-label={`Remove ${f.file.name}`}
                        className="rounded-md p-1 hover:bg-white/5"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="mt-auto flex gap-1">
                      {ROLES.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setRole(f.id, r.id)}
                          title={r.hint}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                            f.role === r.id
                              ? "bg-foreground text-background"
                              : "bg-surface text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <NewProjectPictures
            pictures={pictures}
            onChange={setPictures}
            disabled={submit.isPending}
          />

          {/* 2. The shape. */}
          <h2 className="mt-10 text-sm font-semibold">Shape</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {SHAPES.map((s) => (
              <button
                key={s.id}
                onClick={() => setRatio(s.id)}
                className={cn(
                  "flex flex-col items-center gap-3 rounded-2xl border p-4 transition-colors",
                  ratio === s.id
                    ? "border-primary bg-white/[0.06]"
                    : "border-border bg-card hover:border-white/10",
                )}
              >
                <span className="flex h-14 items-center">
                  <span
                    className={cn(
                      "block rounded-[5px] border-2",
                      ratio === s.id ? "border-primary-glow" : "border-muted-foreground/50",
                    )}
                    style={{ width: s.w, height: s.h }}
                  />
                </span>
                <span className="text-center">
                  <span className="block text-sm font-semibold">{s.id}</span>
                  <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
                </span>
              </button>
            ))}
          </div>

          {/* 3. The look. */}
          <h2 className="mt-10 text-sm font-semibold">Look</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {NEW_PROJECT_STYLES.map((s) => {
              const [name] = s.label.split(" — ");
              return (
                <button
                  key={s.id}
                  onClick={() => setPreset(s.id)}
                  className={cn(
                    "overflow-hidden rounded-2xl border text-left transition-colors",
                    preset === s.id
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border hover:border-white/10",
                  )}
                >
                  <div className="flex h-36 items-center justify-center bg-black/40 p-2">
                    <LookPreview
                      look={lookOfPreset(s.id)}
                      ratio="9:16"
                      image={creatorPortrait}
                      line="Most people quit before it works"
                      emphasis="works"
                    />
                  </div>
                  <div className="px-3 py-2.5 text-[13px] font-semibold">{name}</div>
                </button>
              );
            })}
          </div>

          {/* 4. Optional: the script and directions. */}
          <details
            className="group mt-10 rounded-2xl border border-border bg-card"
            open={!!template}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
              <span>
                <span className="block text-sm font-semibold">Script and directions</span>
                <span className="block text-xs text-muted-foreground">
                  Optional. Helps the AI put the graphics on the lines you meant.
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-border px-5 py-5">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Your script</span>
                <Textarea
                  className="mt-1.5 min-h-28 text-sm"
                  placeholder="Most creators fail because…"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Directions for the edit
                </span>
                <Textarea
                  className="mt-1.5 min-h-20 text-sm"
                  placeholder="Fast and punchy. Put the hook's key line behind me, every number as a counter, a chapter for each tip."
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
              </label>
            </div>
          </details>
        </div>

        {/* Your video: what it will look like, and the button. */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 rounded-3xl border border-border bg-card p-5">
            <div className="caps-label text-[10px] text-muted-foreground">Your video</div>
            <div className="mt-4 flex h-[300px] items-center justify-center rounded-2xl bg-black/50 p-3">
              <LookPreview
                look={look}
                ratio={ratio}
                image={creatorPortrait}
                line="Most people quit before it works"
                emphasis="works"
                className={ratio === "16:9" ? "max-w-full" : ""}
              />
            </div>
            <div className="mt-4 text-sm font-semibold">{lookName}</div>
            <div className="text-xs text-muted-foreground">{lookHint}</div>
            <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
              {[
                "Transcribes what you say",
                "Plans graphics on your words",
                "Makes story scenes with AI",
                "Cleans and masters the sound",
                "Corrects the colour, then renders",
              ].map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-foreground/70" />
                  {s}
                </li>
              ))}
            </ul>
            <Button
              size="lg"
              className="mt-5 w-full rounded-full"
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !ws.canEdit}
            >
              {submit.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Make my video
            </Button>
            <div className="mt-2 text-center text-[11px] text-muted-foreground">
              {files.length
                ? `${files.length} clip${files.length === 1 ? "" : "s"} ready`
                : "Add a clip to start"}
            </div>
          </div>
        </aside>
      </div>

      {/* Phones and tablets: the button stays in reach. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
          Cancel
        </Button>
        <Button
          size="lg"
          className="flex-1 rounded-full"
          onClick={() => submit.mutate()}
          disabled={submit.isPending || !ws.canEdit}
        >
          {submit.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Make my video
        </Button>
      </div>
    </AppShell>
  );
}

const ROLES = [
  { id: "auto", label: "Auto", hint: "Let Stuccord decide" },
  { id: "aroll", label: "Talking", hint: "You talking to camera (A-roll)" },
  { id: "broll", label: "B-roll", hint: "Cutaway footage shown over you" },
] as const;

const SHAPES = [
  { id: "9:16", hint: "Reels, Shorts, TikTok", w: 26, h: 46 },
  { id: "16:9", hint: "YouTube", w: 52, h: 29 },
  { id: "1:1", hint: "Feed square", w: 38, h: 38 },
] as const;
