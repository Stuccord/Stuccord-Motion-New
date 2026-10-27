// The box with handles over the live preview, like CapCut's player: press a
// clip to select it, drag it to move it, drag a corner to resize it, drag
// the round arrow to rotate it. Snaps to the frame's centre lines and edges
// (and rotation to 0/90/180/270°); hold Alt to move freely, Shift to rotate
// in 15° steps.

import React, { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  cleanTransform,
  IDENTITY_TRANSFORM,
  normalizeRotation,
  transformedBox,
  type ClipTransform,
} from "@/lib/clip-transform";

/** A clip on screen at the playhead, top-most first. */
export type BoxTarget = {
  id: string;
  /** The clip's own size (px), when it's known. */
  srcW: number;
  srcH: number;
  transform: ClipTransform | null;
  /** Whether it covers the whole frame (an untransformed clip shown over its blurred copy). */
  fillsFrame: boolean;
};

const SNAP_PX = 6;
const ROTATE_SNAP_DEG = 5;

type Guides = { x: number[]; y: number[]; angle?: number };

/** The rotated box's extent from its centre along each axis (px). */
function halfExtent(w: number, h: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { hx: (w * c + h * s) / 2, hy: (w * s + h * c) / 2 };
}

/** Whether point (px, py) is inside a box centred at (cx, cy), rotated by `deg`. */
function insideBox(px: number, py: number, b: ReturnType<typeof transformedBox>) {
  const r = (-b.rotation * Math.PI) / 180;
  const dx = px - b.cx;
  const dy = py - b.cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

export function TransformBox({
  targets,
  selectedId,
  enabled,
  onSelect,
  onDraft,
  onCommit,
}: {
  /** Clips showing at the playhead, top-most first. */
  targets: BoxTarget[];
  selectedId: string | null;
  /** Off while playing: the box hides and presses go through. */
  enabled: boolean;
  onSelect: (id: string) => void;
  /** While dragging: the transform to show (not saved yet). */
  onDraft: (id: string, t: ClipTransform) => void;
  /** Released: the transform to save (null: back to the default fit). */
  onCommit: (id: string, t: ClipTransform | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<Guides | null>(null);
  // The frame's size (CSS px), kept up to date as the monitor resizes or zooms.
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The frame now: its size (CSS px), where it is on screen, and screen px
  // per CSS px (k), for turning pointer positions into frame positions.
  const measure = () => {
    const el = root.current;
    const r = el?.getBoundingClientRect();
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    return { w, h, left: r?.left ?? 0, top: r?.top ?? 0, k: w > 0 && r ? r.width / w : 1 };
  };
  const boxOf = (t: BoxTarget, fw: number, fh: number) =>
    transformedBox(t.srcW, t.srcH, fw, fh, t.transform);

  /** Follows the pointer until it's released, then saves what changed. */
  const drag = (
    e: React.PointerEvent,
    target: BoxTarget,
    update: (ev: PointerEvent, f: ReturnType<typeof measure>) => { t: ClipTransform; g: Guides },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const f = measure();
    let latest: ClipTransform | null = null;
    // A press only selects; the clip changes once the pointer has really
    // moved, so a shaky click doesn't nudge or resize it.
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        started = true;
      }
      const { t, g } = update(ev, f);
      latest = cleanTransform(t);
      setGuides(g);
      onDraft(target.id, latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuides(null);
      const before = target.transform ?? IDENTITY_TRANSFORM;
      if (!latest) return;
      const changed = (["x", "y", "scale", "rotation"] as const).some(
        (k) => latest![k] !== before[k],
      );
      if (changed) {
        const t = latest as ClipTransform;
        const identity = t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation === 0;
        onCommit(target.id, identity ? null : t);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const startMove = (e: React.PointerEvent, target: BoxTarget) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const t0 = target.transform ?? IDENTITY_TRANSFORM;
    drag(e, target, (ev, f) => {
      const b = boxOf(target, f.w, f.h);
      let cx = b.cx + (ev.clientX - startX) / f.k;
      let cy = b.cy + (ev.clientY - startY) / f.k;
      const g: Guides = { x: [], y: [] };
      if (!ev.altKey) {
        const { hx, hy } = halfExtent(b.w, b.h, b.rotation);
        // The centre to the frame's centre, or an edge to the frame's edge.
        const snap = (c: number, half: number, size: number, out: number[]) => {
          const options = [
            { at: size / 2, c: size / 2 },
            { at: 0, c: half },
            { at: size, c: size - half },
          ];
          let best: { at: number; c: number } | null = null;
          for (const o of options) {
            if (Math.abs(c - o.c) <= SNAP_PX && (!best || Math.abs(c - o.c) < Math.abs(c - best.c)))
              best = o;
          }
          if (!best) return c;
          out.push(best.at);
          return best.c;
        };
        cx = snap(cx, hx, f.w, g.x);
        cy = snap(cy, hy, f.h, g.y);
      }
      return { t: { ...t0, x: (cx - f.w / 2) / f.w, y: (cy - f.h / 2) / f.h }, g };
    });
  };

  const startScale = (e: React.PointerEvent, target: BoxTarget) => {
    const t0 = target.transform ?? IDENTITY_TRANSFORM;
    drag(e, target, (ev, f) => {
      const b = boxOf(target, f.w, f.h);
      const cx = f.left + b.cx * f.k;
      const cy = f.top + b.cy * f.k;
      const startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
      const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      let scale = (t0.scale * dist) / startDist;
      // Back to the default size snaps.
      if (!ev.altKey && Math.abs(scale - 1) < 0.03) scale = 1;
      return { t: { ...t0, scale }, g: { x: [], y: [] } };
    });
  };

  const startRotate = (e: React.PointerEvent, target: BoxTarget) => {
    const t0 = target.transform ?? IDENTITY_TRANSFORM;
    drag(e, target, (ev, f) => {
      const b = boxOf(target, f.w, f.h);
      const cx = f.left + b.cx * f.k;
      const cy = f.top + b.cy * f.k;
      const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
      const a1 = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let rotation = normalizeRotation(t0.rotation + ((a1 - a0) * 180) / Math.PI);
      if (ev.shiftKey) rotation = Math.round(rotation / 15) * 15;
      else if (!ev.altKey) {
        const right = Math.round(rotation / 90) * 90;
        if (Math.abs(rotation - right) <= ROTATE_SNAP_DEG) rotation = right;
      }
      rotation = normalizeRotation(rotation);
      return { t: { ...t0, rotation }, g: { x: [], y: [], angle: rotation } };
    });
  };

  // A press on the picture selects the top-most clip under it and starts moving it.
  const onPress = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return;
    const f = measure();
    const px = (e.clientX - f.left) / f.k;
    const py = (e.clientY - f.top) / f.k;
    const hit = targets.find((t) => t.fillsFrame || insideBox(px, py, boxOf(t, f.w, f.h)));
    if (!hit) return;
    if (hit.id !== selectedId) onSelect(hit.id);
    startMove(e, hit);
  };

  const selected = enabled ? targets.find((t) => t.id === selectedId) : undefined;
  const fw = frame.w;
  const fh = frame.h;
  const box = selected && fw > 0 ? boxOf(selected, fw, fh) : null;
  // The rotate button: just under the box (turning with it), kept inside the
  // frame so it can always be reached, even when the clip is bigger than it.
  const rotateAt = (() => {
    if (!box) return null;
    const r = (box.rotation * Math.PI) / 180;
    const d = box.h / 2 + 22;
    const m = 14;
    return {
      x: Math.min(fw - m, Math.max(m, box.cx - Math.sin(r) * d)),
      y: Math.min(fh - m, Math.max(m, box.cy + Math.cos(r) * d)),
    };
  })();

  return (
    <div
      ref={root}
      className="absolute inset-0 z-20"
      style={{ pointerEvents: enabled ? "auto" : "none", cursor: enabled ? "default" : undefined }}
      onPointerDown={onPress}
    >
      {/* Snap guides */}
      {guides?.x.map((x) => (
        <div
          key={`x${x}`}
          className="absolute top-0 bottom-0 w-px bg-pink-400 pointer-events-none"
          style={{ left: x }}
        />
      ))}
      {guides?.y.map((y) => (
        <div
          key={`y${y}`}
          className="absolute left-0 right-0 h-px bg-pink-400 pointer-events-none"
          style={{ top: y }}
        />
      ))}
      {box && selected && (
        <div
          className="absolute border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] cursor-move"
          style={{
            left: box.cx - box.w / 2,
            top: box.cy - box.h / 2,
            width: box.w,
            height: box.h,
            transform: `rotate(${box.rotation}deg)`,
          }}
          onPointerDown={(e) => startMove(e, selected)}
          title="Drag to move · Alt: no snapping"
        >
          {(
            [
              ["-left-[11px] -top-[11px]", "nwse-resize"],
              ["-right-[11px] -top-[11px]", "nesw-resize"],
              ["-left-[11px] -bottom-[11px]", "nesw-resize"],
              ["-right-[11px] -bottom-[11px]", "nwse-resize"],
            ] as const
          ).map(([pos, cursor]) => (
            // A 22px grab area around a 12px dot.
            <div
              key={pos}
              className={`absolute ${pos} w-[22px] h-[22px] grid place-items-center`}
              style={{ cursor }}
              onPointerDown={(e) => startScale(e, selected)}
              title="Drag to resize"
            >
              <span className="w-3 h-3 rounded-full bg-white shadow ring-1 ring-black/30" />
            </div>
          ))}
          {guides?.angle !== undefined && (
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-mono text-white pointer-events-none">
              {Math.round(guides.angle)}°
            </span>
          )}
        </div>
      )}
      {rotateAt && selected && (
        <button
          type="button"
          aria-label="Rotate"
          title="Drag to rotate · Shift: 15° steps"
          className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white text-black grid place-items-center shadow ring-1 ring-black/30 cursor-grab"
          style={{ left: rotateAt.x, top: rotateAt.y }}
          onPointerDown={(e) => startRotate(e, selected)}
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
