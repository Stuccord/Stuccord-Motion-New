// Settings > Brand kit: caption font, colours, size and position, the hook's
// box colour, and a logo watermark, with a live preview drawn exactly like
// the editor's (PreviewOverlay). Saved on the account; every project's
// preview and exports use it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { PreviewOverlay } from "@/components/editor/PreviewOverlay";
import { getClipSignedUrl } from "@/lib/projects.functions";
import type { TimelineWord } from "@/lib/captions";
import {
  DEFAULT_KIT,
  FONTS,
  LOGO_WIDTH,
  fontCss,
  loadBrandKit,
  parseBrandKit,
  removeLogoFile,
  saveBrandKit,
  uploadLogo,
  useBrandFonts,
  type BrandKit,
} from "@/lib/brand-kit";

// A sample caption for the preview: the third word is being spoken.
const SAMPLE: TimelineWord[][] = [
  ["Three", "habits", "changed", "my", "mornings"].map((text, i) => ({
    key: `s${i}`,
    clipId: "sample",
    storagePath: "sample",
    wordIndex: i,
    text,
    startMs: i * 300,
    endMs: i * 300 + 280,
  })),
];
const SAMPLE_AT_MS = 700;

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-black/10 p-0.5 bg-white"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "px-2.5 h-7 text-xs rounded",
            value === o.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-9 h-9 rounded border border-black/10 cursor-pointer bg-white p-0.5"
          aria-label={label}
        />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
          }}
          onBlur={() => setText(value)}
          className="w-24 h-9 px-2 text-xs font-mono rounded-md border border-black/10"
          aria-label={`${label} (hex)`}
        />
      </div>
    </div>
  );
}

/**
 * Where a brand kit is kept: the signed-in person's (the default), or a
 * team's (the team page passes one). `readOnly`: shown but can't be changed.
 */
export type BrandKitSource = {
  load: () => Promise<BrandKit>;
  save: (kit: BrandKit) => Promise<void>;
  /** Where a new logo is uploaded (the user's folder when left out). */
  folder?: string;
  readOnly?: boolean;
  /** Said under "Brand kit saved". */
  savedNote?: string;
};

const PERSONAL_KIT: BrandKitSource = {
  load: loadBrandKit,
  save: saveBrandKit,
  savedNote: "Your previews and next exports use it.",
};

