// The video's colour LUT: the look's own colour, or one of the ready-made
// LUTs (src/motion/lut-packs.ts) at a strength. The automatic edit may have
// picked one; the creator can change it here. The preview shows a rough
// version of a LUT; the export uses the real one.

import { useMemo, useState } from "react";
import { Palette } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { PACK_LUTS, packLut, type PackLut } from "@/motion/lut-packs";

export type LutControls = {
  /** The pick, or null for the look's own colour. */
  lut: { id: string; strength: number; by?: "ai" | "you" } | null;
  canEdit: boolean;
  onPick: (lut: { id: string; strength: number } | null) => void;
};

/** Sample colours for a LUT's swatch: shadow, skin, sky, foliage, highlight. */
const SAMPLES: [number, number, number][] = [
  [0.12, 0.12, 0.13],
  [0.78, 0.55, 0.43],
  [0.33, 0.55, 0.82],
  [0.3, 0.55, 0.28],
  [0.9, 0.9, 0.88],
];

function roughColour(l: PackLut, [r, g, b]: [number, number, number]): string {
  const curve = (c: number[], x: number) => {
    const p = x * (c.length - 1);
    const i = Math.min(Math.floor(p), c.length - 2);
    return c[i] + (c[i + 1] - c[i]) * (p - i);
  };
  const { curves, saturation } = l.preview;
  const out = [curve(curves.r, r), curve(curves.g, g), curve(curves.b, b)];
  const y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  const [R, G, B] = out.map((v) =>
    Math.round(Math.min(1, Math.max(0, y + (v - y) * saturation)) * 255),
  );
  return `rgb(${R},${G},${B})`;
}

function Swatch({ colours }: { colours: string[] }) {
  return (
    <div className="flex h-2.5 overflow-hidden rounded-sm">
      {colours.map((c, i) => (
        <span key={i} className="flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

export function LutRow({ lut }: { lut: LutControls }) {
  // The slider moves freely; the plan changes when it's let go.
  const [draft, setDraft] = useState<number | null>(null);
  const packs = useMemo(() => [...new Set(PACK_LUTS.map((l) => l.pack))], []);
  const current = lut.lut && packLut(lut.lut.id) ? lut.lut : null;
  const pick = (id: string | null) =>
    lut.onPick(id ? { id, strength: current?.strength ?? 1 } : null);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Palette className="w-3 h-3 text-violet-300" />
        <span className="text-[11px] text-neutral-300 flex-1">Colour (LUT)</span>
        {current?.by === "ai" && <span className="text-[9px] text-neutral-500">Picked by AI</span>}
      </div>

      <button
        type="button"
        disabled={!lut.canEdit}
        onClick={() => pick(null)}
        className={cn(
          "w-full rounded-md border px-2 py-1.5 text-left disabled:opacity-60",
          !current
            ? "border-violet-400/60 bg-violet-500/15"
            : "border-white/10 hover:border-white/25",
        )}
      >
        <div className="text-[11px] font-medium text-neutral-100">Look's own</div>
      </button>

      {packs.map((pack) => (
        <div key={pack} className="space-y-1">
          <div className="text-[9px] uppercase tracking-wide text-neutral-500">{pack}</div>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={`${pack} LUTs`}>
            {PACK_LUTS.filter((l) => l.pack === pack).map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={current?.id === l.id}
                disabled={!lut.canEdit}
                onClick={() => pick(l.id)}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-left space-y-1 disabled:opacity-60",
                  current?.id === l.id
                    ? "border-violet-400/60 bg-violet-500/15"
                    : "border-white/10 hover:border-white/25",
                )}
              >
                <div className="text-[11px] font-medium text-neutral-100 truncate">{l.name}</div>
                <Swatch colours={SAMPLES.map((s) => roughColour(l, s))} />
              </button>
            ))}
          </div>
        </div>
      ))}

      {current && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-[10px] text-neutral-400">
            <span>Strength</span>
            <span className="tabular-nums">{Math.round((draft ?? current.strength) * 100)}%</span>
          </div>
          <Slider
            value={[Math.round((draft ?? current.strength) * 100)]}
            max={100}
            step={5}
            disabled={!lut.canEdit}
            onValueChange={([v]) => setDraft(v / 100)}
            onValueCommit={([v]) => {
              setDraft(null);
              lut.onPick({ id: current.id, strength: v / 100 });
            }}
            aria-label="LUT strength"
          />
        </div>
      )}
    </div>
  );
}
