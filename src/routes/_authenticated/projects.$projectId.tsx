import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  updateClipTransform,
  setClipThumbnail,
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
  groupIntoPhrases,
  placeTranscripts,
  type CaptionSegment,
  type TimelineWord,
  type TranscriptWord,
} from "@/lib/captions";
import { CaptionsPanel } from "@/components/editor/CaptionsPanel";
import { PreviewOverlay } from "@/components/editor/PreviewOverlay";
import { loadBrandKit } from "@/lib/brand-kit";
import { usePreviewAudio } from "@/components/editor/usePreviewAudio";
import { probeFileDurationMs, probeMediaDurationMs } from "@/lib/media-duration";
import { captureVideoFrame, thumbnailKey } from "@/lib/video-thumbnail";
import { parseTransform, type ClipTransform } from "@/lib/clip-transform";
import {
  claimThumbnail,
  makeThumbnail,
  saveThumbnail,
  thumbnailTimeMs,
  useThumbnailMaker,
} from "@/lib/clip-thumbnails";
import {
  FinalUploadError,
  UploadCancelled,
  uploadToSignedUrlWithProgress,
} from "@/lib/upload-file";
import { uploadSummary, useUploadQueue } from "@/components/editor/useUploadQueue";
import { UploadList } from "@/components/editor/UploadList";
import { ThumbnailMaker } from "@/components/editor/ThumbnailMaker";
import {
  captureFilmstrip,
  computeWaveform,
  type Filmstrip,
  type Waveform,
} from "@/lib/clip-strips";

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
  type CaptionPhrase,
  type AddMediaTarget,
  type AddMediaSource,
} from "@/components/editor";
import { clampZoom, ZOOM_STEP } from "@/components/editor/timeline-zoom";
import { FPS, snapToFrame } from "@/components/editor/timecode";
import {
  currentPlacements,
  insertIndexAt,
  layoutTrack,
  planMagneticInsert,
  videoEndMs,
  planPlacement,
} from "@/lib/timeline-layout";
import {
  IMAGE_DEFAULT_MS,
  IMAGE_MAX_MS,
  isHeicFile,
  isImageFile,
  isImageFilename,
} from "@/lib/media-kind";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: "Editor — Stuccord Motion" }] }),
  // ?thumbnail=1 opens the Thumbnail maker (Home's Thumbnail tool links here).
  validateSearch: (s: Record<string, unknown>): { thumbnail?: 1 } =>
    s.thumbnail === 1 || s.thumbnail === "1" || s.thumbnail === true ? { thumbnail: 1 } : {},
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
  start_ms?: number | null;
  /** Moved, resized or rotated in the preview; read it with parseTransform. */
  transform?: unknown;
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
  const search = Route.useSearch();
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
  const transformFn = useServerFn(updateClipTransform);
  const recordThumbFn = useServerFn(setClipThumbnail);
  const durationFn = useServerFn(updateClipDuration);
  const splitFn = useServerFn(splitClip);
  const duplicateFn = useServerFn(duplicateClip);
  const startBrowserRenderFn = useServerFn(startBrowserRender);
  const finishBrowserRenderFn = useServerFn(finishBrowserRender);

  const uploadInputRef = useRef<HTMLInputElement>(null);
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
  // Play speed set with L (1×, 2×, 4×); K or a new file resets it.
  const [playbackRate, setPlaybackRate] = useState(1);
  // Preview tab: the live edit (Timeline), the selected clip, or the render.
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [splitPct, setSplitPct] = useState(50);
  // Export switches, saved on the project (defaults until it has loaded, or
  // if the columns don't exist yet). The volume slider shows a draft while
  // dragging and saves when it's let go.
  const captionsEnabled = data?.project.captions_enabled ?? true;
  const musicEnabled = data?.project.music_enabled ?? true;
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const musicVolume = volumeDraft ?? data?.project.music_volume ?? 60;
  const saveExportSwitches = useMutation({
    mutationFn: (
      patch: Partial<Record<"captions_enabled" | "music_enabled", boolean>> & {
        music_volume?: number;
      },
    ) => updateSettings({ data: { id: projectId, ...patch } }),
    // Show the change at once; put it back if saving fails.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["project", projectId] });
      const previous = qc.getQueryData<typeof data>(["project", projectId]);
      if (previous) {
        qc.setQueryData(["project", projectId], {
          ...previous,
          project: { ...previous.project, ...patch },
        });
      }
      return { previous };
    },
    onSuccess: (row) => {
      qc.setQueryData(["project", projectId], (old: typeof data) =>
        old ? { ...old, project: row } : old,
      );
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(["project", projectId], ctx.previous);
      toast.error(`Couldn't save the setting: ${e.message}`);
    },
    onSettled: () => setVolumeDraft(null),
  });
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

  // Signed links to every clip's file (they last an hour; renewed after 50
  // minutes), for the live timeline player and its music.
  const [clipUrls, setClipUrls] = useState<Record<string, string>>({});
  const clipUrlsSignedAt = useRef(new Map<string, number>());
  // Bumped every 10 minutes so links are renewed even without other changes.
  const [renewTick, setRenewTick] = useState(0);
  // Links that couldn't be made are tried again a few seconds later.
  const retrySigning = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const id = setInterval(() => setRenewTick((n) => n + 1), 10 * 60 * 1000);
    // Coming back to the tab (or waking the computer): timers may not have
    // run meanwhile, so renew any link that's old before it's used.
    const onVisible = () => {
      if (document.visibilityState === "visible") setRenewTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (retrySigning.current) clearTimeout(retrySigning.current);
    };
  }, []);
  // A file whose download stalled in the preview gets a fresh link now (its
  // link may have expired), at most every 15 s.
  const lastResign = useRef(new Map<string, number>());
  const resignClipLink = useCallback((path: string) => {
    const now = Date.now();
    if (now - (lastResign.current.get(path) ?? 0) < 15_000) return;
    lastResign.current.set(path, now);
    clipUrlsSignedAt.current.delete(path);
    setRenewTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const paths = [...new Set((data.clips as ClipRow[]).map((c) => c.storage_path))].filter(
      (path) => now - (clipUrlsSignedAt.current.get(path) ?? 0) > 50 * 60 * 1000,
    );
    if (paths.length === 0) return;
    for (const path of paths) clipUrlsSignedAt.current.set(path, now);
    // The links are always kept, even when the project data refreshes while
    // they're being made: the paths are already marked as signed, so dropping
    // them here would leave the preview on "Loading…" for 50 minutes.
    void Promise.all(
      paths.map(async (path) => {
        try {
          const { url } = await signClip({ data: { path } });
          return [path, url] as const;
        } catch (e) {
          console.warn("[editor] Couldn't get a link to a clip's file:", e);
          clipUrlsSignedAt.current.delete(path);
          return null;
        }
      }),
    ).then((pairs) => {
      const fresh = Object.fromEntries(pairs.filter((x) => x != null));
      if (Object.keys(fresh).length > 0) setClipUrls((old) => ({ ...old, ...fresh }));
      if (pairs.some((x) => x == null) && !retrySigning.current) {
        retrySigning.current = setTimeout(() => {
          retrySigning.current = null;
          setRenewTick((n) => n + 1);
        }, 5000);
      }
    });
  }, [data, signClip, renewTick]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

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
    mutationFn: () =>
      runRender({
        data: {
          project_id: projectId,
          captions: captionsEnabled,
          music: { enabled: musicEnabled, volume: musicVolume },
        },
      }),
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

  type Placement = { id: string; ordinal: number; role?: string; start_ms?: number | null };
  const reorderMut = useMutation({
    // The timeline only knows clip ids, so the project always comes from the route.
    mutationFn: ({ order }: { order: Placement[] }) =>
      reorder({ data: { project_id: projectId, order } }),
    // Show the new places at once (the timeline and the preview), without
    // waiting for the save and a fresh copy of the project; put them back if
    // the save fails.
    onMutate: async ({ order }) => {
      const key = ["project", projectId];
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<typeof data>(key);
      if (before) {
        const byId = new Map(order.map((p) => [p.id, p]));
        const clips = (before.clips as ClipRow[])
          .map((c) => {
            const p = byId.get(c.id);
            if (!p) return c;
            return {
              ...c,
              ordinal: p.ordinal,
              role: p.role ?? c.role,
              ...(p.start_ms !== undefined ? { start_ms: p.start_ms } : {}),
            };
          })
          .sort((a, b) => a.ordinal - b.ordinal);
        qc.setQueryData(key, { ...before, clips: clips as typeof before.clips });
      }
      return { before };
    },
    onError: (e: Error, _vars, context) => {
      if (context?.before) qc.setQueryData(["project", projectId], context.before);
      toast.error(e.message);
    },
    onSettled: () => refetch(),
  });

  const trimMut = useMutation({
    mutationFn: (v: {
      id: string;
      trim_in_ms: number;
      trim_out_ms: number | null;
      start_ms?: number | null;
    }) => trimFn({ data: v }),
    onSuccess: () => refetch(),
    onError: (e: Error) => toast.error(e.message),
  });

  const transformMut = useMutation({
    mutationFn: (v: { id: string; transform: ClipTransform | null }) => transformFn({ data: v }),
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

  // Timeline thumbnails: one frame per video clip at its trim point, grabbed
  // once per source file + trim point, one at a time.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const thumbnailsRequested = useRef(new Set<string>());
  useEffect(() => {
    if (!data) return;
    const todo = (data.clips as ClipRow[]).filter(
      (c) =>
        c.role !== "music" && c.role !== "sfx" && !thumbnailsRequested.current.has(thumbnailKey(c)),
    );
    if (todo.length === 0) return;
    for (const c of todo) thumbnailsRequested.current.add(thumbnailKey(c));
    void (async () => {
      for (const c of todo) {
        try {
          const { url } = await signClip({ data: { path: c.storage_path } });
          // An image is its own thumbnail.
          const frame = isImageFilename(c.filename)
            ? url
            : await captureVideoFrame(url, (c.trim_in_ms ?? 0) + 100);
          if (frame) setThumbnails((t) => ({ ...t, [thumbnailKey(c)]: frame }));
        } catch (e) {
          console.warn("[editor] Couldn't make a clip thumbnail:", e);
        }
      }
    })();
  }, [data, signClip]);

  // The account's brand kit (captions, hook and logo in the preview and the
  // browser export), with a link to its logo; the link is renewed hourly.
  const brand = useQuery({
    queryKey: ["brand-kit"],
    queryFn: async () => {
      const kit = await loadBrandKit();
      const logoUrl = kit.logo
        ? await signClip({ data: { path: kit.logo.path } })
            .then((r) => r.url)
            .catch(() => null)
        : null;
      return { kit, logoUrl };
    },
    staleTime: 30 * 60 * 1000,
    refetchInterval: 45 * 60 * 1000,
  });

  // Clips without a thumbnail yet (uploaded before thumbnails, or a split
  // half or copy) get one in the background. Audio has no picture;
  // thumbnail_path is missing (undefined) until its migration has run.
  useThumbnailMaker(
    (data?.clips ?? []).filter(
      (c) => c.thumbnail_path === null && c.role !== "music" && c.role !== "sfx",
    ),
    signClip,
    recordThumbFn,
  );

  // Filmstrips and waveforms for the timeline's video clips, by file: made
  // once per file (once its length is known), one file at a time, after the
  // thumbnails above. null: the file has no sound to show.
  const [filmstrips, setFilmstrips] = useState<Record<string, Filmstrip>>({});
  const [waveforms, setWaveforms] = useState<Record<string, Waveform | null>>({});
  const stripsRequested = useRef(new Set<string>());
  const stripsQueue = useRef<Promise<void>>(Promise.resolve());
  const stripsStop = useRef({ cancelled: false });
  useEffect(() => {
    const stop = stripsStop.current;
    stop.cancelled = false;
    return () => {
      stop.cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    const todo = new Map<string, ClipRow>();
    for (const c of data.clips as ClipRow[]) {
      if (c.role === "music" || c.role === "sfx" || isImageFilename(c.filename)) continue;
      if (c.duration_ms == null || stripsRequested.current.has(c.storage_path)) continue;
      todo.set(c.storage_path, c);
    }
    if (todo.size === 0) return;
    for (const path of todo.keys()) stripsRequested.current.add(path);
    const stop = stripsStop.current;
    stripsQueue.current = stripsQueue.current.then(async () => {
      // Wait for the thumbnails, which show sooner.
      await new Promise((r) => setTimeout(r, 1500));
      for (const [path, c] of todo) {
        if (stop.cancelled) return;
        try {
          const { url } = await signClip({ data: { path } });
          await captureFilmstrip(
            url,
            c.duration_ms ?? 0,
            (strip) => setFilmstrips((s) => ({ ...s, [path]: strip })),
            stop,
          );
          if (stop.cancelled) return;
          const wave = await computeWaveform(url, c.size_bytes);
          setWaveforms((w) => ({ ...w, [path]: wave }));
        } catch (e) {
          console.warn("[editor] Couldn't make a clip's filmstrip or waveform:", e);
        }
      }
    });
  }, [data, signClip]);

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

  // The latest history, so undo/redo can act on it outside a state updater:
  // updaters must be pure (React may call them twice), and the actions save
  // to the server. Updated straight away so quick repeated presses each move
  // one step.
  const historyRef = useRef(history);
  historyRef.current = history;

  const pushToHistory = (item: { undo: () => void | Promise<void>; redo: () => void | Promise<void>; description: string }) => {
    const next = { past: [...historyRef.current.past, item].slice(-50), future: [] };
    historyRef.current = next;
    setHistory(next);
  };

  const runHistoryAction = (action: () => void | Promise<void>, failMessage: string) => {
    try {
      Promise.resolve(action()).catch(() => toast.error(failMessage));
    } catch {
      toast.error(failMessage);
    }
  };

  const undo = () => {
    const curr = historyRef.current;
    if (curr.past.length === 0) return;
    const last = curr.past[curr.past.length - 1];
    const next = { past: curr.past.slice(0, -1), future: [last, ...curr.future] };
    historyRef.current = next;
    setHistory(next);
    runHistoryAction(last.undo, "Failed to undo");
    toast.info(`Undid: ${last.description}`);
  };

  const redo = () => {
    const curr = historyRef.current;
    if (curr.future.length === 0) return;
    const item = curr.future[0];
    const next = { past: [...curr.past, item], future: curr.future.slice(1) };
    historyRef.current = next;
    setHistory(next);
    runHistoryAction(item.redo, "Failed to redo");
    toast.info(`Redid: ${item.description}`);
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
    stepFrames: (frames: number) => void;
    shuttle: (action: "back" | "stop" | "forward") => void;
    trimToPlayhead: (edge: "in" | "out") => void;
    moveToPlayhead: (edge: "start" | "end") => void;
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
    stepFrames: () => {},
    shuttle: () => {},
    trimToPlayhead: () => {},
    moveToPlayhead: () => {},
  });

  // Global keyboard shortcuts: Space play/pause, Del/Backspace delete,
  // S split at playhead, ⌘/Ctrl+D duplicate, +/- zoom, Ctrl+Z/Y undo/redo,
  // and After Effects-style ones: Page Up/Down step a frame (Shift: 10),
  // J/K/L back 1 s / stop / play (faster each press), Alt+[ / Alt+] trim the
  // selected clip's start/end to the playhead, [ / ] move it to start/end there.
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
      } else if (
        meta &&
        (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        // Shift turns "z" into "Z", so compare lowercase (Caps Lock too).
        e.preventDefault();
        actionsRef.current.redo();
      } else if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        actionsRef.current.undo();
      } else if (e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        // By key position: Alt + [ types another character on some layouts.
        e.preventDefault();
        actionsRef.current.trimToPlayhead(e.code === "BracketLeft" ? "in" : "out");
      } else if (!meta && !e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        // [ / ]: move the selected clip to start (or end) at the playhead.
        e.preventDefault();
        actionsRef.current.moveToPlayhead(e.code === "BracketLeft" ? "start" : "end");
      } else if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        const frames = e.shiftKey ? 10 : 1;
        actionsRef.current.stepFrames(e.key === "PageUp" ? -frames : frames);
      } else if (!meta && !e.altKey && ["j", "k", "l"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        const key = e.key.toLowerCase();
        actionsRef.current.shuttle(key === "j" ? "back" : key === "k" ? "stop" : "forward");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // One whole frame (landing exactly on it), or a second with Shift.
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.shiftKey) actionsRef.current.seekRelative(dir);
        else actionsRef.current.stepFrames(dir);
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

  function classifyFile(file: File): "aroll" | "music" | "sfx" | null {
    if (file.type.startsWith("audio/")) {
      // Short blips → sfx, longer files → music (heuristic on filename)
      if (/sfx|whoosh|impact|riser|swoosh|snap/i.test(file.name)) return "sfx";
      return "music";
    }
    // Videos and images go on the main track (V1), one after another. To put
    // one on top as B-roll, drop it on V2 or use V2's + button.
    if (file.type.startsWith("video/") || isImageFile(file)) return "aroll";
    return null;
  }

  // Track a file can go on: videos and images on V1/V2, audio on A2.
  const fitsTrack = (f: File, track: AddMediaTarget["track"]) =>
    track === "music"
      ? f.type.startsWith("audio/")
      : f.type.startsWith("video/") || isImageFile(f);

  type UploadMeta = {
    role: "aroll" | "broll" | "music" | "sfx";
    /** Its place in the project, fixed when picked so clips keep the picked order. */
    ordinal: number;
    target?: AddMediaTarget;
  };
  // The next free ordinal, counting files still uploading.
  const nextOrdinal = useRef(0);

  // Uploads run in the background, two at a time (see useUploadQueue).
  const uploadQueue = useUploadQueue<UploadMeta, ClipRow>({
    run: async (item, control) => {
      const f = item.file;
      const image = isImageFile(f);
      const contentType = f.type || "video/mp4";
      try {
        const { data: authData } = await supabase.auth.getSession();
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (authData?.session?.access_token) {
          headers["Authorization"] = `Bearer ${authData.session.access_token}`;
        }
        const presignRes = await fetch("/api/authenticated/uploads/presign", {
          method: "POST",
          headers,
          body: JSON.stringify({ projectId, filename: f.name, contentType, size: f.size }),
        });
        if (!presignRes.ok) {
          const text = await presignRes.text().catch(() => "");
          const msg = text.trim().slice(0, 200) || `Upload failed (${presignRes.status})`;
          // Wrong type, too big, no access: trying again won't help.
          throw presignRes.status === 400 || presignRes.status === 404
            ? new FinalUploadError(msg)
            : new Error(msg);
        }
        const { bucket, path, token } = (await presignRes.json()) as {
          bucket: string;
          path: string;
          token: string;
        };

        const upload = uploadToSignedUrlWithProgress(bucket, path, token, f, (loaded) =>
          control.progress(loaded),
        );
        control.onAbort(upload.abort);
        await upload.done;
        control.saving();

        // Record the clip's real length so the timeline draws it correctly
        // before it's ever opened in the player.
        // An image shows for 3 s and can be stretched to a minute (see media-kind).
        const durationMs = image ? IMAGE_MAX_MS : await probeFileDurationMs(f);
        const row = await attachFn({
          data: {
            project_id: projectId,
            storage_path: path,
            filename: f.name,
            size_bytes: f.size,
            role: item.meta.role,
            ordinal: item.meta.ordinal,
            duration_ms: durationMs ?? undefined,
            trim_out_ms: image ? IMAGE_DEFAULT_MS : undefined,
          },
        });
        // Its thumbnail (for the Projects and Assets pages), straight from
        // the file on this computer; in the background, and it's fine if it fails.
        if (image || f.type.startsWith("video/")) {
          claimThumbnail(row.id);
          const local = URL.createObjectURL(f);
          void makeThumbnail(local, f.name, thumbnailTimeMs({ ...row, filename: f.name }))
            .then((jpeg) => (jpeg ? saveThumbnail(row.id, jpeg, recordThumbFn) : undefined))
            .catch((e) => console.warn("[thumbnails] Couldn't save a thumbnail:", f.name, e))
            .finally(() => URL.revokeObjectURL(local));
        }
        return row as ClipRow;
      } catch (e) {
        if (!(e instanceof UploadCancelled)) {
          const msg = e instanceof Error ? e.message : "Upload failed";
          toast.error(`${f.name}: ${msg}`, {
            description:
              e instanceof FinalUploadError ? undefined : "You can retry it in the Media panel.",
          });
        }
        throw e;
      }
    },
    // Each clip shows up on the timeline as soon as it's in.
    onDone: () => refetch(),
    onBatchSettled: async (_batchId, finished) => {
      const added = finished.map((f) => f.result);
      const target = finished[0]?.item.meta.target;
      try {
        if (target && target.startMs != null) await placeOnTrack(added, target);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't place the clips");
      }
      const count = (role: UploadMeta["role"]) =>
        finished.filter((f) => f.item.meta.role === role).length;
      const parts = [
        count("aroll") && `${count("aroll")} on V1`,
        count("broll") && `${count("broll")} on V2`,
        count("music") && `${count("music")} music`,
        count("sfx") && `${count("sfx")} SFX`,
      ].filter(Boolean);
      toast.success(`Added ${parts.join(", ")}`);
      refetch();
    },
  });

  /**
   * Queues files to upload and add to the timeline; they go up in the
   * background while you keep editing. With a target they go on that track
   * (at its position, or the end); otherwise videos and images go on V1 one
   * after another, in the order picked, and audio on A2.
   */
  function handleUpload(files: FileList | File[], target?: AddMediaTarget) {
    const all = Array.from(files);
    if (all.some(isHeicFile)) {
      toast.error("iPhone HEIC photos can't be shown in browsers. Export them as JPG first.");
    }
    const arr = all.filter((f) =>
      target
        ? fitsTrack(f, target.track)
        : f.type.startsWith("video/") || f.type.startsWith("audio/") || isImageFile(f),
    );
    if (arr.length === 0) {
      if (all.every(isHeicFile)) return;
      toast.error(
        target
          ? target.track === "music"
            ? "Only music and sound files go on A2"
            : "Only videos and images go on V1 and V2"
          : "Drop video, audio or image files",
      );
      return;
    }
    if (target && arr.length < all.length) {
      toast.info(`Skipped ${all.length - arr.length} file(s) that don't fit that track`);
    }
    if (!data) return;
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
    const lastOrdinal = Math.max(-1, ...data.clips.map((c) => c.ordinal));
    let ordinal = Math.max(nextOrdinal.current, lastOrdinal + 1);
    const entries = arr.flatMap((f) => {
      const auto = classifyFile(f);
      const role = !target
        ? auto
        : target.track === "music"
          ? auto === "sfx"
            ? "sfx"
            : "music"
          : target.track;
      if (!role) return [];
      const tooBig = f.size > MAX_FILE_SIZE;
      return [
        {
          file: f,
          meta: { role, ordinal: ordinal++, target },
          error: tooBig
            ? `Over the 500 MB limit (${(f.size / (1024 * 1024)).toFixed(0)} MB). Export a smaller copy first.`
            : undefined,
        },
      ];
    });
    nextOrdinal.current = ordinal;
    uploadQueue.add(entries);
  }

  /**
   * Moves newly added video clips (already at the end of their track) to the
   * time they were dropped at: the nearest spot there where they fit, one
   * after another, keeping every other clip where it was.
   */
  async function placeOnTrack(added: ClipRow[], target: AddMediaTarget) {
    if (target.track === "music" || target.startMs == null || added.length === 0 || !data) return;
    const addedIds = new Set(added.map((c) => c.id));
    const existing = (data.clips as ClipRow[]).filter(
      (c) => c.role !== "music" && c.role !== "sfx" && !addedIds.has(c.id),
    );
    const existingA = existing.filter((c) => c.role !== "broll");
    const existingB = existing.filter((c) => c.role === "broll");
    // V1 is magnetic: the clips go in at the nearest gap between clips.
    const placements =
      target.track === "aroll"
        ? planMagneticInsert(
            existingA,
            existingB,
            added,
            insertIndexAt(existingA, clipVisibleMs, target.startMs),
            clipVisibleMs,
          )
        : planPlacement(existingA, existingB, added, "broll", target.startMs, clipVisibleMs)
            .placements;
    await reorder({ data: { project_id: projectId, order: placements } });
  }

  /** Adds media to a track: uploaded files, or a copy of a project clip. */
  async function addMedia(target: AddMediaTarget, source: AddMediaSource) {
    if ("files" in source) {
      await handleUpload(source.files, target);
      return;
    }
    const src = data?.clips.find((c) => c.id === source.clipId) as ClipRow | undefined;
    if (!src || !data) return;
    const isAudio = src.role === "music" || src.role === "sfx";
    if (isAudio !== (target.track === "music")) {
      toast.error(isAudio ? "Music and SFX go on A2" : "Videos and images go on V1 or V2");
      return;
    }
    // A new clip using the same uploaded file, at its full length.
    try {
      const row = await attachFn({
        data: {
          project_id: projectId,
          storage_path: src.storage_path,
          filename: src.filename,
          size_bytes: src.size_bytes ?? 0,
          role: target.track === "music" ? (src.role as "music" | "sfx") : target.track,
          ordinal: data.clips.length,
          duration_ms: src.duration_ms ?? undefined,
          // An image copy starts at the default length, not the 60 s maximum.
          trim_out_ms: isImageFilename(src.filename) ? IMAGE_DEFAULT_MS : undefined,
          parent_clip_id: src.id,
        },
      });
      await placeOnTrack([row as ClipRow], target);
      const where =
        target.track === "music"
          ? "A2 Music"
          : target.track === "broll"
            ? "V2 B-roll"
            : "V1 A-roll";
      toast.success(`Added ${src.filename} to ${where}`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the clip");
      refetch();
    }
  }

  const [downloading, setDownloading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [thumbOpen, setThumbOpen] = useState(!!search.thumbnail);
  const closeThumbnailMaker = (open: boolean) => {
    setThumbOpen(open);
    if (!open && search.thumbnail) {
      void navigate({
        to: "/projects/$projectId",
        params: { projectId },
        search: {},
        replace: true,
      });
    }
  };
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
            filename: c.filename,
            download_url: c.download_url!,
            role: c.role,
            trim_in_ms: c.trim_in_ms,
            trim_out_ms: c.trim_out_ms,
            duration_ms: c.duration_ms,
            start_ms: c.start_ms ?? null,
            transform: c.transform ?? null,
          })),
          width: dims.w * scale,
          height: dims.h * scale,
          logo:
            brand.data?.kit.logo && brand.data.logoUrl
              ? { ...brand.data.kit.logo, url: brand.data.logoUrl }
              : null,
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
  // timeline: each track (A-roll, B-roll) laid out on its own from 0:00, a
  // clip at its placed time or right after the one before (timeline-layout).
  // With no A-roll, the B-roll is the main track.
  const hasMainTrackClips = videoClipsForHooks.some((c) => c.role !== "broll");
  const programOffsets = useMemo(() => {
    const main = layoutTrack(
      videoClipsForHooks.filter((c) => c.role !== "broll"),
      clipVisibleMs,
    );
    const broll = layoutTrack(
      videoClipsForHooks.filter((c) => c.role === "broll"),
      clipVisibleMs,
    );
    return new Map([...main.starts, ...broll.starts]);
  }, [videoClipsForHooks]);

  // The main player is the live timeline, the render, or the selected clip's
  // file (see PreviewCanvas). currentTime means a position in whichever one it
  // is showing, so every time conversion has to check this first. Render
  // needs a render and Clip a selected clip; otherwise the live timeline.
  const shownViewMode: ViewMode =
    viewMode === "render" && previewUrl
      ? "render"
      : viewMode === "clip" && selectedClipUrl
        ? "clip"
        : "timeline";
  // The timeline and the render share one clock: the player's time is a
  // time on the timeline. A clip on its own is in its file's time instead.
  const showingProgram = shownViewMode !== "clip";
  const selectedIsImage = useMemo(() => {
    const c = data?.clips.find((x) => x.id === selectedClipId);
    return !!c && isImageFilename(c.filename);
  }, [data, selectedClipId]);

  // The part of the player's file that belongs to the edit: all of the render,
  // or the selected clip's trimmed part of its source file. Play, seek and the
  // transport time stay inside it (seconds in the file).
  const selectedTrim = useMemo(() => {
    const c = data?.clips.find((x) => x.id === selectedClipId) as ClipRow | undefined;
    if (!c) return null;
    return {
      startS: (c.trim_in_ms ?? 0) / 1000,
      endS: c.trim_out_ms != null ? c.trim_out_ms / 1000 : null,
    };
  }, [data, selectedClipId]);
  const playRange =
    !showingProgram && selectedTrim
      ? {
          startS: Math.min(selectedTrim.startS, duration || selectedTrim.startS),
          endS: Math.min(duration, selectedTrim.endS ?? duration),
        }
      : { startS: 0, endS: duration };

  // An image in Source view has no playback: the playhead sits at its start.
  useEffect(() => {
    if (selectedIsImage && !showingProgram) {
      setCurrentTime(0);
      setDuration(0);
    }
  }, [selectedIsImage, showingProgram, selectedClipId]);

  // Stop at the trimmed end of a source clip (timeupdate fires too rarely to
  // stop on time, so check every frame while playing).
  useEffect(() => {
    const end = playRange.endS;
    if (!playing || showingProgram || !(end > 0) || end >= duration - 0.01) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && v.currentTime >= end) {
        v.pause();
        v.currentTime = end;
        setCurrentTime(end);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, showingProgram, playRange.endS, duration]);

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

  // Music and SFX for the live preview, mixed like the export and driven by
  // the timeline player's clock.
  const mainForHooks = hasMainTrackClips
    ? videoClipsForHooks.filter((c) => c.role !== "broll")
    : videoClipsForHooks;
  // B-roll on top of the main track (none when the B-roll is the main track).
  const overForHooks = hasMainTrackClips
    ? videoClipsForHooks.filter((c) => c.role === "broll")
    : [];
  const mainEndForHooks = layoutTrack(mainForHooks, clipVisibleMs).endMs;
  // The video runs until the last clip on V1 or V2 ends.
  const programEndForHooks = videoEndMs(mainForHooks, overForHooks, clipVisibleMs);
  const overStartsForHooks = layoutTrack(overForHooks, clipVisibleMs).starts;
  const previewAudioTick = usePreviewAudio({
    audioClips: ((data?.clips ?? []) as ClipRow[]).filter(
      (c) => c.role === "music" || c.role === "sfx",
    ),
    urls: clipUrls,
    lengthMs: clipVisibleMs,
    endMs: programEndForHooks,
    cutsMs: mainForHooks.slice(1).map((c) => programOffsets.get(c.id) ?? 0),
    enabled: musicEnabled,
    volume: musicVolume,
    muted,
    // The voice: a main-track video (not an image) under the playhead, or
    // after the main track ends, a B-roll video (which plays with its sound).
    voiceAt: (t) =>
      mainForHooks.some((c) => {
        const start = programOffsets.get(c.id) ?? 0;
        return t >= start && t < start + clipVisibleMs(c) && !isImageFilename(c.filename);
      }) ||
      (t >= mainEndForHooks &&
        overForHooks.some((c) => {
          const start = overStartsForHooks.get(c.id) ?? 0;
          return t >= start && t < start + clipVisibleMs(c) && !isImageFilename(c.filename);
        })),
  });

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
  // The phrases the export burns in, word by word (for the live preview).
  const captionWordPhrases = groupIntoPhrases(placeTranscripts(captionSegments, transcriptMap));
  // The same phrases the Captions tab lists, for the timeline's caption track.
  const captionPhrases: CaptionPhrase[] = captionWordPhrases.map((phrase) => ({
    key: phrase[0].key,
    text: phrase.map((w) => w.text).join(" "),
    startMs: phrase[0].startMs,
    endMs: phrase[phrase.length - 1].endMs,
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
  // The AI hook from the last cloud render (shown for the first 3 seconds).
  const renderPlan = latestJob?.edit_plan as { hook?: unknown } | null | undefined;
  const renderHook =
    typeof renderPlan?.hook === "string" && renderPlan.hook.trim() ? renderPlan.hook.trim() : null;

  const selectedClip = selectedClipId
    ? (clips.find((c) => c.id === selectedClipId) as ClipRow | undefined)
    : undefined;

  /**
   * Selects a clip from the timeline. On the live timeline (or the render),
   * the playhead also moves into it, like After Effects and Premiere.
   */
  function selectAndSeek(id: string) {
    setSelectedClipId(id);
    const c = clips.find((x) => x.id === id);
    const v = videoRef.current;
    if (!c || !v || !showingProgram || c.role === "music" || c.role === "sfx") return;
    const start = programOffsets.get(id) ?? 0;
    const end = start + clipVisibleMs(c);
    if (timelinePlayheadMs < start || timelinePlayheadMs >= end) {
      v.currentTime = start / 1000;
      setCurrentTime(start / 1000);
    }
  }

  // ---- Timeline actions ----
  /**
   * Trims a clip, with undo. A placed clip (one with its own start) keeps
   * the rest of its frames where they are, so its start moves with its
   * in-point, like a layer in After Effects.
   */
  function trimClip(id: string, ti: number, to: number | null) {
    const c = clips.find((x) => x.id === id);
    if (!c) return;
    const prevIn = c.trim_in_ms ?? 0;
    const prevOut = c.trim_out_ms ?? null;
    const placed = c.start_ms != null;
    const prevStart = c.start_ms ?? null;
    const start = placed ? Math.max(0, (c.start_ms ?? 0) + (ti - prevIn)) : undefined;

    pushToHistory({
      description: "Trim clip",
      undo: () => {
        trimMut.mutate({
          id,
          trim_in_ms: prevIn,
          trim_out_ms: prevOut,
          ...(placed ? { start_ms: prevStart } : {}),
        });
      },
      redo: () => {
        trimMut.mutate({
          id,
          trim_in_ms: ti,
          trim_out_ms: to,
          ...(placed ? { start_ms: start } : {}),
        });
      },
    });

    trimMut.mutate({
      id,
      trim_in_ms: ti,
      trim_out_ms: to,
      ...(placed ? { start_ms: start } : {}),
    });
  }

  /** Moves, resizes or rotates a clip in the frame (null: its default fit), with undo. */
  function transformClip(id: string, next: ClipTransform | null) {
    const c = clips.find((x) => x.id === id);
    if (!c) return;
    const prev = parseTransform(c.transform);
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    pushToHistory({
      description: next ? "Move clip in frame" : "Reset clip position",
      undo: () => transformMut.mutate({ id, transform: prev }),
      redo: () => transformMut.mutate({ id, transform: next }),
    });
    transformMut.mutate({ id, transform: next });
  }

  /** [ / ]: the selected clip starts (or ends) at the playhead, where it fits. */
  function moveToPlayhead(edge: "start" | "end") {
    if (!selectedClip || selectedClip.role === "music" || selectedClip.role === "sfx") {
      toast("Select a clip on V1 or V2 first");
      return;
    }
    const track = selectedClip.role === "broll" ? "broll" : "aroll";
    const want =
      edge === "start" ? timelinePlayheadMs : timelinePlayheadMs - clipVisibleMs(selectedClip);
    // V1 is magnetic: the clip moves to the gap between clips nearest there.
    const others = aRoll.filter((c) => c.id !== selectedClip.id);
    const placements =
      track === "aroll"
        ? planMagneticInsert(
            aRoll,
            bRoll,
            [selectedClip],
            insertIndexAt(others, clipVisibleMs, Math.max(0, want) + clipVisibleMs(selectedClip) / 2),
            clipVisibleMs,
          )
        : planPlacement(aRoll, bRoll, [selectedClip], track, Math.max(0, want), clipVisibleMs)
            .placements;
    const before = currentPlacements(aRoll, bRoll);
    pushToHistory({
      description: "Move clip",
      undo: () => reorderMut.mutate({ order: before }),
      redo: () => reorderMut.mutate({ order: placements }),
    });
    reorderMut.mutate({ order: placements });
  }

  /** Alt+[ / Alt+]: the selected clip starts or ends at the playhead. */
  function trimToPlayhead(edge: "in" | "out") {
    if (!selectedClip || selectedClip.role === "music" || selectedClip.role === "sfx") {
      toast("Select a clip on V1 or V2 first");
      return;
    }
    const start = programOffsets.get(selectedClip.id) ?? 0;
    const length = clipVisibleMs(selectedClip);
    const into = timelinePlayheadMs - start;
    // Keep at least a few frames of the clip.
    if (into < 100 || into > length - 100) {
      toast("Move the playhead inside the selected clip first");
      return;
    }
    const trimIn = selectedClip.trim_in_ms ?? 0;
    const trimOut = selectedClip.trim_out_ms ?? selectedClip.duration_ms ?? trimIn + length;
    if (edge === "in") trimClip(selectedClip.id, Math.round(trimIn + into), trimOut);
    else trimClip(selectedClip.id, trimIn, Math.round(trimIn + into));
  }

  /** Page Up/Down: move the playhead by whole frames (pausing playback). */
  function stepFrames(frames: number) {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) v.pause();
    seekAbsolute(snapToFrame(v.currentTime + frames / FPS));
  }

  /** J/K/L: back 1 s, stop, or play (each L press doubles the speed, up to 4×). */
  function shuttle(action: "back" | "stop" | "forward") {
    const v = videoRef.current;
    if (!v) return;
    if (action === "back") {
      seekAbsolute(v.currentTime - 1);
      return;
    }
    if (action === "stop") {
      v.pause();
      v.playbackRate = 1;
      setPlaybackRate(1);
      return;
    }
    const rate = v.paused ? 1 : Math.min(4, v.playbackRate * 2);
    v.playbackRate = rate;
    setPlaybackRate(rate);
    if (v.paused) togglePlay();
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    // At (or past) the end, or before the start: play from the start.
    const { startS, endS } = playRange;
    if (v.ended || v.currentTime >= endS - 0.05 || v.currentTime < startS - 0.05) {
      v.currentTime = startS;
      setCurrentTime(startS);
    }
    v.play().catch(() => {});
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

  // Seeks the player to a time in its file, kept inside playRange.
  const seekAbsolute = (time: number) => {
    const v = videoRef.current;
    if (!v) return;
    const target = Math.max(playRange.startS, Math.min(playRange.endS || v.duration || 0, time));
    v.currentTime = target;
    setCurrentTime(target);
  };

  const seekRelative = (offset: number) => {
    const v = videoRef.current;
    if (!v) return;
    seekAbsolute(v.currentTime + offset);
  };

  // The transport bar covers playRange: 0% is its start, 100% its end.
  const seekToPct = (pct: number) =>
    seekAbsolute(playRange.startS + (pct / 100) * (playRange.endS - playRange.startS));

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
    stepFrames,
    shuttle,
    trimToPlayhead,
    moveToPlayhead,
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
        setDragActive(false);
        // Dropped on a track: the timeline already added it there.
        if (e.defaultPrevented || !e.dataTransfer.files.length) return;
        e.preventDefault();
        handleUpload(e.dataTransfer.files);
      }}
    >
      {dragActive && (
        <div className="absolute inset-0 z-50 pointer-events-none grid place-items-center bg-violet-600/15 backdrop-blur-sm">
          <div className="pointer-events-none border-2 border-dashed border-violet-500 rounded-2xl p-10 text-center bg-black/85 shadow-2xl">
            <UploadCloud className="w-10 h-10 text-violet-400 mx-auto" />
            <div className="mt-3 text-sm font-semibold text-violet-300">
              Drop videos, images or audio to add them
            </div>
            <div className="mt-1 text-[11px] text-neutral-400 font-mono">
              Drop here to auto-place · or on a track to choose where
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
            onOpenThumbnail={() => setThumbOpen(true)}
            isRenderDisabled={
              render.isPending || (inProgress && project.status !== "ready")
            }
            clipCount={clips.length}
            onUndo={undo}
            onRedo={redo}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            uploads={uploadSummary(uploadQueue.items)}
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
            uploads={
              <UploadList
                items={uploadQueue.items}
                onCancel={uploadQueue.cancel}
                onRetry={uploadQueue.retry}
                onDismiss={uploadQueue.remove}
              />
            }
          />
        }
        centerPanel={
          <PreviewCanvas
            aspectRatio={project.aspect_ratio}
            onAspectRatioChange={(ratio) => changeAspect.mutate(ratio)}
            viewMode={shownViewMode}
            onViewModeChange={setViewMode}
            programUrl={previewUrl}
            sourceUrl={selectedClipUrl}
            timeline={{
              aRoll,
              bRoll,
              urls: clipUrls,
              lengthMs: clipVisibleMs,
              onTick: previewAudioTick,
              // Captions (when on) and the last render's AI hook, like the export.
              renderOverlay: (timeMs) => (
                <PreviewOverlay
                  kit={brand.data?.kit}
                  logoUrl={brand.data?.logoUrl}
                  timeMs={timeMs}
                  phrases={captionsEnabled ? captionWordPhrases : []}
                  hook={renderHook}
                />
              ),
              selectedClipId,
              onSelectClip: (id) => setSelectedClipId(id),
              onTransform: transformClip,
              onStall: resignClipLink,
            }}
            sourceIsImage={selectedIsImage}
            imageLengthMs={selectedClip ? clipVisibleMs(selectedClip) : undefined}
            selectedClipFilename={selectedClip?.filename}
            hasClips={videoClips.length > 0}
            isRendering={Boolean(inProgress)}
            renderProgress={latestJob?.progress ?? 0}
            renderStageMessage={latestJob?.stage_message}
            playing={playing}
            playbackRate={playbackRate}
            onPlayingChange={setPlaying}
            onTogglePlay={togglePlay}
            currentTime={
              selectedIsImage && !showingProgram ? 0 : Math.max(0, currentTime - playRange.startS)
            }
            duration={
              selectedIsImage && !showingProgram && selectedClip
                ? clipVisibleMs(selectedClip) / 1000
                : Math.max(0, playRange.endS - playRange.startS)
            }
            onSeek={seekToPct}
            onSkipBack={() => seekAbsolute(0)}
            onSkipForward={() => seekAbsolute(duration)}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            videoRef={videoRef}
            onTimeUpdate={(t) => setCurrentTime(t)}
            onLoadedMetadata={(d) => {
              setDuration(d);
              const v = videoRef.current;
              // A new file plays at normal speed.
              setPlaybackRate(1);
              if (pendingSourceSeekMs.current != null && v) {
                v.currentTime = pendingSourceSeekMs.current / 1000;
                setCurrentTime(pendingSourceSeekMs.current / 1000);
                pendingSourceSeekMs.current = null;
              } else if (v && !showingProgram && selectedClip?.trim_in_ms) {
                // A trimmed source clip starts at its trimmed start.
                v.currentTime = selectedClip.trim_in_ms / 1000;
                setCurrentTime(v.currentTime);
              } else {
                setCurrentTime(v?.currentTime ?? 0);
              }
              // Only the selected clip's own file tells us its length.
              if (selectedClipId && d > 0 && !showingProgram) {
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
                  onTransform={(next) => transformClip(selectedClip.id, next)}
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
                  onMusicEnabledChange={(on) => saveExportSwitches.mutate({ music_enabled: on })}
                  onMusicVolumeChange={setVolumeDraft}
                  onMusicVolumeCommit={(vol) => {
                    if (vol !== data?.project.music_volume) {
                      saveExportSwitches.mutate({ music_volume: vol });
                    } else {
                      setVolumeDraft(null);
                    }
                  }}
                  onCaptionsEnabledChange={(on) =>
                    saveExportSwitches.mutate({ captions_enabled: on })
                  }
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
            onSelect={selectAndSeek}
            onTrim={trimClip}
            captions={captionsEnabled}
            onCaptionsToggle={() =>
              saveExportSwitches.mutate({ captions_enabled: !captionsEnabled })
            }
            onMusicToggle={() => saveExportSwitches.mutate({ music_enabled: !musicEnabled })}
            onAddMedia={(target, source) => void addMedia(target, source)}
            captionPhrases={captionPhrases}
            audioClips={audioClips}
            thumbnails={thumbnails}
            filmstrips={filmstrips}
            waveforms={waveforms}
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

      <ThumbnailMaker
        open={thumbOpen}
        onOpenChange={closeThumbnailMaker}
        projectId={projectId}
        projectTitle={project.title}
        aspectRatio={project.aspect_ratio}
        clips={[...aRoll, ...bRoll]}
        urls={clipUrls}
        initialClipId={selectedClipId}
        kit={brand.data?.kit}
        logoUrl={brand.data?.logoUrl}
        hasCover={!!project.thumbnail_url}
      />
    </div>
  );
}