export function BrandKitSettings({ source = PERSONAL_KIT }: { source?: BrandKitSource } = {}) {
  useBrandFonts();
  const qc = useQueryClient();
  const sign = useServerFn(getClipSignedUrl);
  const [saved, setSaved] = useState<BrandKit | null>(null);
  const [kit, setKit] = useState<BrandKit>(DEFAULT_KIT);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "logo" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const readOnly = !!source.readOnly;

  useEffect(() => {
    void source.load().then((k) => {
      setSaved(k);
      setKit(k);
    });
  }, [source]);
  // A link to the current logo, for the preview.
  useEffect(() => {
    if (!kit.logo) {
      setLogoUrl(null);
      return;
    }
    let live = true;
    sign({ data: { path: kit.logo.path } })
      .then((r) => live && setLogoUrl(r.url))
      .catch(() => live && setLogoUrl(null));
    return () => {
      live = false;
    };
    // Only a new file needs a new link (not a new size or corner).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.logo?.path, sign]);

  const set = (patch: Partial<BrandKit>) => setKit((k) => ({ ...k, ...patch }));
  const changed = useMemo(() => JSON.stringify(kit) !== JSON.stringify(saved), [kit, saved]);

  async function save() {
    setBusy("save");
    try {
      await source.save(kit);
      // An old logo replaced or removed: its file goes.
      if (saved?.logo && saved.logo.path !== kit.logo?.path) await removeLogoFile(saved.logo.path);
      setSaved(parseBrandKit(kit));
      void qc.invalidateQueries({ queryKey: ["brand-kit"] });
      toast.success("Brand kit saved", { description: source.savedNote });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the brand kit");
    } finally {
      setBusy(null);
    }
  }

  async function pickLogo(file: File) {
    setBusy("logo");
    try {
      const path = await uploadLogo(file, source.folder);
      // A logo uploaded but not saved yet replaces any other unsaved one.
      if (kit.logo && kit.logo.path !== saved?.logo?.path) await removeLogoFile(kit.logo.path);
      set({
        logo: {
          path,
          corner: kit.logo?.corner ?? "br",
          width: kit.logo?.width ?? 0.14,
          opacity: kit.logo?.opacity ?? 0.85,
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the logo");
    } finally {
      setBusy(null);
    }
  }

  if (!saved) return <div className="text-sm text-neutral-500 py-3">Loading…</div>;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
      {/* A fieldset turns every control off at once for read-only kits. */}
      <fieldset disabled={readOnly} className="space-y-5 min-w-0 disabled:opacity-70">
        <div className="space-y-1.5">
          <Label className="text-xs">Caption font</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => set({ font: f.id })}
                aria-pressed={kit.font === f.id}
                className={cn(
                  "h-10 rounded-md border text-[15px] px-2 truncate",
                  kit.font === f.id
                    ? "border-violet-500 bg-violet-50 text-violet-900"
                    : "border-black/10 hover:bg-neutral-50",
                )}
                style={{
                  fontFamily: fontCss(f.id) || undefined,
                  fontWeight: f.id === "default" ? 800 : undefined,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ColorField label="Text" value={kit.textColor} onChange={(v) => set({ textColor: v })} />
          <ColorField
            label="Spoken word"
            value={kit.highlightColor}
            onChange={(v) => set({ highlightColor: v })}
          />
          <ColorField
            label="Outline"
            value={kit.outlineColor}
            onChange={(v) => set({ outlineColor: v })}
          />
          <ColorField
            label="Hook box"
            value={kit.hookBoxColor}
            onChange={(v) => set({ hookBoxColor: v })}
          />
        </div>

        <div className="flex flex-wrap gap-5">
          <div className="space-y-1.5">
            <Label className="text-xs block">Caption size</Label>
            <Choice
              label="Caption size"
              value={kit.size}
              onChange={(size) => set({ size })}
              options={[
                { id: "s", label: "Small" },
                { id: "m", label: "Medium" },
                { id: "l", label: "Large" },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs block">Caption position</Label>
            <Choice
              label="Caption position"
              value={kit.position}
              onChange={(position) => set({ position })}
              options={[
                { id: "top", label: "Top" },
                { id: "middle", label: "Middle" },
                { id: "bottom", label: "Lower third" },
              ]}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs block">Logo</Label>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pickLogo(f);
            }}
          />
          {kit.logo ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-14 h-14 rounded-md border border-black/10 bg-[conic-gradient(#eee_0_25%,#fff_0_50%,#eee_0_75%,#fff_0)] bg-[length:12px_12px] grid place-items-center overflow-hidden">
                  {logoUrl && (
                    <img src={logoUrl} alt="Your logo" className="max-w-full max-h-full" />
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy === "logo"}
                >
                  {busy === "logo" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Replace"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => set({ logo: null })}>
                  <Trash2 className="w-4 h-4" /> Remove
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-5">
                <div className="space-y-1.5">
                  <Label className="text-xs block">Corner</Label>
                  <Choice
                    label="Logo corner"
                    value={kit.logo.corner}
                    onChange={(corner) => set({ logo: { ...kit.logo!, corner } })}
                    options={[
                      { id: "tl", label: "↖" },
                      { id: "tr", label: "↗" },
                      { id: "bl", label: "↙" },
                      { id: "br", label: "↘" },
                    ]}
                  />
                </div>
                <div className="space-y-1.5 w-40">
                  <Label className="text-xs block">
                    Size · {Math.round(kit.logo.width * 100)}% of the width
                  </Label>
                  <Slider
                    min={LOGO_WIDTH.min * 100}
                    max={LOGO_WIDTH.max * 100}
                    step={1}
                    value={[kit.logo.width * 100]}
                    onValueChange={([v]) => set({ logo: { ...kit.logo!, width: v / 100 } })}
                    aria-label="Logo size"
                  />
                </div>
                <div className="space-y-1.5 w-40">
                  <Label className="text-xs block">
                    Opacity · {Math.round(kit.logo.opacity * 100)}%
                  </Label>
                  <Slider
                    min={20}
                    max={100}
                    step={5}
                    value={[kit.logo.opacity * 100]}
                    onValueChange={([v]) => set({ logo: { ...kit.logo!, opacity: v / 100 } })}
                    aria-label="Logo opacity"
                  />
                </div>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={busy === "logo"}
            >
              {busy === "logo" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4" />
              )}
              Upload a logo
            </Button>
          )}
          <p className="text-[11px] text-neutral-500">
            PNG with a transparent background works best. Shown on every export; browser exports get
            the logo too (they don&apos;t include captions).
          </p>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2 pt-2 border-t border-black/5">
            <Button type="button" onClick={() => void save()} disabled={!changed || busy !== null}>
              {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save brand kit"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setKit({ ...DEFAULT_KIT, logo: kit.logo })}
            >
              <RotateCcw className="w-4 h-4" /> Standard look
            </Button>
            {changed && <span className="text-xs text-neutral-500">Unsaved changes</span>}
          </div>
        )}
      </fieldset>

      {/* Live preview: drawn like the editor's preview. */}
      <div className="space-y-1.5">
        <div className="text-xs text-neutral-500">Preview</div>
        <div className="relative w-full max-w-[220px] aspect-[9/16] rounded-lg overflow-hidden bg-gradient-to-br from-slate-500 via-slate-700 to-slate-900">
          <PreviewOverlay
            timeMs={SAMPLE_AT_MS}
            phrases={SAMPLE}
            hook="This changed everything"
            kit={kit}
            logoUrl={logoUrl}
          />
        </div>
      </div>
    </div>
  );
}
