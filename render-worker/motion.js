// Motion Explainer graphics in the export (stage 3).
//
// The app sends the plan's graphics, each anchored to a clip and a word in
// its transcript, and the colours to draw them in. Here they're placed on
// the final video from where those words landed (the same way captions are),
// drawn with Remotion as see-through clips — only where graphics are on
// screen, which is much faster than drawing every frame — and laid over the
// picture by ffmpeg, together with the zooms.
//
// placeGraphics and the zoom curve mirror src/motion/timing.ts (the
// editor's preview), so the export matches what the editor shows.

import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GRAPHICS_BUNDLE = path.join(here, "graphics-bundle");

export const MOTION_FPS = 30;
const MIN_FRAMES = Math.round(1.2 * MOTION_FPS);
const TAIL_FRAMES = Math.round(0.35 * MOTION_FPS);
export const ZOOM_SCALE = 1.14;
const TYPES = new Set(["keyline", "counter", "list", "card", "compare", "chapter", "label", "cta"]);
const msToFrame = (ms) => Math.round((ms / 1000) * MOTION_FPS);

/**
 * The graphics and zooms on the final video. `words` are the placed words
 * ({ clip_id, word_index, start_ms, end_ms }); a graphic whose first or last
 * word was trimmed away is left out. Bad entries are skipped, not trusted.
 */
export function placeGraphics(elements, words) {
  const byKey = new Map(words.map((w) => [`${w.clip_id}:${w.word_index}`, w]));
  const spans = [];
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || typeof el !== "object") continue;
    const from = byKey.get(`${el.start?.clip_id}:${el.start?.word_index}`);
    const to = byKey.get(`${el.end?.clip_id}:${el.end?.word_index}`);
    if (!from || !to || to.end_ms < from.start_ms) continue;
    spans.push({ el, startMs: from.start_ms, endMs: to.end_ms });
  }
  spans.sort((a, b) => a.startMs - b.startMs);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const chapterCount = spans.filter((s) => s.el.type === "chapter").length;
  let chapterIndex = 0;
  const graphics = [];
  const zooms = [];
  for (const { el, startMs, endMs } of spans) {
    const from = msToFrame(startMs);
    const to = Math.max(from + MIN_FRAMES, msToFrame(endMs) + TAIL_FRAMES);
    const id = str(el.id, 64) || `g${graphics.length + zooms.length}`;
    if (el.type === "zoom") {
      zooms.push({ id, from, to, zoom: el.zoom === "out" ? "out" : "in" });
      continue;
    }
    if (!TYPES.has(el.type)) continue;
    const n = el.number;
    graphics.push({
      id,
      type: el.type,
      from,
      to,
      text: str(el.text, 200),
      emphasis: typeof el.emphasis === "string" ? el.emphasis.slice(0, 60) : null,
      items: (Array.isArray(el.items) ? el.items : [])
        .map((i) => str(i, 80).trim())
        .filter(Boolean)
        .slice(0, 8),
      number:
        n && Number.isFinite(n.value)
          ? { value: n.value, prefix: str(n.prefix, 8), suffix: str(n.suffix, 12) }
          : null,
      cta: ["like", "subscribe", "comment", "link"].includes(el.cta) ? el.cta : null,
      chapter: el.type === "chapter" ? { index: ++chapterIndex, count: chapterCount } : null,
    });
  }
  return { graphics, zooms };
}

