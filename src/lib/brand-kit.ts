// The account's brand kit: caption font, colours, size and position, the
// hook's look, and a logo watermark. Saved on the account (Supabase auth user
// metadata, "brand_kit"); the logo is a PNG in the user's own storage folder.
// Used by the live preview (PreviewOverlay), the cloud export
// (render-worker/server.js: brandKitFromJob, mirrored) and the browser export
// (logo only; it has no captions).
//
// With no kit saved, everything looks as it always has.

import { supabase } from "@/integrations/supabase/client";

export type FontId = "default" | "poppins" | "lato" | "anton" | "bebas" | "archivo" | "luckiest";
export type CaptionSize = "s" | "m" | "l";
export type CaptionPosition = "bottom" | "middle" | "top";
export type LogoCorner = "tl" | "tr" | "bl" | "br";

export type BrandKit = {
  font: FontId;
  /** Caption text (and hook text). */
  textColor: string;
  /** The word being spoken. */
  highlightColor: string;
  /** The outline around each letter. */
  outlineColor: string;
  size: CaptionSize;
  position: CaptionPosition;
  /** The box behind the hook (shown at 55% opacity). */
  hookBoxColor: string;
  logo: {
    /** In the raw-clips bucket: <user id>/brand/logo-<time>.png */
    path: string;
    corner: LogoCorner;
    /** Width as a share of the video's width. */
    width: number;
    /** 0.2 to 1. */
    opacity: number;
  } | null;
};

/** The look before brand kits (the export's built-in style). */
export const DEFAULT_KIT: BrandKit = {
  font: "default",
  textColor: "#FFFFFF",
  highlightColor: "#FFD700",
  outlineColor: "#000000",
  size: "m",
  position: "bottom",
  hookBoxColor: "#000000",
  logo: null,
};

/** Fonts: the file (public/fonts and render-worker/fonts) and the family name inside it. */
export const FONTS: { id: FontId; label: string; file: string | null; family: string }[] = [
  { id: "default", label: "Standard", file: null, family: "" },
  { id: "poppins", label: "Poppins", file: "Poppins-Bold.ttf", family: "Poppins" },
  { id: "lato", label: "Lato Black", file: "Lato-Black.ttf", family: "Lato Black" },
  { id: "anton", label: "Anton", file: "Anton-Regular.ttf", family: "Anton" },
  { id: "bebas", label: "Bebas Neue", file: "BebasNeue-Regular.ttf", family: "Bebas Neue" },
  {
    id: "archivo",
    label: "Archivo Black",
    file: "ArchivoBlack-Regular.ttf",
    family: "Archivo Black",
  },
  {
    id: "luckiest",
    label: "Luckiest Guy",
    file: "LuckiestGuy-Regular.ttf",
    family: "Luckiest Guy",
  },
];

/** Caption size as a share of the video's shorter side (the export's 7.5% is "m"). */
export const CAPTION_SIZE: Record<CaptionSize, number> = { s: 0.06, m: 0.075, l: 0.09 };

export const LOGO_WIDTH = { min: 0.06, max: 0.3 } as const;

const HEX = /^#[0-9A-Fa-f]{6}$/;
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;
const color = (v: unknown, d: string) =>
  typeof v === "string" && HEX.test(v) ? v.toUpperCase() : d;
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** A saved kit (any JSON) made safe; anything missing falls back to the default. */
export function parseBrandKit(value: unknown): BrandKit {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const logo = v.logo && typeof v.logo === "object" ? (v.logo as Record<string, unknown>) : null;
  return {
    font: pick(
      v.font,
      FONTS.map((f) => f.id),
      DEFAULT_KIT.font,
    ),
    textColor: color(v.textColor, DEFAULT_KIT.textColor),
    highlightColor: color(v.highlightColor, DEFAULT_KIT.highlightColor),
    outlineColor: color(v.outlineColor, DEFAULT_KIT.outlineColor),
    size: pick(v.size, ["s", "m", "l"] as const, DEFAULT_KIT.size),
    position: pick(v.position, ["bottom", "middle", "top"] as const, DEFAULT_KIT.position),
    hookBoxColor: color(v.hookBoxColor, DEFAULT_KIT.hookBoxColor),
    logo:
      logo && typeof logo.path === "string" && logo.path.length > 0
        ? {
            path: logo.path,
            corner: pick(logo.corner, ["tl", "tr", "bl", "br"] as const, "br"),
            width: clamp(logo.width, LOGO_WIDTH.min, LOGO_WIDTH.max, 0.14),
            opacity: clamp(logo.opacity, 0.2, 1, 0.85),
          }
        : null,
  };
}

/** The signed-in user's kit (the default when they haven't saved one). */
export async function loadBrandKit(): Promise<BrandKit> {
  const { data } = await supabase.auth.getUser();
  return parseBrandKit(data.user?.user_metadata?.brand_kit);
}

export async function saveBrandKit(kit: BrandKit) {
  const { error } = await supabase.auth.updateUser({ data: { brand_kit: parseBrandKit(kit) } });
  if (error) throw new Error(error.message);
}

/**
 * Saves a logo picture as a PNG (at most 1024 px wide, transparency kept) in
 * the user's folder and returns its storage path. Any image the browser can
 * open works, SVG included (it's drawn to PNG here).
 */
export async function uploadLogo(file: File): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("You're not signed in");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("That file isn't a picture this browser can open");
    });
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    const s = Math.min(1, 1024 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!png) throw new Error("Couldn't read that picture");
    // A new name each time, so an old cached copy is never shown.
    const path = `${userId}/brand/logo-${Date.now()}.png`;
    const { error } = await supabase.storage
      .from("raw-clips")
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (error) throw new Error(error.message);
    return path;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Removes a logo file that's no longer used (best effort). */
export async function removeLogoFile(path: string) {
  await supabase.storage.from("raw-clips").remove([path]);
}

// ---------- drawing (preview) ----------

let fontsAdded = false;
/** Makes the kit's fonts available to the page (once). */
export function useBrandFonts() {
  if (fontsAdded || typeof document === "undefined") return;
  fontsAdded = true;
  const css = FONTS.filter((f) => f.file)
    .map(
      (f) =>
        `@font-face{font-family:"SM ${f.family}";src:url("/fonts/${f.file}") format("truetype");font-display:swap;}`,
    )
    .join("\n");
  const style = document.createElement("style");
  style.dataset.brandFonts = "";
  style.textContent = css;
  document.head.appendChild(style);
}

/** CSS font family for a kit's font ("" for the standard one). */
export function fontCss(font: FontId): string {
  const f = FONTS.find((x) => x.id === font);
  return f?.file ? `"SM ${f.family}", sans-serif` : "";
}

/** "#RRGGBB" with an alpha, as rgba(). */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
