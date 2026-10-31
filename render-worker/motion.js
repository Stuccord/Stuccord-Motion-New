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
import { behindFilters } from "./cutout.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GRAPHICS_BUNDLE = path.join(here, "graphics-bundle");

export const MOTION_FPS = 30;
const MIN_FRAMES = Math.round(1.2 * MOTION_FPS);
const TAIL_FRAMES = Math.round(0.35 * MOTION_FPS);
export const ZOOM_SCALE = 1.14;
const TYPES = new Set(["keyline", "counter", "list", "card", "compare", "story", "chapter", "label", "cta"]);
const MAX_SCENES = 6;
// Types that can go behind the speaker (src/lib/motion-plan.ts BEHIND_TYPES).
const BEHIND_TYPES = new Set(["keyline", "counter", "list", "card", "compare", "chapter"]);
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
      behind: el.behind === true && BEHIND_TYPES.has(el.type),
      scenes: el.type === "story" ? placeScenes(el.scenes, from, to, byKey) : null,
    });
  }
  return { graphics, zooms };
}

/**
 * Where a story's scenes start (frames): at their words when those are in
 * the story and in order, else spread evenly (src/motion/timing.ts).
 */
export function sceneStarts(froms, from, to) {
  const n = froms.length;
  const ok = froms.every((f, i) => f != null && f >= from && f < to && (i === 0 || f > froms[i - 1]));
  if (ok) return froms.map((f, i) => (i === 0 ? from : f));
  return froms.map((_, i) => Math.round(from + ((to - from) * i) / n));
}

function placeScenes(scenes, from, to, byKey) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const list = (Array.isArray(scenes) ? scenes : []).filter((sc) => sc && typeof sc === "object").slice(0, MAX_SCENES);
  const froms = list.map((sc) => {
    const w = byKey.get(`${sc.at?.clip_id}:${sc.at?.word_index}`);
    return w ? msToFrame(w.start_ms) : null;
  });
  const starts = sceneStarts(froms, from, to);
  return list.map((sc, i) => ({
    from: starts[i],
    text: str(sc.text, 80),
    emphasis: typeof sc.emphasis === "string" ? sc.emphasis.slice(0, 60) : null,
    image: typeof sc.image?.path === "string" ? sc.image.path.slice(0, 300) : null,
  }));
}

/**
 * Story pictures' links from the job: storage path -> https link, only
 * well-formed entries (the drawing loads them in Chrome).
 */