/** Frame stretches with graphics on screen, close ones joined (inclusive start, exclusive end). */
export function graphicRanges(graphics, totalFrames, joinGap = 15) {
  const spans = graphics
    .map((g) => [Math.max(0, g.from), Math.min(totalFrames, g.to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + joinGap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Time ranges (ms) where a key line or chapter fills the captions' space. */
export function captionGaps(graphics) {
  return graphics
    .filter((g) => g.type === "keyline" || g.type === "chapter")
    .map((g) => [(g.from / MOTION_FPS) * 1000, (g.to / MOTION_FPS) * 1000]);
}

const num = (n) => Number(n.toFixed(4));

/**
 * An ffmpeg expression for the picture's zoom at input frame `in` (the
 * zoompan filter): the same curves as the preview's zoomAt.
 */
export function zoomExpression(zooms) {
  const K = num(ZOOM_SCALE - 1);
  const eio = (x) => `if(lt(${x},0.5),4*pow(${x},3),1-pow(-2*(${x})+2,3)/2)`;
  let expr = "1";
  for (const z of [...zooms].reverse()) {
    const len = z.to - z.from;
    if (len <= 0) continue;
    const t = `(in-${z.from})`;
    let piece;
    if (z.zoom === "out") {
      piece = `1+${K}*(1-${eio(`clip(${t}/${len},0,1)`)})`;
    } else {
      const inF = num(Math.min(8, len / 3));
      const outF = num(Math.min(10, len / 3));
      piece =
        `if(lt(${t},${inF}),1+${K}*(1-pow(1-${t}/${inF},3)),` +
        `if(gt(${t},${num(len - outF)}),1+${K}*${eio(`clip((${len}-${t})/${outF},0,1)`)},${num(ZOOM_SCALE)}))`;
    }
    expr = `if(between(in,${z.from},${z.to - 1}),${piece},${expr})`;
  }
  return expr;
}

/** The zoompan filter for the zooms (around the upper middle), or null with none. */
export function zoomFilter(zooms, w, h) {
  if (!zooms.length) return null;
  return (
    `zoompan=z='${zoomExpression(zooms)}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*0.4'` +
    `:d=1:s=${w}x${h}:fps=${MOTION_FPS}`
  );
}

/** The graphics are drawn at half the video's rate (they change every other frame). */
export const DRAW_FPS = MOTION_FPS / 2;

/**
 * Draws the graphics with Remotion as see-through ProRes 4444 clips, one per
 * stretch with graphics on screen, at 15 fps. Returns [{ file, startS }]:
 * each clip and where it starts in the video (seconds).
 */
export async function renderGraphics({ graphics, theme, w, h, totalFrames, workdir, onProgress }) {
  const ranges = graphicRanges(graphics, totalFrames);
  if (!ranges.length) return [];
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const inputProps = { graphics, theme, width: w, height: h, durationInFrames: totalFrames };
  const composition = await selectComposition({ serveUrl: GRAPHICS_BUNDLE, id: "graphics", inputProps });
  const totalToDraw = ranges.reduce((s, [a, b]) => s + Math.ceil(b / 2) - Math.floor(a / 2), 0);
  let drawn = 0;
  const pieces = [];
  for (let i = 0; i < ranges.length; i++) {
    // The stretch in drawn (15 fps) frames.
    const a = Math.floor(ranges[i][0] / 2);
    const b = Math.ceil(ranges[i][1] / 2);
    const file = path.join(workdir, `graphics_${i}.mov`);
    await renderMedia({
      composition,
      serveUrl: GRAPHICS_BUNDLE,
      inputProps,
      codec: "prores",
      proResProfile: "4444",
      pixelFormat: "yuva444p10le",
      imageFormat: "png",
      frameRange: [a, b - 1],
      outputLocation: file,
      muted: true,
      concurrency: Math.max(1, Math.min(8, os.cpus().length)),
      logLevel: "warn",
      onProgress: ({ renderedFrames }) => onProgress?.((drawn + renderedFrames) / totalToDraw),
    });
    drawn += b - a;
    pieces.push({ file, startS: a / DRAW_FPS });
  }
  return pieces;
}

/**
 * ffmpeg arguments for the final picture: the zooms, the graphics clips laid
 * over at their times, then the text filters (captions, hook). Audio is
 * copied. `textFilters` is a list of filters (or empty).
 */
export function composeArgs({ input, pieces, zoom, textFilters, output }) {
  const args = ["-y", "-i", input];
  for (const p of pieces) {
    args.push("-itsoffset", p.startS.toFixed(4), "-i", p.file);
  }
  const graph = [];
  let last = "0:v";
  if (zoom) {
    graph.push(`[${last}]${zoom},setsar=1[zm]`);
    last = "zm";
  }
  pieces.forEach((_, i) => {
    graph.push(`[${last}][${i + 1}:v]overlay=0:0:eof_action=pass:format=auto[g${i}]`);
    last = `g${i}`;
  });
  graph.push(`[${last}]${textFilters.length ? textFilters.join(",") + "," : ""}format=yuv420p[vout]`);
  args.push(
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    output,
  );
  return args;
}
