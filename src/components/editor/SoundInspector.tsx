// The right-hand panel for a selected Motion Explainer sound: what it is,
// when it plays, which graphic it belongs to; put it back where it was, jump
// to it, or delete it.

import { Crosshair, RotateCcw, Trash2, X } from "lucide-react";
import { SOUND_LABEL, type SoundKind } from "@/motion/sounds";

const fmt = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
};

const HINT: Record<SoundKind, string> = {
  "whoosh-light": "Air moving: plays as a graphic or zoom comes in.",
  "whoosh-deep": "A bigger whoosh for large things arriving.",
  click: "A light tick for list items and clicks.",
  pop: "A soft pop as words or labels appear.",
  "ui-blip": "Two quick tones for cards and numbers.",
  glitch: "A short stutter as a chapter title types in.",
  riser: "Builds up into a chapter.",
  hit: "The impact where a chapter lands.",
};

export function SoundInspector({
  kind,
  atMs,
  graphicLabel,
  movedMs,
  readOnly,
  onReset,
  onDelete,
  onSeek,
  onClose,
}: {
  kind: SoundKind;
  atMs: number;
  /** What the graphic it belongs to says. */
  graphicLabel: string;
  /** How far it was moved by hand (0: where it was planned). */
  movedMs: number;
  readOnly: boolean;
  onReset: () => void;
  onDelete: () => void;
  onSeek: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-9 border-b border-white/[0.06] flex items-center gap-2 px-3 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5 text-sky-200 border-sky-300/40 bg-sky-400/15">
          {SOUND_LABEL[kind]}
        </span>
        <span className="text-[11px] font-mono text-neutral-500">{fmt(atMs)}</span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="ml-auto w-6 h-6 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <p className="text-[11px] text-neutral-500 leading-snug">{HINT[kind]}</p>
        <p className="text-[11px] text-neutral-300 leading-snug">
          With the graphic: <span className="text-neutral-100">{graphicLabel || "—"}</span>
        </p>
        {movedMs !== 0 && (
          <p className="text-[11px] text-amber-200">
            Moved {movedMs > 0 ? "later" : "earlier"} by {(Math.abs(movedMs) / 1000).toFixed(2)} s.
          </p>
        )}
        {!readOnly && (
          <p className="text-[10px] text-neutral-500">Drag it on the Sounds track to move it.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={onSeek}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-neutral-200 bg-white/[0.06] hover:bg-white/[0.1]"
          >
            <Crosshair className="w-3 h-3" /> Jump to it
          </button>
          {!readOnly && movedMs !== 0 && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-neutral-200 bg-white/[0.06] hover:bg-white/[0.1]"
            >
              <RotateCcw className="w-3 h-3" /> Put it back
            </button>
          )}
          {!readOnly && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-red-300 bg-red-500/10 hover:bg-red-500/20 ml-auto"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
