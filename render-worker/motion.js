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
const TYPES = new Set(["keyline", "counter", "list", "card", "compare", "story", "cartoon", "steps", "loop", "coins", "stream", "profile", "notes", "chapter", "label", "cta"]);
// Most items per type (src/lib/motion-plan.ts maxItems).
const MAX_ITEMS = { compare: 2, card: 4, steps: 5, loop: 6 };
// Graphics that fill the screen, so the captions make way (FULL_SCREEN_TYPES).
const FULL_SCREEN = new Set(["keyline", "chapter", "story", "cartoon", "steps", "loop", "coins", "stream", "profile", "notes"]);
// How far the picture shifts while a Notes page is up (src/motion/timing.ts).
const SPLIT_WIDE = 0.25;
const SPLIT_TALL = 0.15;
// Types with pictures, and how many each holds (src/lib/motion-plan.ts maxScenes).
const PICTURE_LIMIT = { story: 6, cartoon: 1, stream: 12, profile: 7 };
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
        .slice(0, MAX_ITEMS[el.type] ?? 8),
      number:
        n && Number.isFinite(n.value)
          ? { value: n.value, prefix: str(n.prefix, 8), suffix: str(n.suffix, 12) }
          : null,
      cta: ["like", "subscribe", "comment", "link"].includes(el.cta) ? el.cta : null,
      chapter: el.type === "chapter" ? { index: ++chapterIndex, count: chapterCount } : null,
      behind: el.behind === true && BEHIND_TYPES.has(el.type),
      swap:
        el.type === "loop" && Number.isInteger(el.swap?.item) && typeof el.swap?.text === "string" && el.swap.text
          ? { item: el.swap.item, text: el.swap.text.slice(0, 40) }
          : null,
      profile: el.type === "profile" ? profileDetails(el.profile) : null,
      lines: el.type === "notes" ? placeLines(el.lines, from, to, byKey) : null,
      scenes: PICTURE_LIMIT[el.type] ? placeScenes(el.scenes, PICTURE_LIMIT[el.type], from, to, byKey) : null,
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

/** A Notes page's lines: when each is written, its words and its sketch's name. */
function placeLines(lines, from, to, byKey) {
  const list = (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l === "object").slice(0, 8);
  const froms = list.map((l) => {
    const w = byKey.get(`${l.at?.clip_id}:${l.at?.word_index}`);
    return w ? msToFrame(w.start_ms) : null;
  });
  const starts = sceneStarts(froms, from + 8, to);
  return list.map((l, i) => ({
    from: starts[i],
    text: typeof l.text === "string" ? l.text.slice(0, 60) : "",
    sketch: typeof l.sketch === "string" && /^[a-z]{2,20}$/.test(l.sketch) ? l.sketch : null,
  }));
}

/**
 * Time ranges (s) with a Notes page up: the speaker moves aside then (the
 * middle half of the picture to the left half, or a band of the upper part
 * to the top half), and the page covers the other side.
 */
export function splitRanges(graphics) {
  return graphics
    .filter((g) => g.type === "notes")
    .map((g) => [g.from / MOTION_FPS, g.to / MOTION_FPS]);
}

/** The ffmpeg filters that move the speaker aside during those ranges. */
export function splitFilters(input, ranges, portrait, out) {
  if (!ranges.length) return null;
  const when = ranges.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  const crop = portrait
    ? `crop=iw:ih/2:0:ih*${SPLIT_TALL}`
    : `crop=iw/2:ih:iw*${SPLIT_WIDE}:0`;
  return [
    `[${input}]split[${out}a][${out}b]`,
    `[${out}b]${crop}[${out}c]`,
    `[${out}a][${out}c]overlay=0:0:enable='${when}'[${out}]`,
  ];
}

/** A social profile's details, each a string within its limit. */
function profileDetails(p) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const o = p && typeof p === "object" ? p : {};
  return {
    handle: str(o.handle, 40),
    name: str(o.name, 60),
    bio: str(o.bio, 150),
    posts: str(o.posts, 12),
    followers: str(o.followers, 12),
    following: str(o.following, 12),
  };
}

function placeScenes(scenes, limit, from, to, byKey) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const list = (Array.isArray(scenes) ? scenes : []).filter((sc) => sc && typeof sc === "object").slice(0, limit);
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

