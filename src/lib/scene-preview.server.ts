// Makes a story picture's small preview copy (see scene-preview.ts): the
// picture shrunk to at most PREVIEW_LONG_SIDE on its long side and saved as
// a JPEG. Plain JavaScript (pngjs, jpeg-js), so it runs wherever the server
// does. PNG and JPEG pictures only; others (WebP) keep showing in full.

import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { SCENE_BUCKET } from "@/lib/motion-plan";
import { hasPreview, previewPathOf } from "@/lib/scene-preview";

/** The copy's long side (px): sharp on a phone-sized preview, a fraction of the bytes. */
const PREVIEW_LONG_SIDE = 1280;
const PREVIEW_QUALITY = 78;

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Rgba = { width: number; height: number; data: Uint8Array };

function decode(data: Uint8Array): Rgba | null {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
    return { width: img.width, height: img.height, data: img.data };
  }
  return null;
}

/** Shrinks by averaging each output pixel's area (a box filter); alpha goes onto black. */
function shrink(src: Rgba, longSide: number): Rgba {
  const scale = Math.min(1, longSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * src.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * src.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * src.width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          const a = src.data[i + 3] / 255;
          r += src.data[i] * a;
          g += src.data[i + 1] * a;
          b += src.data[i + 2] * a;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** The picture as a small JPEG, or null when it can't be read (WebP, damaged). */
export function makePreviewJpeg(data: Uint8Array): Uint8Array | null {
  const img = decode(data);
  if (!img) return null;
  const small = shrink(img, PREVIEW_LONG_SIDE);
  return new Uint8Array(jpeg.encode(small, PREVIEW_QUALITY).data);
}

/** Stores a picture's preview copy from its bytes; false when none could be made. */
export async function storePreview(admin: Admin, path: string, data: Uint8Array) {
  if (!hasPreview(path)) return false;
  const small = makePreviewJpeg(data);
  if (!small) return false;
  const { error } = await admin.storage
    .from(SCENE_BUCKET)
    .upload(previewPathOf(path), small, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  return true;
}

/** Pictures being given a copy now (one at a time each, per server). */
const making = new Set<string>();

/**
 * Gives an older picture its preview copy, in the background: downloads it,
 * shrinks it and stores the copy. The next links asked for include it.
 */
export function makePreviewLater(admin: Admin, path: string) {
  if (making.has(path) || !hasPreview(path)) return;
  making.add(path);
  void (async () => {
    try {
      const { data: blob } = await admin.storage.from(SCENE_BUCKET).download(path);
      if (!blob) return;
      await storePreview(admin, path, new Uint8Array(await blob.arrayBuffer()));
    } catch (e) {
      console.warn("[scene-preview] Couldn't make a preview copy:", path, e);
    } finally {
      making.delete(path);
    }
  })();
}
