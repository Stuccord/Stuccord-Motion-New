// The Sounds track's marks: the Motion Explainer sounds on the timeline.
// Click one to select it; drag it to move it.

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type { SoundKind } from "@/motion/sounds";

export type SoundItem = {
  id: string;
  kind: SoundKind;
  label: string;
  atMs: number;
  lengthMs: number;
};

export type SoundsTrackData = {
  items: SoundItem[];
  /** Off: no automatic sounds. */
  enabled: boolean;
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onToggle?: () => void;
  /** Moved: play at this time (ms). */
  onMove?: (id: string, atMs: number) => void;
};

const TINT: Record<SoundKind, string> = {
  "whoosh-light": "bg-sky-400/25 border-sky-300/50",
  "whoosh-deep": "bg-indigo-400/25 border-indigo-300/50",
  click: "bg-neutral-300/20 border-neutral-200/40",
  pop: "bg-teal-400/25 border-teal-300/50",
  "ui-blip": "bg-cyan-400/25 border-cyan-300/50",
  glitch: "bg-fuchsia-400/25 border-fuchsia-300/50",
  riser: "bg-amber-400/20 border-amber-300/50",
  hit: "bg-red-400/25 border-red-300/50",
};

const CLICK_PX = 3;

export function SoundBlocks({ data, pxPerSec }: { data: SoundsTrackData; pxPerSec: number }) {
  const [drag, setDrag] = useState<{ id: string; x0: number; dx: number } | null>(null);
  const toPx = (ms: number) => (ms / 1000) * pxPerSec;

  return (
    <>
      {data.items.map((item) => {
        const d = drag?.id === item.id ? drag : null;
        const selected = data.selectedId === item.id;
        return (
          <div
            key={item.id}
            data-timeline-clip
            data-sound-id={item.id}
            role="button"
            aria-label={`Sound: ${item.label}`}
            aria-pressed={selected}
            title={item.label}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              data.onSelect(item.id);
              if (!data.canEdit) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ id: item.id, x0: e.clientX, dx: 0 });
            }}
            onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0 })}
            onPointerUp={() => {
              if (!drag || drag.id !== item.id) return;
              const moved = drag.dx;
              setDrag(null);
              if (Math.abs(moved) >= CLICK_PX) {
                data.onMove?.(item.id, Math.max(0, item.atMs + (moved / pxPerSec) * 1000));
              }
            }}
            onPointerCancel={() => setDrag(null)}
            onDragStart={(e) => e.preventDefault()}
            className={cn(
              "absolute top-2 bottom-2 rounded-sm border select-none",
              TINT[item.kind],
              data.canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              selected && "ring-2 ring-white/80 z-10",
              d && "z-20",
            )}
            style={{
              left: toPx(item.atMs) + (d?.dx ?? 0),
              width: Math.max(5, toPx(item.lengthMs)),
            }}
          />
        );
      })}
    </>
  );
}
