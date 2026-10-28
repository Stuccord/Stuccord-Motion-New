// The Graphics track's blocks (Motion Explainer graphics on the timeline).
// Click a block to select it; drag it to move it, or drag its edges to make
// it start or end on another word. The plan snaps it to the nearest words.

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type { ElementType } from "@/lib/motion-plan";
import { GRAPHIC_TINT } from "./graphic-tint";

export type GraphicItem = {
  id: string;
  type: ElementType;
  /** What the block says, e.g. "98% · of people fail". */
  label: string;
  startMs: number;
  endMs: number;
};

export type GraphicsTrackData = {
  items: GraphicItem[];
  /** Off: graphics hidden in the preview and export. */
  enabled: boolean;
  selectedId: string | null;
  /** Can change them (not a team viewer, and there are words to snap to). */
  canEdit: boolean;
  onSelect: (id: string) => void;
  onToggle?: () => void;
  /** Adds a graphic at the playhead. */
  onAdd?: () => void;
  /** Moved: start near this time (ms). */
  onMove?: (id: string, startMs: number) => void;
  /** An edge moved to near this time (ms). */
  onResize?: (id: string, edge: "start" | "end", ms: number) => void;
};

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; dx: number };

/** Pointer movement below this is a click, not a drag (px). */
const CLICK_PX = 3;
/** The grab zone at each end of a block (px). */
const EDGE_PX = 7;

export function GraphicsBlocks({ data, pxPerSec }: { data: GraphicsTrackData; pxPerSec: number }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const toPx = (ms: number) => (ms / 1000) * pxPerSec;
  const toMs = (px: number) => (px / pxPerSec) * 1000;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, item: GraphicItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    data.onSelect(item.id);
    if (!data.canEdit) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const edges = box.width > EDGE_PX * 3;
    const mode = edges && x < EDGE_PX ? "start" : edges && x > box.width - EDGE_PX ? "end" : "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: item.id, mode, x0: e.clientX, dx: 0 });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag({ ...drag, dx: e.clientX - drag.x0 });
  };
  const onPointerUp = (item: GraphicItem) => {
    if (!drag || drag.id !== item.id) return;
    const d = drag;
    setDrag(null);
    if (Math.abs(d.dx) < CLICK_PX) return;
    const shift = toMs(d.dx);
    if (d.mode === "move") data.onMove?.(item.id, item.startMs + shift);
    else if (d.mode === "start") data.onResize?.(item.id, "start", item.startMs + shift);
    else data.onResize?.(item.id, "end", item.endMs + shift);
  };

  return (
    <>
      {data.items.map((item) => {
        const d = drag?.id === item.id ? drag : null;
        let left = toPx(item.startMs);
        let width = toPx(item.endMs - item.startMs);
        if (d?.mode === "move") left += d.dx;
        if (d?.mode === "start") {
          left += Math.min(d.dx, width - 4);
          width -= Math.min(d.dx, width - 4);
        }
        if (d?.mode === "end") width = Math.max(4, width + d.dx);
        const selected = data.selectedId === item.id;
        return (
          <div
            key={item.id}
            data-timeline-clip
            data-graphic-id={item.id}
            role="button"
            aria-label={`Graphic: ${item.label}`}
            aria-pressed={selected}
            title={item.label}
            onPointerDown={(e) => onPointerDown(e, item)}
            onPointerMove={onPointerMove}
            onPointerUp={() => onPointerUp(item)}
            onPointerCancel={() => setDrag(null)}
            onDragStart={(e) => e.preventDefault()}
            className={cn(
              "absolute top-1 bottom-1 rounded px-1.5 flex items-center text-[11px] leading-none border select-none",
              GRAPHIC_TINT[item.type],
              data.canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              selected && "ring-2 ring-white/80 z-10",
              d && "z-20 shadow-lg",
            )}
            style={{ left, width: Math.max(4, width - 1) }}
          >
            {data.canEdit && width > EDGE_PX * 3 && (
              <>
                <span className="absolute left-0 top-0 bottom-0 w-[5px] cursor-ew-resize rounded-l bg-white/0 hover:bg-white/30" />
                <span className="absolute right-0 top-0 bottom-0 w-[5px] cursor-ew-resize rounded-r bg-white/0 hover:bg-white/30" />
              </>
            )}
            <span className="truncate pointer-events-none">{item.label}</span>
          </div>
        );
      })}
    </>
  );
}
