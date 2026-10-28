// The Motion Explainer look: one colour family per video, split 60/30/10
// (docs/style-research/t1-complete-guide.md): a dark main colour for
// backgrounds and cards, a lighter secondary for panels and lines, and a
// vibrant accent for key words, numbers and glows. Built from one accent
// colour (the brand kit's highlight colour until stage 5 reads the footage).

export type MotionTheme = {
  /** ~60%: backgrounds, card fills. */
  main: string;
  /** ~30%: panels, borders, secondary text. */
  secondary: string;
  /** ~10%: key words, numbers, glows. */
  accent: string;
  /** The accent, see-through, for glows. */
  glow: string;
  text: string;
  muted: string;
};

/** Font families the graphics use (see MOTION_FONTS). */
export const SANS = "'SM Inter', 'Inter', system-ui, sans-serif";
export const SERIF = "'SM Instrument Serif', 'Instrument Serif', Georgia, serif";

/** Font files under the fonts folder (public/fonts, render-worker/fonts). */
export const MOTION_FONTS = [
  { family: "SM Inter", file: "Inter-Variable.ttf", style: "normal", weight: "100 900" },
  {
    family: "SM Instrument Serif",
    file: "InstrumentSerif-Regular.ttf",
    style: "normal",
    weight: "400",
  },
  {
    family: "SM Instrument Serif",
    file: "InstrumentSerif-Italic.ttf",
    style: "italic",
    weight: "400",
  },
] as const;

const HEX = /^#([0-9a-f]{6})$/i;

function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`;

/** The 60/30/10 colours from one accent colour (#RRGGBB; anything else: a blue-violet). */
export function themeFromAccent(accentHex: string | null | undefined): MotionTheme {
  const [h, s] = HEX.test(accentHex ?? "") ? toHsl(accentHex!) : [250, 0.85, 0.65];
  // A grey accent still gets a faint tint so the cards aren't flat.
  const sat = Math.max(s, 0.12);
  return {
    main: hsl(h, sat * 0.45, 0.08),
    secondary: hsl(h, sat * 0.4, 0.2),
    // Light enough to read as text on the dark cards.
    accent: hsl(h, Math.max(sat, 0.7), 0.72),
    glow: hsl(h, Math.max(sat, 0.7), 0.62, 0.45),
    text: "#F5F5F7",
    muted: "rgba(245, 245, 247, 0.62)",
  };
}
