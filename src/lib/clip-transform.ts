// Where a clip sits in the frame after it's been moved, resized or rotated
// in the preview (saved as clips.transform). Mirrored in the cloud export
// (render-worker/server.js: transformedFitFilter) and the browser export
// (src/lib/client-render.ts).
//
// A clip's default fit: one the frame's shape fills the frame (cropped a
// little); any other shape is shown whole, as large as fits. The transform
// is applied to that box: scaled around its centre, rotated, then moved.

/** x, y: the box's centre from the frame's centre, as a share of the frame's
 *  width and height. scale: size compared with the default fit. rotation:
 *  degrees, clockwise. */
export type ClipTransform = { x: number; y: number; scale: number; rotation: number };

export const IDENTITY_TRANSFORM: ClipTransform = { x: 0, y: 0, scale: 1, rotation: 0 };

export const TRANSFORM_LIMITS = {
  /** How far the centre may go past the frame's middle (shares of the frame). */
  offset: 1.5,
  minScale: 0.05,
  maxScale: 4,
} as const;

// Shapes this close count as the same (as in the preview's fit and the export).
const SAME_SHAPE = 0.03;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** -180..180, so 270° is saved as -90°. */
export function normalizeRotation(deg: number) {
  const r = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

/** A saved transform (any JSON), checked and kept within limits; null for the default fit. */
export function parseTransform(value: unknown): ClipTransform | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const num = (k: string, d: number) => {
    const n = Number(v[k]);
    return Number.isFinite(n) ? n : d;
  };
  const t = cleanTransform({
    x: num("x", 0),
    y: num("y", 0),
    scale: num("scale", 1),
    rotation: num("rotation", 0),
  });
  return isIdentity(t) ? null : t;
}

/** Keeps a transform within limits, rounded to sensible precision. */
export function cleanTransform(t: ClipTransform): ClipTransform {
  const { offset, minScale, maxScale } = TRANSFORM_LIMITS;
  return {
    x: Math.round(clamp(t.x, -offset, offset) * 10000) / 10000,
    y: Math.round(clamp(t.y, -offset, offset) * 10000) / 10000,
    scale: Math.round(clamp(t.scale, minScale, maxScale) * 10000) / 10000,
    rotation: Math.round(normalizeRotation(t.rotation) * 100) / 100,
  };
}

export function isIdentity(t: ClipTransform | null | undefined) {
  return !t || (t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation === 0);
}

/** Whether a clip of this size counts as the frame's shape (fills it by default). */
export function sameShape(srcW: number, srcH: number, frameRatio: number) {
  return srcW > 0 && srcH > 0 && Math.abs(Math.log(srcW / srcH / frameRatio)) < SAME_SHAPE;
}

/** The clip's default box in a frame (px): the frame itself, or the clip whole, centred. */
export function defaultFit(srcW: number, srcH: number, frameW: number, frameH: number) {
  if (!(srcW > 0 && srcH > 0) || sameShape(srcW, srcH, frameW / frameH)) {
    return { w: frameW, h: frameH, cover: true };
  }
  const s = Math.min(frameW / srcW, frameH / srcH);
  return { w: srcW * s, h: srcH * s, cover: false };
}

/** The clip's box in a frame (px, before rotation): centre, width, height. */
export function transformedBox(
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
  t: ClipTransform | null,
) {
  const fit = defaultFit(srcW, srcH, frameW, frameH);
  const tr = t ?? IDENTITY_TRANSFORM;
  return {
    cx: frameW / 2 + tr.x * frameW,
    cy: frameH / 2 + tr.y * frameH,
    w: fit.w * tr.scale,
    h: fit.h * tr.scale,
    rotation: tr.rotation,
    cover: fit.cover,
  };
}
