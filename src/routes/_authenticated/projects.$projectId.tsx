import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProject,
  submitRender,
  removeClip,
  getRenderSignedUrl,
  getClipSignedUrl,
  updateClipOrder,
  updateProjectSettings,
  attachClip,
  updateClipTrim,
  updateClipDuration,
  splitClip,
  duplicateClip,
  startBrowserRender,
  finishBrowserRender,
  listProjectTranscripts,
  saveTranscriptWords,
  getSignedClipUploadUrl,
} from "@/lib/projects.functions";
import { renderProjectInBrowser, aspectDims } from "@/lib/client-render";
import {
  cleanTranscriptWords,
  type CaptionSegment,
  type TimelineWord,
  type TranscriptWord,
} from "@/lib/captions";
import { CaptionsPanel } from "@/components/editor/CaptionsPanel";
import { probeFileDurationMs, probeMediaDurationMs } from "@/lib/media-duration";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  Film,
  Sparkles,
  Download,
  Loader2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,

  Scissors,
  Type,
  Music2,
  Layers,
  ChevronLeft,
  ChevronRight,
  Circle,
  Grip,
  Trash2,
  MonitorPlay,
  Wand2,
  SkipBack,
  SkipForward,
  Zap,
  Plus,
  Minus,
  UploadCloud,
  FolderOpen,
  Rows3,
  Undo2,
  Redo2,
  Copy,
  Crop,
  FlipHorizontal,
  Magnet,
  Mic,
  Lock,
  Eye,
  MousePointer2,

} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/logo.png";
import { ExportDialog, type ExportSettings } from "@/components/export-dialog";
import {
  EditorShell,
  EditorTopBar,
  MediaLibrary,
  PreviewCanvas,
  AIMotionPanel,
  TimelinePanel,
  ClipInspector,
  type AspectRatio,
  type ViewMode,
} from "@/components/editor";
import { clampZoom, ZOOM_STEP } from "@/components/editor/timeline-zoom";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: "Editor — Stuccord Motion" }] }),
  component: EditorPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-4 text-white">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-100">Project Not Found</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {error?.message === "Project not found"
            ? "This project does not exist or may have been deleted."
            : error?.message || "Something went wrong loading this project."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition"
          >
            Go to Dashboard
          </Link>
          <Link
            to="/projects/new"
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-neutral-900 transition"
          >
            Create New Project
          </Link>
        </div>
      </div>
    </div>
  ),
});

type ClipRow = {
  id: string;
  filename: string;
  role: string;
  ordinal: number;
  size_bytes: number | null;
  storage_path: string;
  duration_seconds?: number | null;
  duration_ms?: number | null;
  trim_in_ms?: number | null;
  trim_out_ms?: number | null;
  parent_clip_id?: string | null;
};

/** Effective visible length of a clip in ms (falls back to a display default) */
function clipVisibleMs(c: ClipRow): number {
  const inMs = c.trim_in_ms ?? 0;
  const outMs = c.trim_out_ms ?? c.duration_ms ?? null;
  if (outMs != null) return Math.max(200, outMs - inMs);
  // Unknown source duration — use a reasonable default so the clip is visible & draggable
  return 5000;
}
function clipSourceMs(c: ClipRow): number | null {
  return c.duration_ms ?? null;
}


function EditorPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isMutating = useIsMutating();
  const fetchProject = useServerFn(getProject);
  const runRender = useServerFn(submitRender);
  const dropClip = useServerFn(removeClip);
  const signRender = useServerFn(getRenderSignedUrl);
  const signClip = useServerFn(getClipSignedUrl);
  const reorder = useServerFn(updateClipOrder);
  const updateSettings = useServerFn(updateProjectSettings);
  const attachFn = useServerFn(attachClip);
  const trimFn = useServerFn(updateClipTrim);
  const durationFn = useServerFn(updateClipDuration);
  const splitFn = useServerFn(splitClip);
  const duplicateFn = useServerFn(duplicateClip);
  const startBrowserRenderFn = useServerFn(startBrowserRender);
  const finishBrowserRenderFn = useServerFn(finishBrowserRender);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const getSignedClipUploadFn = useServerFn(getSignedClipUploadUrl);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject({ data: { id: projectId } }),
    // Never run this server-side — it requires an auth session that isn't
    // available during SSR, which throws and crashes the page.
    enabled: typeof window !== "undefined",
    // While a render is in progress, re-check every minute: realtime only
    // fires on changes, and getProject is what times out a dead render.
    refetchInterval: (query) => {
      const status = query.state.data?.latestJob?.status;
      return status && ["queued", "transcribing", "planning", "rendering"].includes(status)
        ? 60_000
        : false;
    },
  });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedClipUrl, setSelectedClipUrl] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<"program" | "source" | "compare">("program");
  const [splitPct, setSplitPct] = useState(50);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(60);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionsText, setCaptionsText] = useState<string | null>(null);
  const [activePool, setActivePool] = useState<"clips" | "audio" | "assets" | "effects">("clips");
  const [inspectorTab, setInspectorTab] = useState<"ai" | "notes">("ai");
  const [mobileTab, setMobileTab] = useState<"edit" | "media" | "ai">("edit");
  const [mobileFullscreen, setMobileFullscreen] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightTab, setRightTab] = useState<"edit" | "captions">("edit");
  // Source-file time (ms) to jump to once the selected clip's video loads.
  const pendingSourceSeekMs = useRef<number | null>(null);

  // Saved transcripts per source file, for the Captions panel.
  const fetchTranscripts = useServerFn(listProjectTranscripts);
  const saveWordsFn = useServerFn(saveTranscriptWords);
  const transcriptsQuery = useQuery({
    queryKey: ["transcripts", projectId],
    queryFn: () => fetchTranscripts({ data: { project_id: projectId } }),
    enabled: typeof window !== "undefined",
  });
  const transcriptMap = useMemo(() => {
    const map = new Map<string, TranscriptWord[]>();
    for (const t of transcriptsQuery.data ?? []) {
      map.set(t.storage_path, cleanTranscriptWords(t.words));
    }
    return map;
  }, [transcriptsQuery.data]);
  const saveWordsMut = useMutation({
    mutationFn: (args: { storage_path: string; words: TranscriptWord[] }) =>
      saveWordsFn({ data: args }),
    onSuccess: (row) => {
      qc.setQueryData(["transcripts", projectId], (old: typeof transcriptsQuery.data) =>
        (old ?? []).map((t) => (t.storage_path === row.storage_path ? row : t)),
      );
    },
  });
  // A finished render may have transcribed new files: reload the captions.
  const latestJobKey = `${data?.latestJob?.id ?? ""}:${data?.latestJob?.status ?? ""}`;
  useEffect(() => {
    if (latestJobKey.endsWith(":completed")) {
      void qc.invalidateQueries({ queryKey: ["transcripts", projectId] });
    }
  }, [latestJobKey, qc, projectId]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const playheadPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const seekTo = (pct: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const t = Math.max(0, Math.min(duration, (pct / 100) * duration));
    v.currentTime = t;
    if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t;
    setCurrentTime(t);
  };

  // Realtime updates from render worker
  useEffect(() => {
    const ch = supabase
      .channel(`project:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "render_jobs", filter: `project_id=eq.${projectId}` },
        () => refetch(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` },
        () => refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId, refetch]);

  // Load preview when ready
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (data?.project.status === "ready" && data.project.output_path) {
        try {
          const { url } = await signRender({ data: { path: data.project.output_path } });
          if (!cancelled) setPreviewUrl(url);
        } catch {
          /* silent */
        }
      } else {
        // Edits since the last render make it stale — stop previewing it.
        setPreviewUrl(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [data?.project.status, data?.project.output_path, signRender]);

  // Load selected clip preview
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedClipId || !data) return;
      const c = data.clips.find((x) => x.id === selectedClipId);
      if (!c) return;
      try {
        const { url } = await signClip({ data: { path: c.storage_path } });
        if (!cancelled) setSelectedClipUrl(url);
      } catch {
        /* silent */
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedClipId, data, signClip]);

  const render = useMutation({
    mutationFn: () => runRender({ data: { project_id: projectId, captions: captionsEnabled } }),
    onSuccess: () => {
      toast.success("Export started");
      refetch();
      qc.invalidateQueries({ queryKey: ["usage-stats"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeClipMut = useMutation({
    mutationFn: (id: string) => dropClip({ data: { id } }),
    onSuccess: (_res, id) => {
      // Only clear the selection if the removed clip was the selected one.
      setSelectedClipId((current) => (current === id ? null : current));
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderMut = useMutation({
    // The timeline only knows clip ids, so the project always comes from the route.
    mutationFn: ({ order }: { order: { id: string; ordinal: number; role?: string }[] }) =>
      reorder({ data: { project_id: projectId, order } }),
    onSuccess: () => refetch(),
    onError: (e: Error) => toast.error(e.message),
  });

  const trimMut = useMutation({
    mutationFn: (v: { id: string; trim_in_ms: number; trim_out_ms: number | null }) =>
      trimFn({ data: v }),
    onSuccess: () => refetch(),
    onError: (e: Error) => toast.error(e.message),
  });

  const durationMut = useMutation({
    mutationFn: (v: { id: string; duration_ms: number }) => durationFn({ data: v }),
    onSuccess: () => refetch(),
  });

  // Clips uploaded before lengths were recorded on upload (or whose length
  // couldn't be read then) have no duration, so the timeline would draw them
  // at a 5s placeholder. Measure each such source file once per visit.
  const probedPaths = useRef(new Set<string>());
  useEffect(() => {
    if (!data) return;
    const byPath = new Map<string, ClipRow[]>();
    for (const c of data.clips as ClipRow[]) {
      if (c.duration_ms != null || probedPaths.current.has(c.storage_path)) continue;
      probedPaths.current.add(c.storage_path);
      byPath.set(c.storage_path, [...(byPath.get(c.storage_path) ?? []), c]);
    }
    if (byPath.size === 0) return;
    void (async () => {
      let updated = false;
      for (const [path, group] of byPath) {
        try {
          const { url } = await signClip({ data: { path } });
          const isAudio = group[0].role === "music" || group[0].role === "sfx";
          const ms = await probeMediaDurationMs(url, isAudio ? "audio" : "video");
          if (ms == null) continue;
          for (const c of group) await durationFn({ data: { id: c.id, duration_ms: ms } });
          updated = true;
        } catch (e) {
          console.warn("[editor] Couldn't measure clip length:", e);
        }
      }
      if (updated) refetch();
    })();
  }, [data, signClip, durationFn, refetch]);

  const splitMut = useMutation({
    mutationFn: (v: { id: string; at_ms: number }) => splitFn({ data: v }),
    onSuccess: (r) => {
      toast.success("Clip split");
      if (r?.right_id) setSelectedClipId(r.right_id);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMut = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: (r) => {
      toast.success("Clip duplicated");
      if (r?.id) setSelectedClipId(r.id);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Timeline zoom (pixels per second) and snap toggle
  const [pxPerSec, setPxPerSec] = useState(40);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Undo / Redo in-memory stack
  const [history, setHistory] = useState<{
    past: { undo: () => void | Promise<void>; redo: () => void | Promise<void>; description: string }[];
    future: { undo: () => void | Promise<void>; redo: () => void | Promise<void>; description: string }[];
  }>({ past: [], future: [] });

  const pushToHistory = (item: { undo: () => void | Promise<void>; redo: () => void | Promise<void>; description: string }) => {
    setHistory((curr) => {
      const nextPast = [...curr.past, item];
      if (nextPast.length > 50) nextPast.shift();
      return {
        past: nextPast,
        future: [],
      };
    });
  };

  const undo = () => {
    setHistory((curr) => {
      if (curr.past.length === 0) return curr;
      const last = curr.past[curr.past.length - 1];
      const nextPast = curr.past.slice(0, -1);
      const nextFuture = [last, ...curr.future];
      
      try {
        last.undo();
        toast.info(`Undid: ${last.description}`);
      } catch (err) {
        toast.error("Failed to undo");
      }
      
      return {
        past: nextPast,
        future: nextFuture,
      };
    });
  };

  const redo = () => {
    setHistory((curr) => {
      if (curr.future.length === 0) return curr;
      const next = curr.future[0];
      const nextFuture = curr.future.slice(1);
      const nextPast = [...curr.past, next];
      
      try {
        next.redo();
        toast.info(`Redid: ${next.description}`);
      } catch (err) {
        toast.error("Failed to redo");
      }
      
      return {
        past: nextPast,
        future: nextFuture,
      };
    });
  };

  // Refs used by the keyboard shortcut effect to avoid stale closures.
  const actionsRef = useRef<{
    play: () => void;
    del: () => void;
    dup: () => void;
    split: () => void;
    zoom: (direction: 1 | -1) => void;
    undo: () => void;
    redo: () => void;
    seekRelative: (offset: number) => void;
    seekAbsolute: (time: number) => void;
  }>({
    play: () => {},
    del: () => {},
    dup: () => {},
    split: () => {},
    zoom: () => {},
    undo: () => {},
    redo: () => {},
    seekRelative: () => {},
    seekAbsolute: () => {},
  });

  // Global keyboard shortcuts: Space play/pause, Del/Backspace delete,
  // S split at playhead, ⌘/Ctrl+D duplicate, +/- zoom, Ctrl+Z/Y undo/redo.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        actionsRef.current.play();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !meta) {
        e.preventDefault();
        actionsRef.current.del();
      } else if (e.key === "s" && !meta) {
        e.preventDefault();
        actionsRef.current.split();
      } else if (meta && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        actionsRef.current.dup();
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        actionsRef.current.zoom(1);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        actionsRef.current.zoom(-1);
      } else if (meta && e.key === "z") {
        e.preventDefault();
        actionsRef.current.undo();
      } else if ((meta && e.key === "y") || (meta && e.shiftKey && e.key === "z")) {
        e.preventDefault();
        actionsRef.current.redo();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / 30;
        actionsRef.current.seekRelative(-step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / 30;
        actionsRef.current.seekRelative(step);
      } else if (e.key === "Home") {
        e.preventDefault();
        actionsRef.current.seekAbsolute(0);
      } else if (e.key === "End") {
        e.preventDefault();
        actionsRef.current.seekAbsolute(duration);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration]);



  const changeAspect = useMutation({
    mutationFn: (ratio: "9:16" | "16:9" | "1:1") =>
      updateSettings({ data: { id: projectId, aspect_ratio: ratio } }),
    onSuccess: () => {
      toast.success("Aspect ratio updated");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function classifyFile(
    file: File,
    videoIndexInBatch: number,
    hasAnyARoll: boolean,
  ): "aroll" | "broll" | "music" | "sfx" | null {
    if (file.type.startsWith("audio/")) {
      // Short blips → sfx, longer files → music (heuristic on filename)
      if (/sfx|whoosh|impact|riser|swoosh|snap/i.test(file.name)) return "sfx";
      return "music";
    }
    if (file.type.startsWith("video/")) {
      // First incoming video becomes A-roll if none exists yet; the rest become B-roll.
      if (!hasAnyARoll && videoIndexInBatch === 0) return "aroll";
      return "broll";
    }
    return null;
  }

  async function handleUpload(files: FileList | File[]) {
    const arr = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || f.type.startsWith("audio/"),
    );
    if (arr.length === 0) {
      toast.error("Drop video or audio files");
      return;
    }
    if (!data) return;
    setUploading(true);
    const hasAnyARoll = data.clips.some((c) => c.role === "aroll" || c.role === "auto");
    const summary = { aroll: 0, broll: 0, music: 0, sfx: 0 };
    try {
      const startOrdinal = data.clips.length;
      let videoSeen = 0;
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        const role = classifyFile(f, videoSeen, hasAnyARoll);
        if (!role) continue;
        if (f.type.startsWith("video/")) videoSeen++;

        // Client-side validations
        const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
        if (f.size > MAX_FILE_SIZE) {
          throw new Error(`${f.name} exceeds 500 MB limit`);
        }

        const contentType = f.type || "video/mp4";
        const { data: authData } = await supabase.auth.getSession();
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (authData?.session?.access_token) {
          headers["Authorization"] = `Bearer ${authData.session.access_token}`;
        }

        const presignRes = await fetch("/api/authenticated/uploads/presign", {
          method: "POST",
          headers,
          body: JSON.stringify({
            projectId,
            filename: f.name,
            contentType,
            size: f.size,
          }),
        });

        if (!presignRes.ok) {
          const errText = await presignRes.text().catch(() => "Upload presign failed");
          throw new Error(`${f.name}: ${errText}`);
        }

        const { bucket, path, token } = (await presignRes.json()) as {
          bucket: string;
          path: string;
          token: string;
        };

        const { error: upErr } = await supabase.storage
          .from(bucket)
          .uploadToSignedUrl(path, token, f, { contentType, upsert: true });
        if (upErr) throw new Error(`${f.name}: ${upErr.message}`);

        // Record the clip's real length so the timeline draws it correctly
        // before it's ever opened in the player.
        const durationMs = await probeFileDurationMs(f);
        await attachFn({
          data: {
            project_id: projectId,
            storage_path: path,
            filename: f.name,
            size_bytes: f.size,
            role,
            ordinal: startOrdinal + i,
            duration_ms: durationMs ?? undefined,
          },
        });
        summary[role] += 1;
      }
      const parts = [
        summary.aroll && `${summary.aroll} A-roll`,
        summary.broll && `${summary.broll} B-roll`,
        summary.music && `${summary.music} music`,
        summary.sfx && `${summary.sfx} SFX`,
      ].filter(Boolean);
      toast.success(`Placed on tracks — ${parts.join(", ")}`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  const [downloading, setDownloading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renderMsg, setRenderMsg] = useState<string | null>(null);
  const [renderPct, setRenderPct] = useState<number>(0);

  function triggerDownload(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadFinal(settings: ExportSettings) {
    setDownloading(true);
    setRenderPct(0);
    setRenderMsg("Preparing render");
    try {
      // If a completed render exists and nothing changed since, just download it.
      if (
        data?.project.status === "ready" &&
        data.project.output_path &&
        data.latestJob?.status === "completed"
      ) {
        const { url } = await signRender({ data: { path: data.project.output_path } });
        const safeTitle = (data.project.title || "stuccord-export").replace(/[^\w.-]+/g, "_");
        const outExt = data.project.output_path.split(".").pop() || "mp4";
        triggerDownload(url, `${safeTitle}_${settings.resolution}.${outExt}`);
        toast.success("Downloading");
        setExportOpen(false);
        return;
      }

      // Otherwise: render fresh in the browser.
      const started = await startBrowserRenderFn({
        data: { project_id: data!.project.id, ext: "mp4" },
      });

      const dims = aspectDims(started.aspect_ratio || data!.project.aspect_ratio);
      const scale = settings.resolution === "4k" ? 2 : 1;

      let result;
      try {
        result = await renderProjectInBrowser({
          clips: started.clips.map((c) => ({
            id: c.id,
            download_url: c.download_url!,
            role: c.role,
            trim_in_ms: c.trim_in_ms,
            trim_out_ms: c.trim_out_ms,
            duration_ms: c.duration_ms,
          })),
          width: dims.w * scale,
          height: dims.h * scale,
          videoBitsPerSecond: settings.bitrateMbps * 1_000_000,
          onProgress: (pct, msg) => {
            setRenderPct(pct);
            setRenderMsg(msg);
          },
        });
      } catch (renderErr) {
        await finishBrowserRenderFn({
          data: {
            job_id: started.job_id,
            project_id: data!.project.id,
            output_path: started.upload.path,
            status: "failed",
            error: renderErr instanceof Error ? renderErr.message : "Render failed",
          },
        }).catch(() => {});
        throw renderErr;
      }

      setRenderMsg("Uploading");
      const { error: upErr } = await supabase.storage
        .from("renders")
        .uploadToSignedUrl(started.upload.path, started.upload.token, result.blob, {
          contentType: result.mimeType,
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);

      await finishBrowserRenderFn({
        data: {
          job_id: started.job_id,
          project_id: data!.project.id,
          output_path: started.upload.path,
          duration_ms: result.durationMs,
          status: "completed",
        },
      });
      qc.invalidateQueries({ queryKey: ["project", data!.project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["usage-stats"] });

      const { url } = await signRender({ data: { path: started.upload.path } });
      const safeTitle = (data!.project.title || "stuccord-export").replace(/[^\w.-]+/g, "_");
      triggerDownload(url, `${safeTitle}_${settings.resolution}.${result.ext}`);
      toast.success(`Rendered ${(result.durationMs / 1000).toFixed(1)}s — MP4 downloading`);
      setExportOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Render failed");
    } finally {
      setDownloading(false);
      setRenderPct(0);
      setRenderMsg(null);
    }
  }

  // These hooks MUST be above the early return to avoid "rendered more hooks" errors.
  // They use null-safe access since `data` may be undefined during loading.
  const videoClipsForHooks = ((data?.clips ?? []) as ClipRow[]).filter(
    (c) => c.role !== "music" && c.role !== "sfx",
  );

  // Where each clip starts in the rendered program, matching the export and the
  // timeline: A-roll back to back from 0:00, and B-roll back to back from 0:00
  // on its own track. With no A-roll, the B-roll is the main track.
  const hasMainTrackClips = videoClipsForHooks.some((c) => c.role !== "broll");
  const programOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let mainCursor = 0;
    let brollCursor = 0;
    for (const c of videoClipsForHooks) {
      if (c.role === "broll") {
        offsets.set(c.id, brollCursor);
        brollCursor += clipVisibleMs(c);
      } else {
        offsets.set(c.id, mainCursor);
        mainCursor += clipVisibleMs(c);
      }
    }
    return offsets;
  }, [videoClipsForHooks]);

  // The main player shows either the rendered program or the selected clip's
  // source file (see PreviewCanvas). currentTime means a position in whichever
  // one it is showing, so every time conversion has to check this first.
  const showingProgram = previewUrl != null && (viewMode !== "source" || !selectedClipUrl);

  const timelinePlayheadMs = useMemo(() => {
    if (showingProgram) {
      return Math.round(currentTime * 1000);
    }
    if (!selectedClipId) return 0;
    const selectedClipForHooks = videoClipsForHooks.find((c) => c.id === selectedClipId);
    if (!selectedClipForHooks) return 0;
    const offset = programOffsets.get(selectedClipId) ?? 0;
    const relInClip = Math.round(currentTime * 1000) - (selectedClipForHooks.trim_in_ms ?? 0);
    return offset + Math.max(0, relInClip);
  }, [showingProgram, currentTime, selectedClipId, videoClipsForHooks, programOffsets]);

  // Auto-select the main-track clip under the playhead while the program plays
  useEffect(() => {
    if (showingProgram && playing) {
      const tMs = currentTime * 1000;
      const under = videoClipsForHooks.find((c) => {
        if (c.role === "broll" && hasMainTrackClips) return false;
        const start = programOffsets.get(c.id) ?? 0;
        return tMs >= start && tMs <= start + clipVisibleMs(c);
      });
      if (under && selectedClipId !== under.id) {
        setSelectedClipId(under.id);
      }
    }
  }, [
    currentTime,
    playing,
    showingProgram,
    hasMainTrackClips,
    videoClipsForHooks,
    programOffsets,
    selectedClipId,
  ]);

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-neutral-950 grid place-items-center text-neutral-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const { project, clips: clipsRaw, latestJob } = data;
  const clips = clipsRaw as ClipRow[];
  const videoClips = clips.filter((c) => c.role !== "music" && c.role !== "sfx");
  const audioClips = clips.filter((c) => c.role === "music" || c.role === "sfx");
  const aRoll = videoClips.filter((c) => c.role === "aroll" || c.role === "auto");
  const bRoll = videoClips.filter((c) => c.role === "broll");

  // Captions come from the main track's voice: the A-roll, or the B-roll when
  // there's no A-roll (the same rule as the export).
  const captionSegments: CaptionSegment[] = (aRoll.length > 0 ? aRoll : bRoll).map((c) => ({
    clipId: c.id,
    storagePath: c.storage_path,
    trimInMs: c.trim_in_ms ?? 0,
    durationMs: clipVisibleMs(c),
    offsetMs: programOffsets.get(c.id) ?? 0,
  }));

  // Jumps the player to a caption word. On the rendered preview that's a
  // timeline time; otherwise select the word's clip and seek within its file.
  function seekToCaption(word: TimelineWord) {
    const seg = captionSegments.find((s) => s.clipId === word.clipId);
    if (!seg) return;
    const v = videoRef.current;
    if (showingProgram) {
      if (v) v.currentTime = word.startMs / 1000;
      setCurrentTime(word.startMs / 1000);
      return;
    }
    const sourceMs = seg.trimInMs + (word.startMs - seg.offsetMs);
    if (selectedClipId === word.clipId && v) {
      v.currentTime = sourceMs / 1000;
      setCurrentTime(sourceMs / 1000);
    } else {
      pendingSourceSeekMs.current = sourceMs;
      setSelectedClipId(word.clipId);
    }
  }
  const inProgress =
    latestJob && ["queued", "transcribing", "planning", "rendering"].includes(latestJob.status);

  const activeVideoSrc =
    viewMode === "source"
      ? selectedClipUrl
      : viewMode === "program"
      ? previewUrl ?? selectedClipUrl
      : previewUrl ?? selectedClipUrl;

  const selectedClip = selectedClipId
    ? (clips.find((c) => c.id === selectedClipId) as ClipRow | undefined)
    : undefined;

  // ---- Timeline actions ----
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  function doDelete() {
    if (!selectedClipId || !selectedClip) {
      toast("Select a clip first");
      return;
    }
    
    const clipToDelete = { ...selectedClip };
    const originalOrder = videoClips.map((c) => ({
      id: c.id,
      ordinal: c.ordinal,
      role: c.role,
    }));
    
    pushToHistory({
      description: "Delete clip",
      undo: async () => {
        const recreated = await attachFn({
          data: {
            project_id: projectId,
            storage_path: clipToDelete.storage_path,
            filename: clipToDelete.filename,
            size_bytes: clipToDelete.size_bytes ?? 0,
            role: clipToDelete.role as any,
            ordinal: clipToDelete.ordinal,
            duration_ms: clipToDelete.duration_ms ?? undefined,
            trim_in_ms: clipToDelete.trim_in_ms ?? undefined,
            trim_out_ms: clipToDelete.trim_out_ms ?? undefined,
            parent_clip_id: clipToDelete.parent_clip_id ?? undefined,
          },
        });
        
        const restoredOrder = originalOrder.map((o) => {
          if (o.id === clipToDelete.id) {
            return { ...o, id: recreated.id };
          }
          return o;
        });
        await reorder({ data: { project_id: projectId, order: restoredOrder } });
        setSelectedClipId(recreated.id);
        refetch();
      },
      redo: () => {
        const currentClips = qc.getQueryData<{ clips: ClipRow[] }>(["project", projectId])?.clips || clips;
        const matchingClip = currentClips.find(
          (c) => c.storage_path === clipToDelete.storage_path && c.ordinal === clipToDelete.ordinal
        );
        if (matchingClip) {
          removeClipMut.mutate(matchingClip.id);
        } else {
          removeClipMut.mutate(clipToDelete.id);
        }
      },
    });
    
    removeClipMut.mutate(selectedClipId);
  }

  function doDuplicate() {
    if (!selectedClipId) {
      toast("Select a clip first");
      return;
    }
    
    duplicateMut.mutate(selectedClipId, {
      onSuccess: (copy) => {
        if (copy?.id) {
          pushToHistory({
            description: "Duplicate clip",
            undo: () => {
              removeClipMut.mutate(copy.id);
            },
            redo: () => {
              duplicateMut.mutate(selectedClipId);
            },
          });
        }
      },
    });
  }

  function doSplit() {
    if (!selectedClipId || !selectedClip) {
      toast("Select a clip first");
      return;
    }
    const trimIn = selectedClip.trim_in_ms ?? 0;
    const playheadMs = Math.round(currentTime * 1000);
    // Split point measured from the start of the clip's visible part. The
    // playhead is a program position when the rendered preview is showing,
    // and a position in the clip's source file otherwise.
    const relative = showingProgram
      ? playheadMs - (programOffsets.get(selectedClipId) ?? 0)
      : playheadMs - trimIn;
    if (showingProgram && (relative < 0 || relative > clipVisibleMs(selectedClip))) {
      toast("Move the playhead over the selected clip to split");
      return;
    }
    if (relative < 100) {
      toast("Move the playhead further into the clip to split");
      return;
    }
    
    const originalTrimOut = selectedClip.trim_out_ms;
    const originalOrder = videoClips.map((c) => ({
      id: c.id,
      ordinal: c.ordinal,
      role: c.role,
    }));
    
    splitMut.mutate(
      { id: selectedClipId, at_ms: relative },
      {
        onSuccess: (res) => {
          if (res?.right_id) {
            pushToHistory({
              description: "Split clip",
              undo: async () => {
                await dropClip({ data: { id: res.right_id } });
                await trimFn({ data: { id: res.left_id, trim_in_ms: trimIn, trim_out_ms: originalTrimOut } });
                await reorder({ data: { project_id: projectId, order: originalOrder } });
                setSelectedClipId(res.left_id);
                refetch();
              },
              redo: () => {
                splitMut.mutate({ id: res.left_id, at_ms: relative });
              },
            });
          }
        },
      }
    );
  }

  // One zoom step in (1) or out (-1); steps multiply so they feel even.
  function zoom(direction: 1 | -1) {
    setPxPerSec((z) => clampZoom(z * ZOOM_STEP ** direction));
  }

  const seekRelative = (offset: number) => {
    const v = videoRef.current;
    if (!v) return;
    const target = Math.max(0, Math.min(v.duration || duration, v.currentTime + offset));
    v.currentTime = target;
    if (viewMode === "compare" && sourceVideoRef.current) {
      sourceVideoRef.current.currentTime = target;
    }
    setCurrentTime(target);
  };

  const seekAbsolute = (time: number) => {
    const v = videoRef.current;
    if (!v) return;
    const target = Math.max(0, Math.min(v.duration || duration, time));
    v.currentTime = target;
    if (viewMode === "compare" && sourceVideoRef.current) {
      sourceVideoRef.current.currentTime = target;
    }
    setCurrentTime(target);
  };

  // Refresh the ref so keyboard shortcuts always call the latest closures.
  actionsRef.current = {
    play: togglePlay,
    del: doDelete,
    dup: doDuplicate,
    split: doSplit,
    zoom,
    undo,
    redo,
    seekRelative,
    seekAbsolute,
  };

  return (
    <div
      className="relative h-screen w-screen bg-[#0a0a0f] text-neutral-200 flex flex-col overflow-hidden font-sans"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragActive(false);
        handleUpload(e.dataTransfer.files);
      }}
    >
      {dragActive && (
        <div className="absolute inset-0 z-50 pointer-events-none grid place-items-center bg-violet-600/15 backdrop-blur-sm">
          <div className="pointer-events-none border-2 border-dashed border-violet-500 rounded-2xl p-10 text-center bg-black/85 shadow-2xl">
            <UploadCloud className="w-10 h-10 text-violet-400 mx-auto" />
            <div className="mt-3 text-sm font-semibold text-violet-300">Drop video files to add to project</div>
            <div className="mt-1 text-[11px] text-neutral-400 font-mono">
              MP4, MOV, WebM · Auto-assigned to timeline
            </div>
          </div>
        </div>
      )}

      <EditorShell
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        showRightPanel={showRightPanel}
        onToggleRightPanel={() => setShowRightPanel((v) => !v)}
        topBar={
          <EditorTopBar
            title={project.title}
            onTitleChange={(newTitle) =>
              updateSettings({ data: { id: projectId, title: newTitle } })
            }
            isSaving={isMutating > 0}
            aspectRatio={project.aspect_ratio}
            onAspectRatioChange={(ratio) => changeAspect.mutate(ratio)}
            onOpenRender={() =>
              project.status === "ready" ? setExportOpen(true) : render.mutate()
            }
            isRenderDisabled={
              render.isPending || (inProgress && project.status !== "ready")
            }
            clipCount={clips.length}
            onUndo={undo}
            onRedo={redo}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
          />
        }
        leftPanel={
          <MediaLibrary
            clips={videoClips}
            audioClips={audioClips}
            selectedClipId={selectedClipId}
            onSelectClip={(id) => setSelectedClipId(id)}
            onRemoveClip={(id) => removeClipMut.mutate(id)}
            onUpload={(files) => handleUpload(files)}
            isUploading={uploading}
          />
        }
        centerPanel={
          <PreviewCanvas
            aspectRatio={project.aspect_ratio}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            programUrl={previewUrl}
            sourceUrl={selectedClipUrl}
            selectedClipFilename={selectedClip?.filename}
            hasClips={videoClips.length > 0}
            isRendering={Boolean(inProgress)}
            renderProgress={latestJob?.progress ?? 0}
            renderStageMessage={latestJob?.stage_message}
            playing={playing}
            onTogglePlay={togglePlay}
            currentTime={currentTime}
            duration={duration}
            onSeek={seekTo}
            onSkipBack={() => seekAbsolute(0)}
            onSkipForward={() => seekAbsolute(duration)}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            videoRef={videoRef}
            sourceVideoRef={sourceVideoRef}
            onTimeUpdate={(t) => setCurrentTime(t)}
            onLoadedMetadata={(d) => {
              setDuration(d);
              if (pendingSourceSeekMs.current != null && videoRef.current) {
                videoRef.current.currentTime = pendingSourceSeekMs.current / 1000;
                setCurrentTime(pendingSourceSeekMs.current / 1000);
                pendingSourceSeekMs.current = null;
              }
              if (selectedClipId && d > 0) {
                const c = data?.clips.find((x) => x.id === selectedClipId) as ClipRow | undefined;
                if (c && (c.duration_ms == null || Math.abs(c.duration_ms - Math.round(d * 1000)) > 250)) {
                  durationMut.mutate({ id: selectedClipId, duration_ms: Math.round(d * 1000) });
                }
              }
            }}
          />
        }
        rightPanel={
          <div className="flex flex-col h-full min-h-0">
            {/* Edit (clip inspector / AI) or Captions */}
            <div className="h-9 border-b border-white/[0.06] flex items-center px-1 gap-0.5 shrink-0">
              {(["edit", "captions"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setRightTab(tab)}
                  aria-pressed={rightTab === tab}
                  className={cn(
                    "px-2.5 h-6 rounded text-[11px] font-medium transition-colors",
                    rightTab === tab
                      ? "bg-white/[0.08] text-violet-300"
                      : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.03]",
                  )}
                >
                  {tab === "edit" ? (selectedClip ? "Clip" : "AI") : "Captions"}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              {rightTab === "captions" ? (
                <CaptionsPanel
                  segments={captionSegments}
                  transcripts={transcriptMap}
                  isLoading={transcriptsQuery.isLoading}
                  loadError={transcriptsQuery.error ? transcriptsQuery.error.message : null}
                  captionsEnabled={captionsEnabled}
                  currentTimeMs={timelinePlayheadMs}
                  onSeek={seekToCaption}
                  onSaveWords={async (storagePath, words) => {
                    await saveWordsMut.mutateAsync({ storage_path: storagePath, words });
                  }}
                  isSaving={saveWordsMut.isPending}
                />
              ) : selectedClip ? (
                <ClipInspector
                  clip={selectedClip}
                  onDeselect={() => setSelectedClipId(null)}
                  onSplit={doSplit}
                  onDuplicate={doDuplicate}
                  onDelete={doDelete}
                  onTrim={(id, trimInMs, trimOutMs) =>
                    trimMut.mutate({ id, trim_in_ms: trimInMs, trim_out_ms: trimOutMs })
                  }
                  isSplitting={splitMut.isPending}
                  isDuplicating={duplicateMut.isPending}
                  isDeleting={removeClipMut.isPending}
                />
              ) : (
                <AIMotionPanel
                  projectId={projectId}
                  status={project.status}
                  latestJob={latestJob}
                  clipCount={clips.length}
                  preset={project.style_preset}
                  script={project.script}
                  musicEnabled={musicEnabled}
                  musicVolume={musicVolume}
                  captionsEnabled={captionsEnabled}
                  captionsText={captionsText}
                  onScriptChange={setCaptionsText}
                  onScriptBlur={() => {
                    if (captionsText !== null && captionsText !== project.script) {
                      updateSettings({ data: { id: projectId, script: captionsText } });
                    }
                  }}
                  onMusicEnabledChange={setMusicEnabled}
                  onMusicVolumeChange={setMusicVolume}
                  onCaptionsEnabledChange={setCaptionsEnabled}
                />
              )}
            </div>
          </div>
        }
        bottomPanel={
          <TimelinePanel
            projectTitle={project.title}
            aRoll={aRoll}
            bRoll={bRoll}
            videoClips={videoClips}
            selectedClipId={selectedClipId}
            onSelect={(id) => setSelectedClipId(id)}
            onTrim={(id, ti, to) => {
              const c = clips.find((x) => x.id === id);
              if (!c) return;
              const prevIn = c.trim_in_ms ?? 0;
              const prevOut = c.trim_out_ms ?? null;

              pushToHistory({
                description: "Trim clip",
                undo: () => {
                  trimMut.mutate({ id, trim_in_ms: prevIn, trim_out_ms: prevOut });
                },
                redo: () => {
                  trimMut.mutate({ id, trim_in_ms: ti, trim_out_ms: to });
                },
              });

              trimMut.mutate({ id, trim_in_ms: ti, trim_out_ms: to });
            }}
            captions={captionsEnabled}
            music={musicEnabled}
            snapEnabled={snapEnabled}
            onSnapToggle={() => setSnapEnabled((s) => !s)}
            pxPerSec={pxPerSec}
            onZoom={zoom}
            onPxPerSecChange={setPxPerSec}
            currentTimeMs={timelinePlayheadMs}
            onSeekMs={(clipId, absMs, atTimelineMs) => {
              const v = videoRef.current;
              if (showingProgram) {
                // The rendered preview: seek straight to the timeline time.
                if (v) v.currentTime = atTimelineMs / 1000;
                setCurrentTime(atTimelineMs / 1000);
                if (clipId && clipId !== selectedClipId) setSelectedClipId(clipId);
              } else if (clipId === selectedClipId) {
                // The selected clip's own file: seek within it.
                if (v) v.currentTime = absMs / 1000;
                setCurrentTime(absMs / 1000);
              } else if (clipId) {
                // Another clip: select it and seek once its video loads.
                pendingSourceSeekMs.current = absMs;
                setSelectedClipId(clipId);
              }
            }}
            reorderMut={reorderMut}
            pushToHistory={pushToHistory}
            onSplit={doSplit}
            onDuplicate={doDuplicate}
            onDelete={doDelete}
            onUndo={undo}
            onRedo={redo}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            isSplitting={splitMut.isPending}
            isDuplicating={duplicateMut.isPending}
            isDeleting={removeClipMut.isPending}
          />
        }
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        onConfirm={downloadFinal}
        loading={downloading}
        defaultFileName={project.title || "stuccord-export"}
        progressPct={renderPct}
        progressMsg={renderMsg}
      />
    </div>
  );
}
