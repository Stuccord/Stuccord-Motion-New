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
  getSignedClipUploadUrl,
} from "@/lib/projects.functions";
import { renderProjectInBrowser, aspectDims } from "@/lib/client-render";

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

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: "Editor — Stuccord Motion" }] }),
  component: EditorPage,
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
    ssr: false,
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
  const [captionsText, setCaptionsText] = useState("");
  const [activePool, setActivePool] = useState<"clips" | "audio" | "assets" | "effects">("clips");
  const [inspectorTab, setInspectorTab] = useState<"ai" | "notes">("ai");
  const [mobileView, setMobileView] = useState<"edit" | "media">("edit");
  const [mobileFullscreen, setMobileFullscreen] = useState(false);

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
    mutationFn: () => runRender({ data: { project_id: projectId } }),
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
    onSuccess: () => {
      setSelectedClipId(null);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderMut = useMutation({
    mutationFn: (args: { project_id?: string; order: { id: string; ordinal: number; role?: string }[] } | { id: string; ordinal: number; role?: string }[]) => {
      const order = Array.isArray(args) ? args : args.order;
      const pId = (!Array.isArray(args) && args.project_id) ? args.project_id : projectId;
      return reorder({ data: { project_id: pId, order } });
    },
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
    zoom: (d: number) => void;
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
        actionsRef.current.zoom(20);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        actionsRef.current.zoom(-20);
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
        const signed = await getSignedClipUploadFn({
          data: { project_id: projectId, filename: f.name, ordinal: startOrdinal + i },
        });
        const { error: upErr } = await supabase.storage
          .from("raw-clips")
          .uploadToSignedUrl(signed.path, signed.token, f, { contentType: f.type, upsert: true });
        if (upErr) throw new Error(`${f.name}: ${upErr.message}`);
        await attachFn({
          data: {
            project_id: projectId,
            storage_path: signed.path,
            filename: f.name,
            size_bytes: f.size,
            role,
            ordinal: startOrdinal + i,
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
      // If a completed render already exists, just download it.
      if (data?.project.output_path && data.latestJob?.status === "completed") {
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
  const inProgress =
    latestJob && ["queued", "transcribing", "planning", "rendering"].includes(latestJob.status);

  const activeVideoSrc =
    viewMode === "source"
      ? selectedClipUrl
      : viewMode === "program"
      ? previewUrl ?? selectedClipUrl
      : previewUrl ?? selectedClipUrl;
  const timecode = formatTimecode((latestJob?.progress ?? 0) * 0.6);

  const selectedClip = selectedClipId
    ? (clips.find((c) => c.id === selectedClipId) as ClipRow | undefined)
    : undefined;

  const videoLayout = useMemo(() => {
    let cursor = 0;
    const offsets = new Map<string, number>();
    for (const c of videoClips) {
      offsets.set(c.id, cursor);
      cursor += clipVisibleMs(c);
    }
    return { totalMs: Math.max(cursor, 10000), offsets };
  }, [videoClips]);

  const timelinePlayheadMs = useMemo(() => {
    if (viewMode === "program" || viewMode === "compare") {
      return Math.round(currentTime * 1000);
    }
    if (!selectedClipId || !selectedClip) return 0;
    const offset = videoLayout.offsets.get(selectedClipId) ?? 0;
    const relInClip = Math.round(currentTime * 1000) - (selectedClip.trim_in_ms ?? 0);
    return offset + Math.max(0, relInClip);
  }, [viewMode, currentTime, selectedClipId, selectedClip, videoLayout.offsets]);

  // Auto-select clip under playhead when playing in program mode
  useEffect(() => {
    if ((viewMode === "program" || viewMode === "compare") && playing) {
      const tMs = currentTime * 1000;
      let acc = 0;
      for (const c of videoClips) {
        const w = clipVisibleMs(c);
        if (tMs >= acc && tMs <= acc + w) {
          if (selectedClipId !== c.id) {
            setSelectedClipId(c.id);
          }
          break;
        }
        acc += w;
      }
    }
  }, [currentTime, playing, viewMode, videoClips, selectedClipId]);

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
    const absMs = Math.round(currentTime * 1000);
    const relative = absMs - trimIn;
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

  function zoom(delta: number) {
    setPxPerSec((z) => Math.max(8, Math.min(240, Math.round(z + delta))));
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
      className="relative min-h-screen w-full bg-[#0a0a0f] text-neutral-200 flex flex-col overflow-hidden font-sans"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the whole editor
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
        <div className="absolute inset-0 z-50 pointer-events-none grid place-items-center bg-primary/10 backdrop-blur-sm">
          <div className="pointer-events-none border-2 border-dashed border-primary rounded-2xl p-10 text-center bg-black/60 shadow-2xl">
            <UploadCloud className="w-10 h-10 text-primary mx-auto" />
            <div className="mt-3 text-sm font-semibold text-primary">Drop to add to project</div>
            <div className="mt-1 text-[11px] text-primary/80 font-mono">
              Videos → A-roll · B-roll &nbsp;·&nbsp; Audio → Music track
            </div>
          </div>
        </div>
      )}
      {/* ============ TOP MENU BAR ============ */}
      <header className="h-11 bg-gradient-to-b from-[#161620] to-[#0f0f18] border-b border-white/[0.06] flex items-center px-2 sm:px-3 gap-1.5 sm:gap-2 shrink-0 select-none">
        <Link
          to="/projects"
          className="flex items-center gap-2 px-1.5 sm:px-2 py-1 rounded-md hover:bg-white/5 text-neutral-200 min-w-0"
        >
          <img src={logoUrl} alt="Stuccord" className="h-5 w-5 rounded shrink-0" />
          <span className="hidden sm:inline text-sm font-semibold tracking-tight truncate">Stuccord Motion</span>
        </Link>
        <div className="hidden md:flex items-center gap-1">
          <div className="h-4 w-px bg-white/10 mx-1" />
          <DropdownMenu>
            <DropdownMenuTrigger className="px-2 py-1 rounded text-[11px] text-neutral-300 hover:text-white hover:bg-white/5 transition font-medium focus:outline-none">
              File
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-[#141420] border-white/10 text-neutral-200 text-[12px]">
              <DropdownMenuItem onClick={() => navigate({ to: "/projects" })}>Back to Projects</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setExportOpen(true)} disabled={clips.length === 0}>Export Video</DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem onClick={() => refetch()}>Refresh Project</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className="px-2 py-1 rounded text-[11px] text-neutral-300 hover:text-white hover:bg-white/5 transition font-medium focus:outline-none">
              Edit
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-[#141420] border-white/10 text-neutral-200 text-[12px]">
              <DropdownMenuItem onClick={undo} disabled={history.past.length === 0}>Undo (Ctrl+Z)</DropdownMenuItem>
              <DropdownMenuItem onClick={redo} disabled={history.future.length === 0}>Redo (Ctrl+Y)</DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem onClick={doSplit} disabled={!selectedClipId}>Split Clip (S)</DropdownMenuItem>
              <DropdownMenuItem onClick={doDuplicate} disabled={!selectedClipId}>Duplicate Clip (Ctrl+D)</DropdownMenuItem>
              <DropdownMenuItem onClick={doDelete} disabled={!selectedClipId}>Delete Clip (Del)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className="px-2 py-1 rounded text-[11px] text-neutral-300 hover:text-white hover:bg-white/5 transition font-medium focus:outline-none">
              View
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-[#141420] border-white/10 text-neutral-200 text-[12px]">
              <DropdownMenuItem onClick={() => setSnapEnabled((s) => !s)}>
                Magnetic Snapping ({snapEnabled ? "ON" : "OFF"})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPxPerSec(40)}>Reset Zoom</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-3 min-w-0">
          {inProgress && (
            <Badge variant="destructive" className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono animate-pulse px-2 py-0.5">
              <Circle className="w-2 h-2 fill-white text-white" />
              <span>REC {timecode}</span>
            </Badge>
          )}
          <Select
            value={project.aspect_ratio}
            onValueChange={(v) => changeAspect.mutate(v as "9:16" | "16:9" | "1:1")}
          >
            <SelectTrigger className="h-7 w-[76px] sm:w-[128px] bg-white/5 border-white/10 text-[11px] text-neutral-200 hover:bg-white/10 px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="9:16">9:16 · Reels / Shorts</SelectItem>
              <SelectItem value="16:9">16:9 · YouTube</SelectItem>
              <SelectItem value="1:1">1:1 · Feed square</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="hidden lg:inline-flex bg-primary/10 border-primary/30 text-primary text-[11px] font-semibold tracking-wide px-2.5 py-0.5">
            {project.style_preset === "gadzhi"
              ? "Iman Gadzhi Mode"
              : project.style_preset === "hormozi"
              ? "Hormozi Mode"
              : project.style_preset === "cinematic"
              ? "Cinematic Mode"
              : project.style_preset === "podcast"
              ? "Podcast Mode"
              : `${project.style_preset} Mode`}
          </Badge>
          <button
            onClick={() => navigate({ to: "/projects" })}
            className="hidden sm:inline-flex p-1.5 rounded-md hover:bg-white/5 text-neutral-400"
            aria-label="Close"
            title="Back to projects"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Button
            size="sm"
            onClick={() => (project.status === "ready" ? setExportOpen(true) : render.mutate())}
            disabled={render.isPending || (inProgress && project.status !== "ready") || clips.length === 0}
            className="h-7 px-2.5 sm:px-3 bg-gradient-to-r from-primary to-primary/60 hover:from-primary hover:to-primary/60 text-neutral-950 font-semibold text-[12px] border-0 shrink-0"
          >
            {downloading || render.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : project.status === "ready" ? (
              <Download className="w-3.5 h-3.5" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{project.status === "ready" ? "Export" : inProgress ? "Rendering…" : "Start AI Edit"}</span>
            <span className="sm:hidden">{project.status === "ready" ? "Export" : inProgress ? "…" : "Edit"}</span>
          </Button>
        </div>
      </header>

      {/* ============ MAIN GRID ============ */}
      <div className="flex-1 flex flex-col md:grid md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] min-h-0 pb-11 md:pb-0">
        {/* ===== LEFT COLUMN (Media Pool + AI Notes) ===== */}
        <div className={cn(
          "md:row-span-2 border-r border-white/[0.06] flex-col min-h-0 bg-[#0d0d14]",
          mobileView === "media" ? "flex flex-1" : "hidden",
          "md:flex",
        )}>
          {/* Media Pool */}
          <div className="flex-1 flex flex-col min-h-0 border-b border-white/[0.06]">
            <PanelTabs
              tabs={[
                { key: "clips", label: "Clips" },
                { key: "audio", label: "Audio" },
                { key: "assets", label: "Assets" },
              ]}
              active={activePool}
              onChange={(k) => setActivePool(k as typeof activePool)}
              rightLabel="Media Pool"
            />
            <div
              className="flex-1 overflow-y-auto p-2 space-y-1"
              onDragOver={(e) => {
                if (activePool === "clips") e.preventDefault();
              }}
              onDrop={(e) => {
                if (activePool !== "clips") return;
                e.preventDefault();
                if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
              }}
            >
              {activePool === "clips" && (
                <>
                  <button
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary border border-dashed border-white/15 hover:border-primary/50 hover:bg-primary/5 rounded-md py-2.5 mb-1 transition"
                  >
                    {uploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    {uploading ? "Uploading…" : "Import media"}
                  </button>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    accept="video/*,audio/*"
                    hidden
                    onChange={(e) => e.target.files && handleUpload(e.target.files)}
                  />
                  {videoClips.length === 0 ? (
                    <EmptyState
                      icon={UploadCloud}
                      text="Drop video or audio"
                      hint="Videos → A/B-roll · Audio → music track"
                    />
                  ) : (
                    videoClips.map((c, i) => (
                      <MediaItem
                        key={c.id}
                        clip={c}
                        index={i}
                        selected={selectedClipId === c.id}
                        onSelect={() => setSelectedClipId(c.id)}
                        onRemove={() => removeClipMut.mutate(c.id)}
                      />
                    ))
                  )}
                </>
              )}
              {activePool === "audio" && (
                audioClips.length === 0 ? (
                  <EmptyState icon={Music2} text="No audio tracks" hint="Drop MP3/WAV to add music" />
                ) : (
                  audioClips.map((c, i) => (
                    <MediaItem
                      key={c.id}
                      clip={c}
                      index={i}
                      selected={selectedClipId === c.id}
                      onSelect={() => setSelectedClipId(c.id)}
                      onRemove={() => removeClipMut.mutate(c.id)}
                    />
                  ))
                )
              )}
              {activePool === "assets" && (
                <EmptyState icon={Layers} text="No graphics" hint="AI adds overlays" />
              )}
            </div>
          </div>

          {/* Effects panel */}
          <div className="border-b border-white/[0.06] max-h-[180px] flex flex-col">
            <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-neutral-500 font-semibold">
              Effects
            </div>
            <div className="px-2 pb-2 space-y-0.5 overflow-y-auto">
              <EffectRow icon={Music2} label="Audio" />
              <EffectRow icon={Layers} label="Assets" />
              <EffectRow icon={Wand2} label="Transitions" />
              <EffectRow icon={Type} label="Typography" />
            </div>
          </div>

          {/* AI Director Sidebar */}
          <div className="flex-1 min-h-0 flex flex-col">
            <PanelTabs
              tabs={[
                { key: "ai", label: "AI Director" },
                { key: "notes", label: "AI Notes" },
              ]}
              active={inspectorTab}
              onChange={(k) => setInspectorTab(k as typeof inspectorTab)}
              rightLabel=""
            />
            <div className="flex-1 overflow-y-auto p-3 text-[11.5px] leading-relaxed text-neutral-300 space-y-2.5">
              {inspectorTab === "ai" ? (
                <AIDirectorPanel
                  status={project.status}
                  latestJob={latestJob}
                  clipCount={clips.length}
                  preset={project.style_preset}
                />
              ) : (
                <div className="space-y-3">
                  <label className="block">
                    <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-semibold">
                      Captions
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <Switch
                        checked={captionsEnabled}
                        onCheckedChange={setCaptionsEnabled}
                        className="data-[state=checked]:bg-primary"
                      />
                      <span className="text-[11px] text-neutral-400">Burn word-by-word</span>
                    </div>
                    <Textarea
                      value={captionsText || (project.script ?? "")}
                      onChange={(e) => setCaptionsText(e.target.value)}
                      placeholder="AI captions will be generated from audio. Override here…"
                      className="min-h-24 bg-black/40 border-white/10 text-neutral-200 text-[11px] font-mono resize-none"
                    />
                  </label>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-semibold">
                      Music
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <Switch
                        checked={musicEnabled}
                        onCheckedChange={setMusicEnabled}
                        className="data-[state=checked]:bg-primary"
                      />
                      <span className="text-[11px] text-neutral-400">Auto-score & duck under VO</span>
                    </div>
                    {musicEnabled && (
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-3 h-3 text-neutral-500" />
                        <Slider
                          value={[musicVolume]}
                          onValueChange={(v) => setMusicVolume(v[0])}
                          max={100}
                          step={1}
                          className="flex-1"
                        />
                        <span className="text-[10px] font-mono text-neutral-500 w-7 text-right tabular-nums">
                          {musicVolume}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== VIDEO PREVIEW ===== */}
        <div className={cn(
          "flex-col min-h-0 bg-[#050508]",
          mobileFullscreen
            ? "fixed inset-0 z-50 flex"
            : cn(
                mobileView === "edit" ? "flex flex-1 min-h-0" : "hidden",
                "md:flex md:h-auto md:shrink md:relative md:z-auto",
              ),
        )}>



          <div className="px-3 h-8 border-b border-white/[0.06] flex items-center text-[10px] uppercase tracking-widest text-neutral-500 font-semibold gap-2">
            <MonitorPlay className="w-3 h-3" />
            <span>Monitor</span>
            <div className="ml-3 flex items-center rounded-md border border-white/10 overflow-hidden">
              {(["program", "source", "compare"] as const).map((m) => {
                const disabled =
                  (m === "program" && !previewUrl) ||
                  (m === "source" && !selectedClipUrl) ||
                  (m === "compare" && (!previewUrl || !selectedClipUrl));
                return (
                  <button
                    key={m}
                    onClick={() => !disabled && setViewMode(m)}
                    disabled={disabled}
                    className={cn(
                      "px-2 h-6 text-[10px] normal-case tracking-normal font-medium transition",
                      viewMode === m
                        ? "bg-primary/20 text-primary"
                        : "text-neutral-400 hover:bg-white/5",
                      disabled && "opacity-30 cursor-not-allowed hover:bg-transparent",
                    )}
                    title={
                      m === "compare"
                        ? "Split: original vs AI edit"
                        : m === "source"
                        ? "Original selected clip"
                        : "Final AI edit"
                    }
                  >
                    {m === "program" ? "Program" : m === "source" ? "Source" : "Compare"}
                  </button>
                );
              })}
            </div>
            {viewMode === "compare" && (
              <span className="ml-auto px-1.5 py-px rounded bg-fuchsia-500/15 text-fuchsia-300 text-[9px] normal-case tracking-normal">
                Drag divider to reveal
              </span>
            )}
            {viewMode !== "compare" && project.status === "ready" && viewMode === "program" && (
              <span className="ml-auto px-1.5 py-px rounded bg-emerald-500/15 text-emerald-400 text-[9px] normal-case tracking-normal">
                Final render
              </span>
            )}
            {viewMode === "source" && (
              <span className="ml-auto px-1.5 py-px rounded bg-primary/15 text-primary text-[9px] normal-case tracking-normal">
                Source clip
              </span>
            )}
            <button
              onClick={() => setMobileFullscreen((v) => !v)}
              className="md:hidden ml-auto grid place-items-center h-6 w-6 rounded border border-white/10 text-neutral-300 hover:bg-white/5 hover:text-white transition"
              title={mobileFullscreen ? "Exit fullscreen" : "Fullscreen preview"}
              aria-label={mobileFullscreen ? "Exit fullscreen" : "Fullscreen preview"}
            >
              {mobileFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
          </div>

          <div className="flex-1 min-h-0 grid place-items-center p-1.5 sm:p-4 bg-[radial-gradient(ellipse_at_center,rgba(20,184,166,0.06),transparent_60%)]">
            {activeVideoSrc || (viewMode === "compare" && previewUrl && selectedClipUrl) ? (
              <div
                className="relative bg-black rounded-md shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/5 overflow-hidden select-none"
                style={{
                  aspectRatio: project.aspect_ratio.replace(":", " / "),
                  maxHeight: "100%",
                  maxWidth: "100%",
                  height: project.aspect_ratio === "9:16" ? "100%" : undefined,
                  width: project.aspect_ratio !== "9:16" ? "100%" : undefined,
                }}
              >
                {viewMode === "compare" && previewUrl && selectedClipUrl ? (
                  <>
                    {/* Base layer: Program (AI edit) */}
                    <video
                      ref={videoRef}
                      key={`prog-${previewUrl}`}
                      src={previewUrl}
                      className="absolute inset-0 w-full h-full object-contain bg-black"
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onEnded={() => setPlaying(false)}
                      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                      muted={muted}
                      playsInline
                    />
                    {/* Clipped overlay: Source (original) */}
                    <div
                      className="absolute inset-y-0 left-0 overflow-hidden"
                      style={{ width: `${splitPct}%` }}
                    >
                      <video
                        ref={sourceVideoRef}
                        key={`src-${selectedClipUrl}`}
                        src={selectedClipUrl}
                        className="absolute inset-0 h-full object-contain bg-black"
                        style={{ width: `${(100 / splitPct) * 100}%` }}
                        muted
                        playsInline
                      />
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-primary/25 backdrop-blur text-[10px] font-mono text-primary border border-primary/40 uppercase tracking-wider">
                        Source
                      </div>
                    </div>
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-emerald-500/25 backdrop-blur text-[10px] font-mono text-emerald-100 border border-emerald-400/40 uppercase tracking-wider">
                      Program
                    </div>
                    {/* Divider handle */}
                    <div
                      className="absolute inset-y-0 z-10 cursor-ew-resize group"
                      style={{ left: `calc(${splitPct}% - 12px)`, width: 24 }}
                      onPointerDown={(e) => {
                        const el = e.currentTarget.parentElement as HTMLElement | null;
                        if (!el) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        const rect = el.getBoundingClientRect();
                        const move = (ev: PointerEvent) => {
                          const pct = ((ev.clientX - rect.left) / rect.width) * 100;
                          setSplitPct(Math.max(4, Math.min(96, pct)));
                        };
                        const up = () => {
                          window.removeEventListener("pointermove", move);
                          window.removeEventListener("pointerup", up);
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", up);
                      }}
                    >
                      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/70 group-hover:bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white text-neutral-900 grid place-items-center shadow-lg">
                        <ChevronLeft className="w-3 h-3 -mr-0.5" />
                        <ChevronRight className="w-3 h-3 -ml-0.5" />
                      </div>
                    </div>
                  </>
                ) : (
                  <video
                    ref={videoRef}
                    key={activeVideoSrc!}
                    src={activeVideoSrc!}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration || 0;
                      setDuration(d);
                      // Persist real source duration so timeline clip widths become truthful.
                      if (selectedClipId && d > 0) {
                        const c = data?.clips.find((x) => x.id === selectedClipId) as ClipRow | undefined;
                        if (c && (c.duration_ms == null || Math.abs(c.duration_ms - Math.round(d * 1000)) > 250)) {
                          durationMut.mutate({ id: selectedClipId, duration_ms: Math.round(d * 1000) });
                        }
                      }
                    }}

                    muted={muted}
                    playsInline
                  />
                )}
                <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-mono text-neutral-300 border border-white/10">
                  {project.aspect_ratio}
                </div>
              </div>
            ) : (
              <PreviewIdle
                status={project.status}
                inProgress={!!inProgress}
                progress={latestJob?.progress ?? 0}
                aspectRatio={project.aspect_ratio}
              />
            )}
          </div>

          {/* Transport: scrub + controls */}
          <div className="border-t border-white/[0.06] bg-[#0d0d14]">
            <div className="px-3 pt-2 pb-1.5">
              <div
                role="slider"
                aria-label="Playhead"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(playheadPct)}
                className="relative h-1.5 rounded-full bg-white/[0.06] cursor-pointer group touch-none"
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const move = (clientX: number) => {
                    const pct = ((clientX - rect.left) / rect.width) * 100;
                    seekTo(Math.max(0, Math.min(100, pct)));
                  };
                  move(e.clientX);
                  const onMove = (ev: PointerEvent) => move(ev.clientX);
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[color:var(--color-primary)] to-primary shadow-[0_0_10px_-2px_color-mix(in_oklab,var(--color-primary)_60%,transparent)]"
                  style={{ width: `${playheadPct}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white ring-2 ring-[color:var(--color-primary)] shadow-md opacity-0 group-hover:opacity-100 transition"
                  style={{ left: `calc(${playheadPct}% - 6px)` }}
                />
              </div>
            </div>
            <div className="h-9 flex items-center gap-1 px-3 pb-1">
              <TransportBtn
                icon={SkipBack}
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = 0;
                  if (viewMode === "compare" && sourceVideoRef.current) sourceVideoRef.current.currentTime = 0;
                  setCurrentTime(0);
                }}
              />
              <TransportBtn
                icon={playing ? Pause : Play}
                onClick={() => {
                  if (!videoRef.current) return;
                  if (playing) {
                    videoRef.current.pause();
                    sourceVideoRef.current?.pause();
                  } else {
                    videoRef.current.play();
                    if (viewMode === "compare") sourceVideoRef.current?.play();
                  }
                }}
                accent
              />
              <TransportBtn
                icon={SkipForward}
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = videoRef.current.duration || 0;
                }}
              />
              <div className="text-[10.5px] font-mono ml-2 tabular-nums">
                <span className="text-neutral-200">{formatTimecode(currentTime)}</span>
                <span className="text-neutral-600"> / {duration > 0 ? formatTimecode(duration) : "—"}</span>
              </div>
              <div className="flex-1" />
              <TransportBtn icon={muted ? VolumeX : Volume2} onClick={() => setMuted((m) => !m)} />
              <TransportBtn
                icon={Maximize2}
                onClick={() => videoRef.current?.requestFullscreen?.()}
              />
            </div>
          </div>
        </div>

        {/* ===== TIMELINE ===== */}
        <div className={cn(
          "border-t border-white/[0.06] bg-[#0b0b12] flex-col min-h-0 md:max-h-[46vh]",
          mobileView === "edit" ? "flex h-[36vh] shrink-0" : "hidden",
          "md:flex md:h-auto md:flex-1",
        )}>

          <div className="h-11 px-2 sm:px-3 flex items-center gap-1 border-b border-white/[0.06] shrink-0 bg-[#0a0a12]">
            {/* Left cluster: edit tools */}
            <TimelineToolBtn icon={MousePointer2} title="Select (V)" active />
            <TimelineToolBtn
              icon={Undo2}
              title="Undo (Ctrl+Z / ⌘Z)"
              onClick={undo}
              disabled={history.past.length === 0}
            />
            <TimelineToolBtn
              icon={Redo2}
              title="Redo (Ctrl+Y / ⌘Y / Ctrl+Shift+Z)"
              onClick={redo}
              disabled={history.future.length === 0}
            />
            <TimelineDivider />
            <TimelineToolBtn
              icon={Scissors}
              title="Split at playhead (S)"
              accent
              onClick={doSplit}
              disabled={!selectedClipId || splitMut.isPending}
            />
            <TimelineToolBtn
              icon={Copy}
              title="Duplicate (⌘D)"
              onClick={doDuplicate}
              disabled={!selectedClipId || duplicateMut.isPending}
            />
            <TimelineToolBtn
              icon={Trash2}
              title="Delete (⌫)"
              onClick={doDelete}
              disabled={!selectedClipId || removeClipMut.isPending}
            />

            {/* Center: project meta */}
            <div className="hidden md:flex flex-1 items-center justify-center gap-3">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold truncate max-w-[220px]">
                {project.title}
              </span>
              <span className="text-[11px] font-mono text-primary/90 tabular-nums">
                {formatTimecode(currentTime)}
              </span>
            </div>
            <div className="md:hidden flex-1" />

            {/* Right cluster: snap, zoom */}
            <TimelineToolBtn
              icon={Magnet}
              title={snapEnabled ? "Magnetic snap: ON" : "Magnetic snap: OFF"}
              active={snapEnabled}
              onClick={() => setSnapEnabled((s) => !s)}
            />
            <TimelineDivider />
            <div className="flex items-center gap-2 pl-1 pr-0.5">
              <TimelineToolBtn icon={Minus} title="Zoom out (-)" onClick={() => zoom(-20)} />
              <Slider
                min={8}
                max={240}
                step={4}
                value={[pxPerSec]}
                onValueChange={(v) => setPxPerSec(v[0])}
                aria-label="Timeline zoom"
                className="w-16 sm:w-24"
              />
              <TimelineToolBtn icon={Plus} title="Zoom in (+)" onClick={() => zoom(20)} />
            </div>
          </div>


          <TimelineTracks
            aRoll={aRoll}
            bRoll={bRoll}
            videoClips={videoClips}
            selectedClipId={selectedClipId}
            onSelect={(id) => setSelectedClipId(id)}
            captions={captionsEnabled}
            music={musicEnabled}
            pxPerSec={pxPerSec}
            snapEnabled={snapEnabled}
            currentTimeMs={timelinePlayheadMs}
            onSeekMs={(clipId, absMs, atTimelineMs) => {
              if (videoRef.current) {
                if (viewMode === "program" || viewMode === "compare") {
                  videoRef.current.currentTime = atTimelineMs / 1000;
                  setCurrentTime(atTimelineMs / 1000);
                } else if (clipId === selectedClipId) {
                  videoRef.current.currentTime = absMs / 1000;
                  setCurrentTime(absMs / 1000);
                }
              }
            }}
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
            reorderMut={reorderMut}
            pushToHistory={pushToHistory}
          />

        </div>
      </div>

      {/* ============ STATUS BAR (desktop only) ============ */}
      <footer className="hidden md:flex h-6 bg-[#0a0a10] border-t border-white/[0.06] items-center px-3 text-[10px] text-neutral-500 gap-3 shrink-0 font-mono">
        <span className="text-primary uppercase tracking-widest">Statum</span>
        <span>·</span>
        <span>{clips.length} clips</span>
        <span>·</span>
        <span>{project.aspect_ratio}</span>
        <span>·</span>
        <span className="capitalize">{project.status}</span>
        {latestJob && (
          <>
            <span>·</span>
            <span className="capitalize">
              {latestJob.status} {latestJob.progress > 0 && `${latestJob.progress}%`}
            </span>
          </>
        )}
        <div className="flex-1" />
        {isMutating > 0 ? (
          <span className="flex items-center gap-1.5 text-primary animate-pulse font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Saving changes…
          </span>
        ) : (
          <span className="flex items-center gap-1 text-emerald-400 font-medium">
            ✓ Saved
          </span>
        )}
      </footer>

      {/* ============ MOBILE BOTTOM TAB BAR ============ */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-11 bg-[#0a0a10]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-2 shrink-0">
        {([
          { key: "edit", label: "Edit", icon: MonitorPlay },
          { key: "media", label: "Media", icon: FolderOpen },
        ] as const).map((t) => {
          const active = mobileView === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setMobileView(t.key)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold tracking-wide transition-colors",
                active ? "text-primary" : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-primary shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
              )}
              <Icon className={cn("w-4 h-4", active && "drop-shadow-[0_0_6px_rgba(34,211,238,0.6)]")} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

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

/* -------------------- Sub-components -------------------- */

function MenuItem({ label }: { label: string }) {
  return (
    <button className="px-2 py-1 rounded-md hover:bg-white/5 text-[12px] text-neutral-300">
      {label}
    </button>
  );
}

function PanelTabs<T extends string>({
  tabs,
  active,
  onChange,
  rightLabel,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (k: T) => void;
  rightLabel: string;
}) {
  return (
    <div className="h-8 border-b border-white/[0.06] flex items-center px-1 gap-0.5 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "px-2.5 h-6 rounded text-[11px] font-medium transition-colors",
            active === t.key
              ? "bg-white/[0.08] text-primary"
              : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.03]",
          )}
        >
          {t.label}
        </button>
      ))}
      {rightLabel && (
        <span className="ml-auto text-[10px] uppercase tracking-widest text-neutral-600 pr-2 font-semibold">
          {rightLabel}
        </span>
      )}
    </div>
  );
}

function MediaItem({
  clip,
  index,
  selected,
  onSelect,
  onRemove,
}: {
  clip: ClipRow;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const seed = clip.filename.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = 170 + ((seed * 17) % 40);
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-2 rounded p-1.5 cursor-pointer border",
        selected
          ? "bg-primary/10 border-primary/30"
          : "border-transparent hover:bg-white/[0.03] hover:border-white/[0.05]",
      )}
    >
      <div
        className="w-10 h-8 rounded overflow-hidden shrink-0 relative"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 70% 30%), hsl(${(hue + 25) % 360} 60% 18%))`,
        }}
      >
        <div className="absolute inset-0 grid place-items-center">
          <Film className="w-3 h-3 text-primary/80" />
        </div>
        <div className="absolute bottom-0 left-0.5 text-[8px] font-mono text-white/90">
          {String(index + 1).padStart(2, "0")}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate text-neutral-200">{clip.filename}</div>
        <div className="text-[9px] text-neutral-500 uppercase tracking-wider">
          {clip.role} · {((clip.size_bytes ?? 0) / 1024 / 1024).toFixed(1)}MB
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-neutral-500"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function EmptyState({ icon: Icon, text, hint }: { icon: typeof Film; text: string; hint?: string }) {
  return (
    <div className="text-center py-8">
      <Icon className="w-6 h-6 mx-auto text-neutral-700 mb-2" />
      <div className="text-[11px] text-neutral-500">{text}</div>
      {hint && <div className="text-[10px] text-neutral-600 mt-0.5">{hint}</div>}
    </div>
  );
}

function EffectRow({ icon: Icon, label }: { icon: typeof Film; label: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.03] text-[11px] text-neutral-400 cursor-pointer">
      <Icon className="w-3 h-3 text-neutral-500" />
      {label}
    </div>
  );
}

function AIDirectorPanel({
  status,
  latestJob,
  clipCount,
  preset,
}: {
  status: string;
  latestJob: { status: string; progress: number; stage_message: string | null; error?: string | null } | null;
  clipCount: number;
  preset: string;
}) {
  const items: { n: number; text: string; active?: boolean; done?: boolean }[] = [
    {
      n: 1,
      text: `Analyzed ${clipCount} source clip${clipCount === 1 ? "" : "s"} and ordered by ordinal.`,
      done: clipCount > 0,
    },
    {
      n: 2,
      text: `Applied ${preset.toUpperCase()} preset — pacing, cut cadence, color signature.`,
      done: true,
    },
    {
      n: 3,
      text: latestJob?.stage_message ?? "Waiting to begin AI edit.",
      active: !!latestJob && ["queued", "planning", "transcribing", "rendering"].includes(latestJob.status),
      done: status === "ready",
    },
    {
      n: 4,
      text: status === "ready" ? "Rendered final MP4 — ready to export." : "Final render pending.",
      done: status === "ready",
    },
  ];
  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-primary font-semibold mb-1">
        AI Director Reasoning
      </div>
      {items.map((it) => (
        <div
          key={it.n}
          className={cn(
            "rounded-md p-2 border text-[11px] leading-snug",
            it.active
              ? "border-primary/40 bg-primary/10 text-primary"
              : it.done
              ? "border-white/[0.06] bg-white/[0.02] text-neutral-300"
              : "border-white/[0.04] bg-transparent text-neutral-500",
          )}
        >
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "shrink-0 text-[10px] font-mono w-4 h-4 rounded grid place-items-center",
                it.active ? "bg-primary text-neutral-950" : it.done ? "bg-emerald-500/70 text-neutral-950" : "bg-white/5",
              )}
            >
              {it.n}
            </span>
            <span>{it.text}</span>
          </div>
        </div>
      ))}
      {latestJob?.status === "failed" && latestJob.error && (
        <div className="rounded-md p-2 border border-red-500/30 bg-red-500/10 text-red-300 text-[11px]">
          {latestJob.error}
        </div>
      )}
    </>
  );
}

function PreviewIdle({
  status,
  inProgress,
  progress,
  aspectRatio,
}: {
  status: string;
  inProgress: boolean;
  progress: number;
  aspectRatio: string;
}) {
  const title = inProgress
    ? "AI is editing your video"
    : status === "failed"
    ? "Render failed"
    : status === "ready"
    ? "Render ready"
    : "Preview will appear here";
  const subtitle = inProgress
    ? `Stage ${progress}% — analyzing footage, cutting, and mixing audio.`
    : status === "failed"
    ? "Review the error in the AI panel, then start a new edit."
    : status === "ready"
    ? "Press play to watch the final cut, or export to download."
    : "Import clips, then hit Start AI Edit to generate your first render.";

  return (
    <div className="w-full h-full grid place-items-center px-4 py-6">
      <div className="relative w-full max-w-md text-center rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent px-6 py-8 sm:py-10 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
        {/* Aspect chip */}
        <div className="absolute top-3 right-3 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-mono text-neutral-400 border border-white/10">
          {aspectRatio}
        </div>

        {/* Icon */}
        <div className="mx-auto mb-5 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/60/5 border border-primary/20 grid place-items-center shadow-[0_0_40px_-10px_rgba(34,211,238,0.4)]">
          {inProgress ? (
            <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 animate-spin text-primary" />
          ) : status === "failed" ? (
            <Zap className="w-6 h-6 sm:w-7 sm:h-7 text-red-400" />
          ) : (
            <MonitorPlay className="w-6 h-6 sm:w-7 sm:h-7 text-primary/80" />
          )}
        </div>

        {/* Title */}
        <div className="text-base sm:text-lg font-semibold text-neutral-100 tracking-tight">
          {title}
        </div>

        {/* Subtitle */}
        <div className="mt-1.5 text-[12px] sm:text-[13px] text-neutral-400 leading-relaxed max-w-xs mx-auto">
          {subtitle}
        </div>

        {/* Progress */}
        {inProgress && (
          <div className="mt-5 mx-auto w-full max-w-[260px]">
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-500"
                style={{ width: `${Math.max(4, progress)}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-neutral-500 tabular-nums">
              <span>PROGRESS</span>
              <span className="text-primary">{progress}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function TransportBtn({
  icon: Icon,
  onClick,
  accent,
  title,
}: {
  icon: typeof Play;
  onClick?: () => void;
  accent?: boolean;
  title?: string;
}) {
  const btn = (
    <button
      onClick={onClick}
      aria-label={title || "Transport action"}
      className={cn(
        "w-7 h-7 grid place-items-center rounded transition-colors",
        accent
          ? "bg-primary/20 text-primary hover:bg-primary/30"
          : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  if (!title) return btn;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="top" className="text-[11px] bg-[#161622] text-neutral-200 border-white/10 font-mono">
          {title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TimelineToolBtn({
  icon: Icon,
  title,
  accent,
  active,
  className,
  onClick,
  disabled,
}: {
  icon: typeof Scissors;
  title: string;
  accent?: boolean;
  active?: boolean;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={title}
            onClick={onClick}
            disabled={disabled}
            className={cn(
              "w-8 h-8 grid place-items-center rounded-md transition-colors shrink-0",
              active
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : accent
                ? "text-neutral-200 hover:text-primary hover:bg-white/[0.06]"
                : "text-neutral-400 hover:text-white hover:bg-white/[0.06]",
              disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-neutral-400",
              className,
            )}
          >
            <Icon className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px] bg-[#161622] text-neutral-200 border-white/10 font-mono">
          {title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


function TimelineDivider({ className }: { className?: string }) {
  return <span className={cn("w-px h-5 bg-white/[0.08] mx-0.5 shrink-0", className)} />;
}


/* -------------------- Real, working pixel-per-second timeline -------------------- */

type HistoryItem = {
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  description: string;
};

type TimelineProps = {
  aRoll: ClipRow[];
  bRoll: ClipRow[];
  videoClips: ClipRow[];
  selectedClipId: string | null;
  onSelect: (id: string) => void;
  onTrim: (id: string, trimInMs: number, trimOutMs: number | null) => void;
  captions: boolean;
  music: boolean;
  pxPerSec: number;
  snapEnabled: boolean;
  currentTimeMs: number;
  onSeekMs: (clipId: string, absMs: number, atTimelineMs: number) => void;
  reorderMut: { mutate: (data: { project_id: string; order: { id: string; ordinal: number; role?: string }[] }) => void };
  pushToHistory: (item: HistoryItem) => void;
};

function TimelineTracks({
  aRoll,
  bRoll,
  videoClips,
  selectedClipId,
  onSelect,
  onTrim,
  captions,
  music,
  pxPerSec,
  snapEnabled,
  currentTimeMs,
  onSeekMs,
  reorderMut,
  pushToHistory,
}: TimelineProps) {
  // drag state: which clip id is being dragged, and which track ("aroll"/"broll")
  const [dragState, setDragState] = useState<{ id: string; fromTrack: "aroll" | "broll" } | null>(null);
  const [overDropTarget, setOverDropTarget] = useState<{ id: string | "__end_aroll__" | "__end_broll__" } | null>(null);

  // Compute layout offsets for ALL video clips to position playhead correctly
  const allOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let cur = 0;
    for (const c of videoClips) {
      offsets.set(c.id, cur);
      cur += clipVisibleMs(c);
    }
    return { offsets, totalMs: Math.max(cur, 10000) };
  }, [videoClips]);

  // Per-track layout
  const aLayout = useMemo(() => {
    const offsets = new Map<string, number>();
    let cur = 0;
    for (const c of aRoll) {
      offsets.set(c.id, cur);
      cur += clipVisibleMs(c);
    }
    return { offsets, totalMs: Math.max(cur, 10000) };
  }, [aRoll]);

  const bLayout = useMemo(() => {
    const offsets = new Map<string, number>();
    let cur = 0;
    for (const c of bRoll) {
      offsets.set(c.id, cur);
      cur += clipVisibleMs(c);
    }
    return { offsets, totalMs: Math.max(cur, 5000) };
  }, [bRoll]);

  const totalMs = Math.max(aLayout.totalMs, bLayout.totalMs);
  const trackWidthPx = Math.max(600, (totalMs / 1000) * pxPerSec);

  // Ruler ticks — adapt density to zoom so labels don't overlap.
  const ruler = useMemo(() => {
    const seconds = totalMs / 1000;
    const step = pxPerSec >= 120 ? 1 : pxPerSec >= 60 ? 2 : pxPerSec >= 30 ? 5 : 10;
    const ticks: { t: number; label: string; major: boolean }[] = [];
    for (let t = 0; t <= seconds + step; t += 1) {
      const major = t % step === 0;
      ticks.push({ t, label: major ? formatTimecode(t) : "", major });
    }
    return ticks;
  }, [totalMs, pxPerSec]);

  // Playhead — currentTimeMs is already the absolute timeline position
  const playheadPx = (currentTimeMs / 1000) * pxPerSec;

  // Snap boundaries: playhead + all clip edges in px (for use in trim handles)
  const snapBoundariesMs = useMemo(() => {
    if (!snapEnabled) return [];
    const pts: number[] = [currentTimeMs];
    for (const c of videoClips) {
      const off = allOffsets.offsets.get(c.id) ?? 0;
      pts.push(off, off + clipVisibleMs(c));
    }
    return pts;
  }, [snapEnabled, currentTimeMs, videoClips, allOffsets.offsets]);

  function handleRulerSeek(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollEl = e.currentTarget.closest(".tl-scroll") as HTMLElement | null;
    const scrollLeft = scrollEl?.scrollLeft ?? 0;
    const x = e.clientX - rect.left + scrollLeft;
    const atTimelineMs = Math.max(0, (x / pxPerSec) * 1000);

    // Find which clip is at this position (A-roll first, then B-roll)
    let acc = 0;
    for (const c of aRoll) {
      const w = clipVisibleMs(c);
      if (atTimelineMs <= acc + w) {
        const absMs = (c.trim_in_ms ?? 0) + (atTimelineMs - acc);
        onSelect(c.id);
        onSeekMs(c.id, absMs, atTimelineMs);
        return;
      }
      acc += w;
    }
    // fallback: seek without selecting
    onSeekMs("", 0, atTimelineMs);
  }

  function handleReorder(draggedId: string, fromTrack: "aroll" | "broll", targetId: string | "__end_aroll__" | "__end_broll__") {
    const draggedClip = videoClips.find((c) => c.id === draggedId);
    if (!draggedClip) return;

    const toTrack = targetId === "__end_broll__" || bRoll.some((c) => c.id === targetId)
      ? "broll"
      : "aroll";

    const newRole = toTrack === "broll" ? "broll" : draggedClip.role === "broll" ? "aroll" : draggedClip.role;

    // Build new arrays
    const newARoll = aRoll.filter((c) => c.id !== draggedId);
    const newBRoll = bRoll.filter((c) => c.id !== draggedId);

    if (toTrack === "aroll") {
      const insertIdx = targetId === "__end_aroll__"
        ? newARoll.length
        : newARoll.findIndex((c) => c.id === targetId);
      newARoll.splice(insertIdx >= 0 ? insertIdx : newARoll.length, 0, { ...draggedClip, role: newRole });
    } else {
      const insertIdx = targetId === "__end_broll__"
        ? newBRoll.length
        : newBRoll.findIndex((c) => c.id === targetId);
      newBRoll.splice(insertIdx >= 0 ? insertIdx : newBRoll.length, 0, { ...draggedClip, role: newRole as any });
    }

    const combined = [
      ...newARoll.map((c, i) => ({ id: c.id, ordinal: i, role: c.role as string })),
      ...newBRoll.map((c, i) => ({ id: c.id, ordinal: newARoll.length + i, role: "broll" as string })),
    ];

    const prevRole = draggedClip.role;
    const prevOrder = videoClips.map((c) => ({ id: c.id, ordinal: c.ordinal, role: c.role as string }));

    pushToHistory({
      description: "Reorder clip",
      undo: () => { reorderMut.mutate({ project_id: draggedClip.id.split("-")[0] ?? "", order: prevOrder }); },
      redo: () => { reorderMut.mutate({ project_id: draggedClip.id.split("-")[0] ?? "", order: combined }); },
    });

    reorderMut.mutate({ project_id: draggedClip.id.split("-")[0] ?? "", order: combined });
    setDragState(null);
    setOverDropTarget(null);
    void prevRole;
  }

  return (
    <div className="relative flex-1 overflow-auto min-h-0 tl-scroll">
      {/* Ruler — pointer-down to seek */}
      <div className="h-6 border-b border-white/[0.06] sticky top-0 z-10 bg-[#0b0b12]/95 backdrop-blur select-none flex">
        <div className="w-24 sm:w-28 shrink-0 border-r border-white/[0.06] bg-[#0d0d14] flex items-center px-2 text-[9px] font-mono text-neutral-600 uppercase tracking-widest">
          Time
        </div>
        <div
          className="relative h-full cursor-crosshair flex-1"
          style={{ width: trackWidthPx }}
          onPointerDown={handleRulerSeek}
        >
          {ruler.map((t, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 flex flex-col justify-between"
              style={{ left: t.t * pxPerSec }}
            >
              <span className={cn("block w-px", t.major ? "h-3 bg-white/25" : "h-1.5 bg-white/10")} />
              {t.label && (
                <span className="text-[9px] font-mono text-neutral-500 -translate-x-1/2 whitespace-nowrap">
                  {t.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Playhead line — offset by gutter */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 z-20 transition-[left] duration-75"
        style={{ left: `calc(var(--tl-gutter, 96px) + ${playheadPx}px)` }}
      >
        <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-primary shadow-[0_0_8px_color-mix(in_oklab,var(--color-primary)_70%,transparent)]" />
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-primary/90 shadow-[0_0_6px_color-mix(in_oklab,var(--color-primary)_55%,transparent)]" />
      </div>

      <style>{`
        .tl-root { --tl-gutter: 96px; }
        @media (min-width: 640px) { .tl-root { --tl-gutter: 112px; } }
      `}</style>
      <div className="tl-root">
        {/* V1 A-Roll */}
        <TrackRow label="V1" name="A-Roll" innerWidth={trackWidthPx}>
          {/* Drop zone at end */}
          <div
            className="absolute inset-y-2 right-0 w-12 z-10"
            onDragOver={(e) => { e.preventDefault(); setOverDropTarget({ id: "__end_aroll__" }); }}
            onDragLeave={() => setOverDropTarget(null)}
            onDrop={() => dragState && handleReorder(dragState.id, dragState.fromTrack, "__end_aroll__")}
          />
          {aRoll.length === 0 ? (
            <div
              className={cn(
                "absolute inset-0 grid place-items-center text-[10px] italic pointer-events-none",
                overDropTarget?.id === "__end_aroll__" ? "text-primary" : "text-neutral-600",
              )}
            >
              Drop A-roll clips here
            </div>
          ) : (
            aRoll.map((c, i) => (
              <TimelineClip
                key={c.id}
                clip={c}
                index={i}
                pxPerSec={pxPerSec}
                offsetMs={aLayout.offsets.get(c.id) ?? 0}
                selected={selectedClipId === c.id}
                over={overDropTarget?.id === c.id}
                onSelect={() => onSelect(c.id)}
                onDragStart={() => setDragState({ id: c.id, fromTrack: "aroll" })}
                onDragOver={(e) => { e.preventDefault(); setOverDropTarget({ id: c.id }); }}
                onDragLeave={() => setOverDropTarget(null)}
                onDrop={() => dragState && handleReorder(dragState.id, dragState.fromTrack, c.id)}
                onTrim={onTrim}
                snapBoundariesMs={snapEnabled ? snapBoundariesMs : []}
                clipStartMs={aLayout.offsets.get(c.id) ?? 0}
                tone="primary"
              />
            ))
          )}
        </TrackRow>

        {/* V2 B-Roll */}
        <TrackRow label="V2" name="B-Roll" innerWidth={trackWidthPx}>
          <div
            className="absolute inset-y-2 right-0 w-12 z-10"
            onDragOver={(e) => { e.preventDefault(); setOverDropTarget({ id: "__end_broll__" }); }}
            onDragLeave={() => setOverDropTarget(null)}
            onDrop={() => dragState && handleReorder(dragState.id, dragState.fromTrack, "__end_broll__")}
          />
          {/* Full track drag target for moving A-roll clips to B-roll */}
          <div
            className="absolute inset-0 z-0"
            onDragOver={(e) => {
              if (dragState && dragState.fromTrack === "aroll") {
                e.preventDefault();
                setOverDropTarget({ id: "__end_broll__" });
              }
            }}
            onDrop={() => dragState && handleReorder(dragState.id, dragState.fromTrack, "__end_broll__")}
          />
          {bRoll.length === 0 ? (
            <div
              className={cn(
                "absolute inset-0 grid place-items-center text-[10px] italic pointer-events-none",
                overDropTarget?.id === "__end_broll__" ? "text-teal-400" : "text-neutral-600",
              )}
            >
              B-roll & cutaways
            </div>
          ) : (
            bRoll.map((c, i) => (
              <TimelineClip
                key={c.id}
                clip={c}
                index={i}
                pxPerSec={pxPerSec}
                offsetMs={bLayout.offsets.get(c.id) ?? 0}
                selected={selectedClipId === c.id}
                over={overDropTarget?.id === c.id}
                onSelect={() => onSelect(c.id)}
                onDragStart={() => setDragState({ id: c.id, fromTrack: "broll" })}
                onDragOver={(e) => { e.preventDefault(); setOverDropTarget({ id: c.id }); }}
                onDragLeave={() => setOverDropTarget(null)}
                onDrop={() => dragState && handleReorder(dragState.id, dragState.fromTrack, c.id)}
                onTrim={onTrim}
                snapBoundariesMs={snapEnabled ? snapBoundariesMs : []}
                clipStartMs={bLayout.offsets.get(c.id) ?? 0}
                tone="teal"
              />
            ))
          )}
        </TrackRow>

        {/* A1 Audio */}
        <TrackRow label="A1" name="Audio" innerWidth={trackWidthPx}>
          <div
            className="absolute inset-y-2 left-0 rounded bg-gradient-to-r from-emerald-500/10 to-transparent border border-emerald-500/20 flex items-center gap-[2px] overflow-hidden"
            style={{ width: trackWidthPx - 8 }}
          >
            {Array.from({ length: Math.floor((trackWidthPx - 16) / 4) }).map((_, i) => {
              const h = 20 + Math.abs(Math.sin(i * 0.4 + i * 0.11)) * 70;
              return (
                <div
                  key={i}
                  className="w-[3px] rounded-full bg-emerald-400/70 shrink-0"
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
        </TrackRow>

        {/* V3 Captions */}
        {captions && (
          <TrackRow label="V3" name="Captions" innerWidth={trackWidthPx}>
            <div className="absolute inset-y-2 left-0 flex gap-1.5 items-center">
              {["HOOK", "PROOF", "PAYOFF", "CTA"].map((t, i) => (
                <div
                  key={i}
                  style={{ marginLeft: i === 0 ? 4 : 0, width: 120 }}
                  className="h-8 px-2 py-1 rounded bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold tracking-wider grid place-items-center"
                >
                  T · {t}
                </div>
              ))}
            </div>
          </TrackRow>
        )}

        {/* A2 Music */}
        {music && (
          <TrackRow label="A2" name="Music" innerWidth={trackWidthPx}>
            <div
              className="absolute inset-y-2 left-0 rounded bg-gradient-to-r from-violet-500/10 to-transparent border border-violet-500/20 flex items-center gap-[2px] overflow-hidden opacity-70"
              style={{ width: trackWidthPx - 8 }}
            >
              {Array.from({ length: Math.floor((trackWidthPx - 16) / 4) }).map((_, i) => {
                const h = Math.max(15, Math.abs(Math.sin(i * 0.35 + i * 0.09)) * 40);
                return (
                  <div
                    key={i}
                    className="w-[3px] rounded-full bg-violet-400/70 shrink-0"
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
          </TrackRow>
        )}
      </div>
    </div>
  );
}

function TrackRow({
  label,
  name,
  innerWidth,
  children,
}: {
  label: string;
  name: string;
  innerWidth: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex border-b border-white/[0.05] min-h-[76px] hover:bg-white/[0.015] transition-colors">
      <div className="w-24 sm:w-28 shrink-0 border-r border-white/[0.06] bg-[#0d0d14] px-2.5 py-2 flex flex-col justify-center gap-1 sticky left-0 z-10">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-mono font-bold text-primary">{label}</span>
          <span className="text-[9px] text-neutral-500 uppercase tracking-wider truncate">{name}</span>
        </div>
        <div className="flex gap-0.5 -ml-1">
          <button title="Mute" className="w-5 h-5 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]">
            <Volume2 className="w-3 h-3" />
          </button>
          <button title="Lock" className="w-5 h-5 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]">
            <Lock className="w-3 h-3" />
          </button>
          <button title="Visibility" className="w-5 h-5 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]">
            <Eye className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="relative p-2 min-h-[76px]" style={{ width: innerWidth }}>
        {children}
      </div>
    </div>
  );
}

function TimelineClip({
  clip,
  index,
  pxPerSec,
  offsetMs,
  selected,
  over,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onTrim,
  snapBoundariesMs,
  clipStartMs,
  tone,
}: {
  clip: ClipRow;
  index: number;
  pxPerSec: number;
  offsetMs: number;
  selected: boolean;
  over: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onTrim: (id: string, trimInMs: number, trimOutMs: number | null) => void;
  snapBoundariesMs: number[];
  clipStartMs: number;
  tone: "primary" | "teal";
}) {
  const sourceMs = clipSourceMs(clip);
  const trimIn = clip.trim_in_ms ?? 0;
  const trimOut = clip.trim_out_ms ?? sourceMs ?? trimIn + clipVisibleMs(clip);
  const [localTrimIn, setLocalTrimIn] = useState<number | null>(null);
  const [localTrimOut, setLocalTrimOut] = useState<number | null>(null);
  const effIn = localTrimIn ?? trimIn;
  const effOut = localTrimOut ?? trimOut;
  const visibleMs = Math.max(200, effOut - effIn);
  const widthPx = (visibleMs / 1000) * pxPerSec;
  const leftPx = (offsetMs / 1000) * pxPerSec;

  const gradient =
    tone === "primary"
      ? "from-primary/45 to-primary/20 border-primary/50"
      : "from-teal-500/40 to-primary/20 border-teal-400/40";

  function snapTo(valueMs: number): number {
    if (snapBoundariesMs.length === 0) return valueMs;
    const SNAP_THRESHOLD_PX = 8;
    let closest = valueMs;
    let closestDist = Infinity;
    for (const boundary of snapBoundariesMs) {
      // Convert boundary to relative clip ms
      const relBoundary = boundary - clipStartMs + trimIn;
      const dist = Math.abs((relBoundary - valueMs) * pxPerSec) / 1000;
      if (dist < SNAP_THRESHOLD_PX && dist < closestDist) {
        closestDist = dist;
        closest = relBoundary;
      }
    }
    return closest;
  }

  function beginTrim(edge: "left" | "right", e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startClientX = e.clientX;
    const startIn = trimIn;
    const startOut = trimOut;
    const maxOut = sourceMs ?? trimOut + 60_000;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startClientX;
      const deltaMs = Math.round((dx / pxPerSec) * 1000);
      if (edge === "left") {
        let next = Math.max(0, Math.min(startOut - 200, startIn + deltaMs));
        next = snapTo(next);
        setLocalTrimIn(next);
      } else {
        let next = Math.max(startIn + 200, Math.min(maxOut, startOut + deltaMs));
        next = snapTo(next);
        setLocalTrimOut(next);
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLocalTrimIn((li) => {
        setLocalTrimOut((lo) => {
          const nextIn = li ?? startIn;
          const nextOut = lo ?? startOut;
          onTrim(
            clip.id,
            nextIn,
            sourceMs != null && nextOut >= sourceMs ? null : nextOut,
          );
          return null;
        });
        return null;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.stopPropagation(); onDrop(); }}
      onClick={onSelect}
      style={{ position: "absolute", left: leftPx, width: Math.max(20, widthPx), top: 8, bottom: 8 }}
      className={cn(
        "rounded-md border bg-gradient-to-br cursor-grab active:cursor-grabbing overflow-hidden group select-none transition-shadow",
        gradient,
        selected && "ring-2 ring-primary shadow-[0_0_20px_-4px_color-mix(in_oklab,var(--color-primary)_50%,transparent)]",
        over && "ring-1 ring-white/40 brightness-125",
      )}
    >
      {/* Trim handles */}
      <div
        onPointerDown={(e) => beginTrim("left", e)}
        className={cn(
          "absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition",
          selected && "opacity-100",
        )}
        title="Drag to trim in"
      >
        <span className="w-[2px] h-4 bg-white/90 rounded-full" />
      </div>
      <div
        onPointerDown={(e) => beginTrim("right", e)}
        className={cn(
          "absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition",
          selected && "opacity-100",
        )}
        title="Drag to trim out"
      >
        <span className="w-[2px] h-4 bg-white/90 rounded-full" />
      </div>

      <div className="absolute inset-0 p-1.5 pl-3 pr-3 flex flex-col justify-between text-[9px] pointer-events-none">
        <div className="flex items-center gap-1 text-white/95 font-mono font-semibold truncate">
          <Film className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">
            {String(index + 1).padStart(2, "0")} · {clip.filename.replace(/\.[^.]+$/, "")}
          </span>
        </div>
        <div className="flex items-center justify-between text-white/70 font-mono tabular-nums">
          <span>{formatTimecode(visibleMs / 1000)}</span>
          {sourceMs != null && (
            <span className="text-white/40">/ {formatTimecode(sourceMs / 1000)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimecode(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