// When the parts of the 3D sequences happen (src/motion/beats.ts).
export function stepStarts(count, length) {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => Math.round((i * length * 0.8) / n));
}
export function loopBeats(count, length) {
  const n = Math.max(1, count);
  const arcFrom = 10;
  const arcFrames = Math.max(16, Math.round(length * 0.45));
  return {
    arcFrom,
    arcFrames,
    dots: Array.from({ length: n }, (_, i) => arcFrom + Math.round((arcFrames * i) / n)),
    swapAt: Math.max(arcFrom + arcFrames + 6, Math.round(length * 0.72)),
  };
}
export function coinBeats(length) {
  return { fanAt: Math.max(18, Math.round(length * 0.45)) };
}
export function streamBeats(count) {
  return { cards: Array.from({ length: count }, (_, i) => 2 + i * 3), flight: 16, finaleAt: 2 + count * 3 + 5 };
}
export function profileBeats(photos, length) {
  const grid = Array.from({ length: photos }, (_, i) => 10 + i * 5);
  const gridEnd = grid.length ? grid[grid.length - 1] + 12 : 10;
  const flickFrom = Math.max(gridEnd + 8, Math.round(length * 0.5));
  const each = photos ? Math.min(18, Math.max(8, Math.floor((length - flickFrom - 6) / photos))) : 0;
  return {
    grid,
    flickFrom,
    flicks: Array.from({ length: photos }, (_, i) => flickFrom + i * each).filter((f) => f < length - 6),
  };
}

/**
 * Story pictures' links from the job: storage path -> https link, only
 * well-formed entries (the drawing loads them in Chrome).
 */
