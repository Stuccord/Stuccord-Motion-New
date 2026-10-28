// The Thumbnail maker: pick any moment of any clip, zoom and crop it, darken
// it, add a title (in the brand kit's font and colours) and the logo, then
// download it or make it the project's cover (shown on Home and Projects).
//
// Everything is drawn on a canvas at full output size; the preview is that
// same canvas scaled down, so what you see is what you download.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ImageIcon, Loader2, Move, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { supabase } from "@/integrations/supabase/client";
import { setProjectCover } from "@/lib/projects.functions";
import { aspectDims } from "@/lib/client-render";
import { thumbnailTimeMs } from "@/lib/clip-thumbnails";
import { isImageFilename } from "@/lib/media-kind";
import { DEFAULT_KIT, fontCss, useBrandFonts, type BrandKit } from "@/lib/brand-kit";

export type ThumbnailClip = {
  id: string;
  filename: string;
  storage_path: string;
  role: string;
  trim_in_ms?: number | null;
  trim_out_ms?: number | null;
  duration_ms?: number | null;
};

type SizeId = "project" | "youtube" | "square";
type TitlePos = "top" | "middle" | "bottom";
type TitleStyle = "outline" | "box";

const SIZES: Record<Exclude<SizeId, "project">, { w: number; h: number; label: string }> = {
  youtube: { w: 1280, h: 720, label: "YouTube · 1280×720" },
  square: { w: 1080, h: 1080, label: "Square · 1080×1080" },
};