export function storyImages(images) {
  const out = {};
  if (!images || typeof images !== "object") return out;
  for (const [k, v] of Object.entries(images).slice(0, 60)) {
    if (typeof k === "string" && k.length <= 300 && typeof v === "string" && /^https:\/\//.test(v)) out[k] = v;
  }
  return out;
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

/** Time ranges (ms) where a key line, chapter or story fills the captions' space. */
export function captionGaps(graphics) {
  return graphics
    .filter((g) => g.type === "keyline" || g.type === "chapter" || g.type === "story")
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
export async function renderGraphics({
  graphics,
  theme,
  w,
  h,
  totalFrames,
  workdir,
  onProgress,
  name = "graphics",
  images = {},
}) {
  const ranges = graphicRanges(graphics, totalFrames);
  if (!ranges.length) return [];
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const inputProps = { graphics, theme, images, width: w, height: h, durationInFrames: totalFrames };
  const composition = await selectComposition({ serveUrl: GRAPHICS_BUNDLE, id: "graphics", inputProps });
  const totalToDraw = ranges.reduce((s, [a, b]) => s + Math.ceil(b / 2) - Math.floor(a / 2), 0);
  let drawn = 0;
  const pieces = [];
  for (let i = 0; i < ranges.length; i++) {
    // The stretch in drawn (15 fps) frames.
    const a = Math.floor(ranges[i][0] / 2);
    const b = Math.ceil(ranges[i][1] / 2);
    const file = path.join(workdir, `${name}_${i}.mov`);
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
 * ffmpeg arguments for the final picture: the zooms, the graphics behind the
 * speaker (when `behind` has their clips and the speaker's masks, see
 * cutout.js), the other graphics clips laid over at their times, then the
 * text filters (captions, hook). Audio is copied. `textFilters` is a list of
 * filters (or empty).
 */
export function composeArgs({ input, pieces, zoom, textFilters, output, behind = null }) {
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
  if (behind?.masks?.length) {
    const b = behindFilters({
      picture: last,
      pieces: behind.pieces,
      masks: behind.masks,
      w: behind.w,
      h: behind.h,
      firstInput: 1 + pieces.length,
    });
    args.push(...b.inputs);
    graph.push(...b.graph);
    last = b.last;
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

// ---------- sounds (mirrors src/motion/sounds.ts) ----------

export const SOUNDS_DIR = path.join(here, "sounds");
const SOUND_KINDS = new Set(["whoosh-light", "whoosh-deep", "click", "pop", "ui-blip", "glitch", "riser", "hit"]);
const KIND_GAIN = {
  "whoosh-light": 0.9,
  "whoosh-deep": 0.9,
  click: 0.8,
  pop: 0.9,
  "ui-blip": 0.8,
  glitch: 0.8,
  riser: 0.75,
  hit: 0.9,
};
export const MUSIC_BEDS = ["bed-calm", "bed-focus", "bed-drive"];
const WHOOSH_LEAD_MS = 250;
const RISER_MS = 1500;
const DEFAULT_SOUND_VOLUME = 70;
const MIN_MUSIC_MS = 4000;
const frameMs = (f) => (f / MOTION_FPS) * 1000;

/** Where the sounds go, before hand edits. */
export function baseSoundEvents(graphics, zooms) {
  const out = [];
  const add = (g, part, kind, atMs) =>
    out.push({ id: `${g.id}:${part}`, kind, atMs: Math.max(0, Math.round(atMs)), graphicId: g.id });
  for (const g of graphics) {
    const at = frameMs(g.from);
    const len = g.to - g.from;
    switch (g.type) {
      case "keyline":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        add(g, "pop", "pop", at);
        break;
      case "counter":
        add(g, "enter", "ui-blip", at);
        add(g, "done", "click", at + frameMs(30));
        break;
      case "list": {
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        const step = g.items.length > 1 ? Math.max(6, (len * 0.66) / g.items.length) : 0;
        g.items.forEach((_, i) => add(g, `item${i}`, "click", at + frameMs(Math.round(i * step))));
        break;
      }
      case "card":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        add(g, "blip", "ui-blip", at + frameMs(4));
        break;
      case "compare": {
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        const second = Math.max(10, Math.round(len * 0.4));
        add(g, "second", "whoosh-deep", at + frameMs(second) - WHOOSH_LEAD_MS);
        break;
      }
      case "story":
        (g.scenes ?? []).forEach((sc, i) =>
          add(g, `scene${i}`, i === 0 ? "whoosh-deep" : "whoosh-light", frameMs(sc.from) - WHOOSH_LEAD_MS),
        );
        break;
      case "chapter":
        if (at >= RISER_MS) add(g, "riser", "riser", at - RISER_MS);
        add(g, "hit", "hit", at);
        add(g, "title", "glitch", at + frameMs(4));
        break;
      case "label":
        add(g, "pop", "pop", at);
        break;
      case "cta":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        add(g, "click", "click", at + frameMs(22));
        break;
    }
  }
  for (const z of zooms) {
    if (z.zoom === "in") add(z, "enter", "whoosh-light", frameMs(z.from) - WHOOSH_LEAD_MS);
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** The sounds after hand edits; none when off. Bad settings are ignored. */
export function soundEvents(graphics, zooms, settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  if (s.enabled === false) return [];
  const removed = new Set(Array.isArray(s.removed) ? s.removed.filter((x) => typeof x === "string") : []);
  const moved = s.moved && typeof s.moved === "object" ? s.moved : {};
  return baseSoundEvents(graphics, zooms)
    .filter((e) => !removed.has(e.id))
    .map((e) => {
      const m = Number(moved[e.id]);
      return Number.isFinite(m) && m ? { ...e, atMs: Math.max(0, e.atMs + Math.max(-20000, Math.min(20000, m))) } : e;
    })
    .sort((a, b) => a.atMs - b.atMs);
}

export function soundGain(kind, settings) {
  const raw = Number(settings?.volume);
  const v = Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : DEFAULT_SOUND_VOLUME));
  return Number((((KIND_GAIN[kind] ?? 0.8) * v) / 100).toFixed(3));
}

/** The music's stretches: a new one at each chapter. */
export function chapterStretches(graphics, endMs, pick) {
  const starts = [0];
  for (const g of graphics) {
    if (g.type !== "chapter") continue;
    const at = frameMs(g.from);
    if (at - starts[starts.length - 1] >= MIN_MUSIC_MS && endMs - at >= MIN_MUSIC_MS) starts.push(at);
  }
  return starts.map((s, i) => ({ what: pick(i), startMs: s, endMs: starts[i + 1] ?? endMs }));
}

// Sounds per ffmpeg run: keeps the command line well under Windows' limit
// and the number of open files small.
const SOUNDS_PER_RUN = 40;

/**
 * The ffmpeg runs, in order, that mix every automatic sound into one track
 * `durationMs` long at `out`, for the music mix to take as a single sound:
 * the sounds in batches, each to its own part, then the parts together.
 * null when there are none. Each sound is its own input: one file split to
 * several delays (asplit) stalls ffmpeg.
 */
export function sfxTrackArgs(events, durationMs, out) {
  const usable = events.filter((e) => SOUND_KINDS.has(e.kind) && e.atMs < durationMs);
  if (!usable.length) return null;
  const D = (durationMs / 1000).toFixed(3);
  const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const mixTo = (inputs, filters, dest) => [
    "-nostdin",
    "-y",
    ...inputs.flatMap((p) => ["-i", p]),
    "-filter_complex",
    [
      ...filters,
      `${inputs.map((_, i) => `[e${i}]`).join("")}amix=inputs=${inputs.length}:duration=longest:` +
        `dropout_transition=0:normalize=0,apad,atrim=0:${D}[out]`,
    ].join(";"),
    "-map", "[out]", "-c:a", "pcm_s16le", dest,
  ];
  const batches = [];
  for (let i = 0; i < usable.length; i += SOUNDS_PER_RUN) batches.push(usable.slice(i, i + SOUNDS_PER_RUN));
  const parts = batches.length === 1 ? [out] : batches.map((_, b) => out.replace(/\.wav$/, `.part${b}.wav`));
  const runs = batches.map((evs, b) =>
    mixTo(
      evs.map((e) => path.join(SOUNDS_DIR, `${e.kind}.m4a`)),
      evs.map((e, i) => `[${i}:a]${fmt},volume=${e.gain},adelay=${Math.round(e.atMs)}:all=1[e${i}]`),
      parts[b],
    ),
  );
  // The parts all start at 0:00, so they mix without delays.
  if (parts.length > 1) runs.push(mixTo(parts, parts.map((_, i) => `[${i}:a]anull[e${i}]`), out));
  return runs;
}