export function storyImages(images) {
  const out = {};
  if (!images || typeof images !== "object") return out;
  for (const [k, v] of Object.entries(images).slice(0, 120)) {
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

/** Time ranges (ms) where a full-screen graphic fills the captions' space. */
export function captionGaps(graphics) {
  return graphics
    .filter((g) => FULL_SCREEN.has(g.type))
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

/**
 * The zoompan filter for the zooms and the camera angles' close shots, or
 * null with neither. It zooms around `center` (the speaker, 0-1; the upper
 * middle when unknown), like the preview's transform-origin: that point
 * stays put while the picture grows.
 */
export function zoomFilter(zooms, w, h, { shots = [], center = null } = {}) {
  if (!zooms.length && !shots.length) return null;
  const c = angleCenter(center);
  const close = shots.length
    ? `*(1+${num(ANGLE_CLOSE - 1)}*(${shots.map((s) => `between(in,${s.from},${s.to - 1})`).join("+")}))`
    : "";
  return (
    `zoompan=z='(${zoomExpression(zooms)})${close}'` +
    `:x='${num(c.x)}*iw*(1-1/zoom)':y='${num(c.y)}*ih*(1-1/zoom)'` +
    `:d=1:s=${w}x${h}:fps=${MOTION_FPS}`
  );
}

// ---------- camera angles (mirrors src/motion/angles.ts) ----------

export const ANGLE_CLOSE = 1.3;
const DEFAULT_ANGLE_CENTER = { x: 0.5, y: 0.4 };

/** The plan's speaker point, if it's a valid one; else the upper middle. */
export function angleCenter(center) {
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  return center && ok(center.x) && ok(center.y) ? { x: center.x, y: center.y } : DEFAULT_ANGLE_CENTER;
}

/**
 * The close shots: cuts on pauses and sentence ends, wide first, every 5-10 s
 * (3.5-7 s in the first minute); `blocked` stretches (frames) stay wide.
 * `words` are the placed words ({ text, start_ms, end_ms }).
 */
export function closeShots(words, blocked) {
  const FPS = 30;
  const frameOf = (ms) => Math.round((ms / 1000) * FPS);
  const list = (Array.isArray(words) ? words : [])
    .filter((w) => w && Number.isFinite(w.start_ms))
    .map((w) => ({ text: String(w.text ?? ""), startMs: w.start_ms, endMs: w.end_ms }))
    .sort((a, b) => a.startMs - b.startMs);
  if (list.length < 2) return [];
  const cuts = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const w = list[i];
    const gap = w.startMs - prev.endMs;
    const natural = /[.!?…]["'”’)]*$/.test(prev.text.trim()) || gap >= 350;
    cuts.push({ ms: gap > 0 ? prev.endMs + gap / 2 : w.startMs, natural });
  }
  const startMs = list[0].startMs;
  const endMs = list[list.length - 1].endMs;
  let shots = [];
  let last = startMs;
  let close = false;
  for (const c of cuts) {
    const len = (c.ms - last) / 1000;
    const hook = c.ms - startMs < 60_000;
    const min = hook ? 3.5 : 5;
    const max = hook ? 7 : 10;
    if ((c.natural && len >= min) || len >= max) {
      if (close) shots.push({ from: frameOf(last), to: frameOf(c.ms) });
      close = !close;
      last = c.ms;
    }
  }
  if (close) shots.push({ from: frameOf(last), to: frameOf(endMs) + 10 });
  for (const [a, b] of blocked) {
    const next = [];
    for (const s of shots) {
      if (b <= s.from || a >= s.to) {
        next.push(s);
        continue;
      }
      if (a > s.from) next.push({ from: s.from, to: a });
      if (b < s.to) next.push({ from: b, to: s.to });
    }
    shots = next;
  }
  return shots.filter((s) => s.to - s.from >= 30);
}

/** The stretches that stay wide: zooms, and Notes pages (frames). */
export function angleBlocked(zooms, graphics) {
  return [
    ...zooms.map((z) => [z.from, z.to]),
    ...graphics.filter((g) => g.type === "notes").map((g) => [g.from, g.to]),
  ];
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
  logo = null,
  look = "glass",
}) {
  const ranges = graphicRanges(graphics, totalFrames);
  if (!ranges.length) return [];
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const inputProps = {
    graphics,
    theme,
    images,
    logo,
    look: look === "paper" ? "paper" : "glass",
    width: w,
    height: h,
    durationInFrames: totalFrames,
  };
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
export function composeArgs({ input, pieces, zoom, textFilters, output, behind = null, split = null }) {
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
  // A Notes page: the speaker moves aside (the page is drawn over the other side).
  const sp = split ? splitFilters(last, split.ranges, split.portrait, "sp") : null;
  if (sp) {
    graph.push(...sp);
    last = "sp";
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
      case "cartoon":
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        add(g, "pop", "pop", at);
        break;
      case "steps":
        // A whoosh as the camera flies to each platform (a deeper one first),
        // and a click as its label lands.
        stepStarts(g.items.length, len).forEach((f, i) => {
          add(g, `step${i}`, i === 0 ? "whoosh-deep" : "whoosh-light", at + frameMs(f) - WHOOSH_LEAD_MS);
          add(g, `label${i}`, "click", at + frameMs(f + 6));
        });
        break;
      case "loop": {
        // The sphere rises, a click on each stop as the arc reaches it, a
        // glitch when a word swaps.
        const b = loopBeats(g.items.length, len);
        add(g, "enter", "whoosh-deep", at - WHOOSH_LEAD_MS);
        b.dots.forEach((f, i) => add(g, `stop${i}`, "click", at + frameMs(f)));
        if (g.swap) add(g, "swap", "glitch", at + frameMs(b.swapAt));
        break;
      }
      case "coins": {
        const b = coinBeats(len);
        add(g, "enter", "whoosh-deep", at - WHOOSH_LEAD_MS);
        add(g, "fan", "whoosh-light", at + frameMs(b.fanAt) - WHOOSH_LEAD_MS);
        add(g, "blip", "ui-blip", at + frameMs(b.fanAt));
        break;
      }
      case "stream": {
        // A quick riffle of clicks as the pictures fly in, then a whoosh and a
        // pop as the last card lands.
        const b = streamBeats(g.scenes?.length ?? 0);
        b.cards.forEach((f, i) => add(g, `card${i}`, "click", at + frameMs(f + b.flight - 4)));
        add(g, "finale", "whoosh-light", at + frameMs(b.finaleAt) - WHOOSH_LEAD_MS);
        add(g, "land", "pop", at + frameMs(b.finaleAt + b.flight - 4));
        break;
      }
      case "profile": {
        // The header slides up, a click per grid photo, then a whoosh into the
        // big photos and a blip on each.
        const photos = Math.max(0, (g.scenes?.length ?? 0) - 1);
        const b = profileBeats(photos, len);
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        b.grid.forEach((f, i) => add(g, `photo${i}`, "click", at + frameMs(f)));
        if (b.flicks.length) add(g, "flick", "whoosh-light", at + frameMs(b.flickFrom) - WHOOSH_LEAD_MS);
        b.flicks.forEach((f, i) => add(g, `flick${i}`, "ui-blip", at + frameMs(f)));
        break;
      }
      case "notes":
        // The page slides in; a click as each line is written, a blip when
        // its sketch draws on.
        add(g, "enter", "whoosh-light", at - WHOOSH_LEAD_MS);
        (g.lines ?? []).forEach((l, i) => {
          add(g, `line${i}`, "click", frameMs(l.from));
          if (l.sketch) add(g, `sketch${i}`, "ui-blip", frameMs(l.from + 6));
        });
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