/** Breaks text into lines no wider than maxW (and keeps the user's own line breaks). */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > maxW) {
        out.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function ThumbnailMaker({
  open,
  onOpenChange,
  projectId,
  folder,
  projectTitle,
  aspectRatio,
  clips,
  urls,
  initialClipId,
  kit: kitIn,
  logoUrl,
  hasCover,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Where the project's files live (the user's folder, or the team's). */
  folder: string;
  projectTitle: string;
  aspectRatio: string;
  /** Video and image clips (V1 first). */
  clips: ThumbnailClip[];
  /** Signed links by storage path. */
  urls: Record<string, string>;
  initialClipId?: string | null;
  kit?: BrandKit;
  logoUrl?: string | null;
  hasCover: boolean;
}) {
  const kit = kitIn ?? DEFAULT_KIT;
  useBrandFonts();
  const qc = useQueryClient();
  const saveCover = useServerFn(setProjectCover);

  // ---------- settings ----------
  const [clipId, setClipId] = useState<string | null>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [size, setSize] = useState<SizeId>("project");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [darken, setDarken] = useState(0.15);
  const [vignette, setVignette] = useState(0.35);
  const [title, setTitle] = useState("");
  const [titleSize, setTitleSize] = useState(11);
  const [titlePos, setTitlePos] = useState<TitlePos>("bottom");
  const [titleStyle, setTitleStyle] = useState<TitleStyle>("outline");
  const [textColor, setTextColor] = useState(kit.textColor);
  const [edgeColor, setEdgeColor] = useState(kit.outlineColor);
  const [showLogo, setShowLogo] = useState(!!kit.logo);
  const [busy, setBusy] = useState<null | "cover" | "remove">(null);

  // Fresh each time it opens: the selected clip (or the first), at the
  // moment its timeline thumbnail uses, with the brand kit's colours.
  useEffect(() => {
    if (!open) return;
    const first = clips.find((c) => c.id === initialClipId) ?? clips[0] ?? null;
    setClipId(first?.id ?? null);
    setTimeMs(first ? thumbnailTimeMs(first) : 0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTextColor(kit.textColor);
    setEdgeColor(kit.outlineColor);
    setShowLogo(!!kit.logo && !!logoUrl);
    // Only when opening (or another clip list arrives while closed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clip = clips.find((c) => c.id === clipId) ?? null;
  const isImage = clip ? isImageFilename(clip.filename) : false;
  const range = useMemo(() => {
    if (!clip) return { from: 0, to: 0 };
    const from = clip.trim_in_ms ?? 0;
    const to = clip.trim_out_ms ?? clip.duration_ms ?? from + 5000;
    return { from, to: Math.max(from, to - 40) };
  }, [clip]);
  const out = size === "project" ? aspectDims(aspectRatio) : SIZES[size];

  // ---------- the frame ----------
  const [source, setSource] = useState<HTMLVideoElement | HTMLImageElement | null>(null);
  const [frameState, setFrameState] = useState<"loading" | "ready" | "error">("loading");
  const [frameTick, setFrameTick] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timeRef = useRef(timeMs);
  timeRef.current = timeMs;
  const url = clip ? urls[clip.storage_path] : undefined;

  useEffect(() => {
    if (!open || !clip || !url) {
      setSource(null);
      setFrameState("loading");
      return;
    }
    setFrameState("loading");
    setSource(null);
    let cancelled = false;
    if (isImage) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (cancelled) return;
        setSource(img);
        setFrameState("ready");
      };
      img.onerror = () => !cancelled && setFrameState("error");
      img.src = url;
      return () => {
        cancelled = true;
      };
    }
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    videoRef.current = v;
    const onSeeked = () => {
      if (cancelled) return;
      setSource(v);
      setFrameState("ready");
      setFrameTick((n) => n + 1);
    };
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("loadeddata", () => {
      if (!cancelled) v.currentTime = timeRef.current / 1000;
    });
    v.addEventListener("error", () => !cancelled && setFrameState("error"));
    v.src = url;
    return () => {
      cancelled = true;
      v.removeEventListener("seeked", onSeeked);
      v.removeAttribute("src");
      v.load();
      if (videoRef.current === v) videoRef.current = null;
    };
    // Later times are applied by the effect below; a new clip or link reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clip?.id, url, isImage]);

  // Moving the time slider seeks the video (the frame is drawn once it lands).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || isImage || v.readyState < 1) return;
    const t = timeMs / 1000;
    if (Math.abs(v.currentTime - t) > 0.01) v.currentTime = t;
  }, [timeMs, isImage]);

  // The logo picture.
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!open || !logoUrl) {
      setLogoImg(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setLogoImg(img);
    img.onerror = () => setLogoImg(null);
    img.src = logoUrl;
  }, [open, logoUrl]);

  // ---------- drawing ----------
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const family = fontCss(kit.font) || "Inter, system-ui, sans-serif";
  const fontPx = Math.round((Math.min(out.w, out.h) * titleSize) / 100);
  const font = `${kit.font === "default" ? "800 " : ""}${fontPx}px ${family}`;
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    if (!open || typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    void document.fonts.load(font, title || "A").then(() => {
      if (!cancelled) setFontsReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [open, font, title]);

  // Where the picture sits: covers the frame, zoomed, moved by pan (-1..1).
  const placement = useCallback(
    (sw: number, sh: number) => {
      const s = Math.max(out.w / sw, out.h / sh) * zoom;
      const dw = sw * s;
      const dh = sh * s;
      return {
        dw,
        dh,
        x: (out.w - dw) / 2 - (pan.x * (dw - out.w)) / 2,
        y: (out.h - dh) / 2 - (pan.y * (dh - out.h)) / 2,
      };
    },
    [out.w, out.h, zoom, pan],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas) return;
    canvas.width = out.w;
    canvas.height = out.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w: W, h: H } = out;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    if (source) {
      const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
      const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
      if (sw > 0 && sh > 0) {
        const p = placement(sw, sh);
        ctx.drawImage(source, p.x, p.y, p.dw, p.dh);
      }
    }
    if (darken > 0) {
      ctx.fillStyle = `rgba(0,0,0,${darken})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (vignette > 0) {
      const r = Math.hypot(W, H) / 2;
      const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${Math.min(1, vignette * 1.6)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Title.
    const text = title.trim();
    if (text) {
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrapLines(ctx, text, W * 0.86).slice(0, 4);
      const lineH = fontPx * 1.12;
      const blockH = lines.length * lineH;
      const margin = Math.min(W, H) * 0.08;
      const top =
        titlePos === "top"
          ? margin
          : titlePos === "middle"
            ? (H - blockH) / 2
            : H - margin - blockH;
      lines.forEach((line, i) => {
        const cy = top + lineH * (i + 0.5);
        if (titleStyle === "box") {
          const tw = ctx.measureText(line).width;
          const padX = fontPx * 0.3;
          ctx.fillStyle = edgeColor;
          ctx.fillRect(W / 2 - tw / 2 - padX, cy - lineH / 2, tw + padX * 2, lineH);
        } else {
          ctx.lineJoin = "round";
          ctx.lineWidth = Math.max(2, fontPx * 0.14);
          ctx.strokeStyle = edgeColor;
          ctx.strokeText(line, W / 2, cy);
        }
        ctx.fillStyle = textColor;
        ctx.fillText(line, W / 2, cy);
      });
    }

    // Logo, in the brand kit's corner, size and opacity.
    if (showLogo && logoImg && kit.logo) {
      const lw = W * kit.logo.width;
      const lh = (lw * logoImg.naturalHeight) / Math.max(1, logoImg.naturalWidth);
      const m = Math.min(W, H) * 0.04;
      const lx = kit.logo.corner.endsWith("l") ? m : W - m - lw;
      const ly = kit.logo.corner.startsWith("t") ? m : H - m - lh;
      ctx.globalAlpha = kit.logo.opacity;
      ctx.drawImage(logoImg, lx, ly, lw, lh);
      ctx.globalAlpha = 1;
    }
  }, [
    open,
    out,
    source,
    frameTick,
    placement,
    darken,
    vignette,
    title,
    font,
    fontPx,
    fontsReady,
    titlePos,
    titleStyle,
    textColor,
    edgeColor,
    showLogo,
    logoImg,
    kit.logo,
  ]);

  // Dragging the preview moves the picture (when zoomed in or cropped).
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!source) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pan };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const canvas = canvasRef.current;
    if (!d || !canvas || !source) return;
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    const p = placement(sw, sh);
    const k = out.w / canvas.getBoundingClientRect().width;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const spareX = p.dw - out.w;
    const spareY = p.dh - out.h;
    setPan({
      x: spareX > 0.5 ? clamp(d.pan.x - ((e.clientX - d.x) * k * 2) / spareX) : 0,
      y: spareY > 0.5 ? clamp(d.pan.y - ((e.clientY - d.y) * k * 2) / spareY) : 0,
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // ---------- saving ----------
  const toBlob = (type: "image/png" | "image/jpeg") =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) return reject(new Error("Nothing to save yet"));
      try {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture"))),
          type,
          0.92,
        );
      } catch {
        // A frame the browser wasn't allowed to read back.
        reject(new Error("This clip's picture can't be saved from the browser"));
      }
    });

  const fileBase =
    (projectTitle || "thumbnail").replace(/[\\/:*?"<>|]+/g, "").trim() || "thumbnail";
  const download = async (type: "image/png" | "image/jpeg") => {
    try {
      const blob = await toBlob(type);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileBase} thumbnail.${type === "image/png" ? "png" : "jpg"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't download the thumbnail");
    }
  };

  const makeCover = async () => {
    setBusy("cover");
    let path: string | null = null;
    try {
      const blob = await toBlob("image/jpeg");
      path = `${folder}/thumbs/cover-${projectId}-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("raw-clips")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(error.message);
      await saveCover({ data: { project_id: projectId, path } });
      path = null;
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Set as the project's cover");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the cover");
      // An uploaded file that didn't become the cover isn't kept.
      if (path) void supabase.storage.from("raw-clips").remove([path]);
    } finally {
      setBusy(null);
    }
  };

  const removeCover = async () => {
    setBusy("remove");
    try {
      await saveCover({ data: { project_id: projectId, path: null } });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Cover removed: the first clip's frame is shown again");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove the cover");
    } finally {
      setBusy(null);
    }
  };

  const fmt = (ms: number) => {
    const s = Math.max(0, ms - range.from) / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  };
  const projectSize = aspectDims(aspectRatio);
  const canSave = frameState === "ready";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1000px] max-h-[92vh] overflow-y-auto bg-[#0f0f18] border-white/10 text-neutral-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-50">
            <ImageIcon className="w-4 h-4 text-violet-400" />
            Thumbnail maker
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            Pick a moment, add a title, then download it or make it this project&apos;s cover.
          </DialogDescription>
        </DialogHeader>

        {clips.length === 0 ? (
          <div className="py-12 text-center text-sm text-neutral-400">
            Add a video or picture to this project first.
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-[1fr_300px]">
            {/* Preview */}
            <div className="flex flex-col gap-3 min-w-0">
              <div className="relative grid place-items-center rounded-xl bg-black/60 border border-white/5 p-3 min-h-[280px]">
                <canvas
                  ref={canvasRef}
                  aria-label="Thumbnail preview"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className="max-w-full max-h-[56vh] rounded-md shadow-2xl touch-none cursor-grab active:cursor-grabbing"
                  style={{ aspectRatio: `${out.w} / ${out.h}` }}
                />
                {frameState !== "ready" && (
                  <div className="absolute inset-0 grid place-items-center text-xs text-neutral-300">
                    {frameState === "loading" ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading the frame…
                      </span>
                    ) : (
                      <span>This clip&apos;s picture couldn&apos;t be loaded.</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <Move className="w-3 h-3" /> Zoom in, then drag the picture to choose what shows.
              </div>

              {/* Moment */}
              <div className="grid gap-3 sm:grid-cols-[200px_1fr] items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs text-neutral-400">Clip</Label>
                  <Select
                    value={clipId ?? undefined}
                    onValueChange={(id) => {
                      const c = clips.find((x) => x.id === id);
                      setClipId(id);
                      if (c) setTimeMs(thumbnailTimeMs(c));
                      setPan({ x: 0, y: 0 });
                    }}
                  >
                    <SelectTrigger className="h-9 bg-white/5 border-white/10 text-xs">
                      <SelectValue placeholder="Pick a clip" />
                    </SelectTrigger>
                    <SelectContent>
                      {clips.map((c) => {
                        // Numbered within its own track, as on the timeline.
                        const track = clips.filter(
                          (x) => (x.role === "broll") === (c.role === "broll"),
                        );
                        return (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            {c.role === "broll" ? "V2" : "V1"} · {track.indexOf(c) + 1}.{" "}
                            {c.filename}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                {!isImage && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-neutral-400">
                      <Label>Moment</Label>
                      <span className="font-mono">{fmt(timeMs)}</span>
                    </div>
                    <Slider
                      aria-label="Moment in the clip"
                      min={range.from}
                      max={range.to}
                      step={40}
                      value={[Math.min(range.to, Math.max(range.from, timeMs))]}
                      onValueChange={(v) => setTimeMs(v[0])}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-5 text-sm">
              <Field label="Size">
                <Select value={size} onValueChange={(v) => setSize(v as SizeId)}>
                  <SelectTrigger className="h-9 bg-white/5 border-white/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project" className="text-xs">
                      Like the video · {projectSize.w}×{projectSize.h}
                    </SelectItem>
                    <SelectItem value="youtube" className="text-xs">
                      {SIZES.youtube.label}
                    </SelectItem>
                    <SelectItem value="square" className="text-xs">
                      {SIZES.square.label}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Range
                label="Zoom"
                value={zoom}
                min={1}
                max={3}
                step={0.05}
                show={`${zoom.toFixed(2)}×`}
                onChange={(v) => {
                  setZoom(v);
                  if (v === 1) setPan({ x: 0, y: 0 });
                }}
              />
              <Range
                label="Darken"
                value={darken}
                min={0}
                max={0.7}
                step={0.01}
                show={`${Math.round(darken * 100)}%`}
                onChange={setDarken}
              />
              <Range
                label="Vignette"
                value={vignette}
                min={0}
                max={0.6}
                step={0.01}
                show={`${Math.round(vignette * 100)}%`}
                onChange={setVignette}
              />

              <div className="space-y-2 pt-1 border-t border-white/5">
                <Label className="text-xs text-neutral-400 pt-3 block">Title</Label>
                <Textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                  placeholder="e.g. I tried this for 30 days"
                  rows={2}
                  className="bg-white/5 border-white/10 text-sm resize-none"
                />
                <Range
                  label="Text size"
                  value={titleSize}
                  min={6}
                  max={18}
                  step={0.5}
                  show={`${titleSize}%`}
                  onChange={setTitleSize}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Place">
                    <Select value={titlePos} onValueChange={(v) => setTitlePos(v as TitlePos)}>
                      <SelectTrigger className="h-8 bg-white/5 border-white/10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="top" className="text-xs">
                          Top
                        </SelectItem>
                        <SelectItem value="middle" className="text-xs">
                          Middle
                        </SelectItem>
                        <SelectItem value="bottom" className="text-xs">
                          Bottom
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Style">
                    <Select
                      value={titleStyle}
                      onValueChange={(v) => setTitleStyle(v as TitleStyle)}
                    >
                      <SelectTrigger className="h-8 bg-white/5 border-white/10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="outline" className="text-xs">
                          Outline
                        </SelectItem>
                        <SelectItem value="box" className="text-xs">
                          Box
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-400">
                  <ColorPick label="Text" value={textColor} onChange={setTextColor} />
                  <ColorPick
                    label={titleStyle === "box" ? "Box" : "Outline"}
                    value={edgeColor}
                    onChange={setEdgeColor}
                  />
                </div>
                <div className="text-[11px] text-neutral-500">
                  Font and colours start from your brand kit.
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <div>
                  <div className="text-xs text-neutral-300">Logo</div>
                  <div className="text-[11px] text-neutral-500">
                    {kit.logo ? "From your brand kit" : "Add one in Settings → Brand kit"}
                  </div>
                </div>
                <Switch
                  aria-label="Show the logo"
                  checked={showLogo && !!kit.logo}
                  disabled={!kit.logo || !logoUrl}
                  onCheckedChange={setShowLogo}
                />
              </div>

              <div className="space-y-2 pt-3 border-t border-white/5">
                <Button
                  className="w-full bg-violet-600 hover:bg-violet-500 text-white"
                  disabled={!canSave || busy !== null}
                  onClick={() => void makeCover()}
                >
                  {busy === "cover" ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Star className="w-4 h-4 mr-1.5" />
                  )}
                  Set as project cover
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="bg-white/5 border-white/10 hover:bg-white/10 text-neutral-100"
                    disabled={!canSave}
                    onClick={() => void download("image/png")}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> PNG
                  </Button>
                  <Button
                    variant="outline"
                    className="bg-white/5 border-white/10 hover:bg-white/10 text-neutral-100"
                    disabled={!canSave}
                    onClick={() => void download("image/jpeg")}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> JPG
                  </Button>
                </div>
                {hasCover && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-neutral-400 hover:text-neutral-100 hover:bg-white/5"
                    disabled={busy !== null}
                    onClick={() => void removeCover()}
                  >
                    {busy === "remove" ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Remove the current cover
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-neutral-400">{label}</Label>
      {children}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  show,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-neutral-400">
        <Label>{label}</Label>
        <span className="font-mono">{show}</span>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}

function ColorPick({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="w-7 h-7 rounded border border-white/10 bg-transparent p-0.5 cursor-pointer"
        aria-label={`${label} colour`}
      />
      {label}
    </label>
  );
}
