// Each look's colour LUT: the film grade the export puts on the footage
// after the automatic correction (colour.js), in place of the look's simple
// grade (curves, saturation and contrast in motion.js LOOK_FINISH, which the
// editor preview still shows).
//
// A LUT starts from that simple grade and adds what simple settings can't:
//   skin      skin tones keep their hue and only part of a saturation change,
//             so a punchy or a muted look never turns a face orange or grey
//   hues      chosen colours moved (Film: greens and blues toward teal)
//   split     a tint in the shadows and another in the highlights
//   toe       the blacks lifted a little (a soft, filmic floor)
//   shoulder  the brightest highlights rolled off instead of clipping
//   mono      black and white from a mix of the channels (Noir)
//
// The .cube files (33x33x33) are made the first time a look is exported and
// kept in the temp folder, named by their contents, so a changed grade makes
// a new file. To look at them: node luts.js <folder> writes all of them.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookFinish } from "./motion.js";

const SIZE = 33;

/** Each look's finish on top of its simple grade (motion.js LOOK_FINISH). */
export const LOOK_LUTS = {
  // Motion Explainer: punchy colour and bright highlights (the owner's
  // pick), with skin held back from the extra colour.
  glass: {
    skin: 0.5,
    shoulder: 0.25,
  },
  // Paper: warm, soft and a little faded, like a printed page.
  paper: {
    skin: 0.6,
    toe: 0.025,
    split: { shadow: [0.01, 0.005, -0.005], high: [0.02, 0.012, -0.01] },
    shoulder: 0.3,
  },
  // Minimal: quiet, softer colour, a gentle lifted floor, a cool touch.
  minimal: {
    skin: 0.6,
    toe: 0.02,
    split: { shadow: [-0.005, 0, 0.008], high: [0, 0, 0] },
    shoulder: 0.3,
  },
  // Film: teal shadows, warm skin and highlights, greens and blues pulled
  // toward teal, a faded floor and soft highlights.
  film: {
    skin: 0.7,
    hues: [
      { at: 220, width: 45, turn: 35, sat: 0.8 }, // greens → teal, quieter
      { at: 342, width: 35, turn: -20, sat: 1.0 }, // blues → teal
    ],
    toe: 0.03,
    split: { shadow: [-0.055, 0.015, 0.05], high: [0.04, 0.016, -0.032] },
    shoulder: 0.45,
  },
  // SaaS: bright and clean, a cool, crisp white.
  saas: {
    skin: 0.5,
    split: { shadow: [0, 0, 0.006], high: [-0.006, 0, 0.008] },
    shoulder: 0.25,
  },
  // Documentary: true to life and calm, a touch warm, greens held back.
  docu: {
    skin: 0.7,
    hues: [{ at: 225, width: 40, turn: -8, sat: 0.85 }],
    toe: 0.015,
    split: { shadow: [0.006, 0.003, -0.006], high: [0.018, 0.009, -0.012] },
    shoulder: 0.35,
  },
  // 3D Cinematic: deep contrast, rich reds, cool shadows.
  cine3d: {
    skin: 0.6,
    hues: [{ at: 100, width: 30, turn: 0, sat: 1.12 }], // reds richer
    split: { shadow: [-0.045, 0, 0.05], high: [0.02, 0.006, -0.01] },
    shoulder: 0.4,
  },
  // Bulletin: crisp news-desk colour, cool and neutral.
  bulletin: {
    skin: 0.5,
    split: { shadow: [-0.004, 0, 0.01], high: [-0.004, 0, 0.004] },
    shoulder: 0.25,
  },
  // Impact: loud colour and hard contrast, skin kept natural.
  impact: {
    skin: 0.4,
    shoulder: 0.3,
  },
  // Noir: black and white weighted to red (faces lighter, skies darker, as
  // a red filter on film does), deep blacks and bright highlights.
  noir: {
    mono: [0.42, 0.48, 0.1],
    shoulder: 0.35,
  },
  // Monument: warm and rich, deep blacks, gold highlights, colour held back.
  monument: {
    skin: 0.7,
    hues: [{ at: 345, width: 40, turn: 0, sat: 0.8 }], // blues quieter
    split: { shadow: [0.008, 0, -0.01], high: [0.045, 0.025, -0.028] },
    shoulder: 0.4,
  },
  // Studio Talk: warm and soft, gentle contrast.
  talk: {
    skin: 0.6,
    split: { shadow: [0.01, 0.004, -0.008], high: [0.022, 0.011, -0.012] },
    shoulder: 0.35,
  },
  // Notebook: bright and clean, a little warm like paper.
  notebook: {
    skin: 0.5,
    split: { shadow: [0, 0, 0], high: [0.01, 0.006, -0.004] },
    shoulder: 0.25,
  },
  // Spec HUD: crisp and cool, cyan in the shadows.
  hud: {
    skin: 0.6,
    split: { shadow: [-0.035, 0.008, 0.04], high: [-0.008, 0.004, 0.012] },
    shoulder: 0.3,
  },
  // Studio 3D: clean, bright and neutral.
  studio: {
    skin: 0.5,
    shoulder: 0.25,
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** A smooth curve through 5 points at 0, .25, .5, .75, 1 (monotone cubic). */
function curveFn(pts) {
  const xs = [0, 0.25, 0.5, 0.75, 1];
  const n = 5;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1] - pts[i]) / 0.25);
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  return (x) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor(x / 0.25)));
    const t = (x - xs[i]) / 0.25;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * pts[i] +
      (t3 - 2 * t2 + t) * 0.25 * m[i] +
      (-2 * t3 + 3 * t2) * pts[i + 1] +
      (t3 - t2) * 0.25 * m[i + 1]
    );
  };
}

/** How near a hue (degrees) is to a window's centre: 1 at it, 0 past its width. */
function nearHue(h, at, width) {
  let dist = Math.abs(h - at) % 360;
  if (dist > 180) dist = 360 - dist;
  if (dist >= width) return 0;
  const k = dist / width;
  return 0.5 + 0.5 * Math.cos(Math.PI * k);
}

// Rec. 709 luma and chroma.
const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;
const toYcc = (r, g, b) => {
  const y = KR * r + KG * g + KB * b;
  return [y, (b - y) / (2 * (1 - KB)), (r - y) / (2 * (1 - KR))];
};
const toRgb = (y, cb, cr) => {
  const r = y + 2 * (1 - KR) * cr;
  const b = y + 2 * (1 - KB) * cb;
  const g = (y - KR * r - KB * b) / KG;
  return [r, g, b];
};
/** Skin's hue in the chroma plane (atan2(cr, cb), degrees): warm, between red and yellow. */
const SKIN_HUE = 123;
const SKIN_WIDTH = 28;

/**
 * Skin keeps its own hue through every look, and its depth: the look's
 * curves, tints and teal shadows go on everything else. Darker skin sits in
 * the shadows, where the looks' tints are strongest: Cinematic's teal
 * shadows turned the owner's skin blue (hue 117° -> 5°, 2026-11-27).
 */
const SKIN_KEEP = 1;
/** Skin is a strong colour for its brightness (as colour.js): a pale warm wall isn't skin. */
const SKIN_SAT_LO = 0.08;
const SKIN_SAT_HI = 0.15;
/** A look may darken skin to no less than this share of its brightness. */
const SKIN_FLOOR = 0.9;
/** How far either side of skin's hue is kept (wider than the looks' own skin handling). */
const SKIN_KEEP_WIDTH = 40;

const smooth = (lo, hi, v) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** How much a colour (0-1 RGB) is skin (0-1). */
function skinWeight(r, g, b) {
  const [y, cb, cr] = toYcc(r, g, b);
  const chroma = Math.hypot(cb, cr);
  // Deep skin in shadow is a faint colour: down to a little chroma counts.
  if (chroma < 0.004 || y < 0.01) return 0;
  const hue = ((Math.atan2(cr, cb) * 180) / Math.PI + 360) % 360;
  return (
    nearHue(hue, SKIN_HUE, SKIN_KEEP_WIDTH) *
    smooth(0.004, 0.012, chroma) *
    smooth(SKIN_SAT_LO, SKIN_SAT_HI, chroma / Math.max(y, 0.05))
  );
}

/** One colour (0-1 RGB) through a look's LUT grade. */
export function gradeColour(look, r, g, b) {
  const spec = LOOK_LUTS[look];
  const graded = gradeLook(spec, look, r, g, b);
  if (spec.mono) return graded;
  const w = skinWeight(r, g, b) * SKIN_KEEP;
  if (w <= 0) return graded;
  // The graded colour turned back to the skin's own hue (its strength as
  // the look made it), and not darker than SKIN_FLOOR of what it was.
  const [y0, cb0, cr0] = toYcc(r, g, b);
  const [y1, cb1, cr1] = toYcc(...graded);
  const m1 = Math.hypot(cb1, cr1);
  const a0 = Math.atan2(cr0, cb0);
  const cbT = m1 * Math.cos(a0);
  const crT = m1 * Math.sin(a0);
  const yT = Math.max(y1, y0 * SKIN_FLOOR);
  const out = toRgb(y1 + (yT - y1) * w, cb1 + (cbT - cb1) * w, cr1 + (crT - cr1) * w);
  return out.map(clamp01);
}

/** One colour through the look's grade as designed (before skin is kept). */
function gradeLook(spec, look, r, g, b) {
  const base = lookFinish(look).grade ?? { saturation: 1, contrast: 1 };
  if (base.curves) {
    r = curveFn(base.curves.r)(r);
    g = curveFn(base.curves.g)(g);
    b = curveFn(base.curves.b)(b);
  }
  let [y, cb, cr] = toYcc(r, g, b);
  // Contrast on the brightness, around the middle (as ffmpeg's eq does).
  y = (y - 0.5) * base.contrast + 0.5;

  if (spec.mono) {
    const [wr, wg, wb] = spec.mono;
    const m = (wr * r + wg * g + wb * b) / (wr + wg + wb);
    y = (m - 0.5) * base.contrast + 0.5;
    cb = 0;
    cr = 0;
  } else {
    const hue = ((Math.atan2(cr, cb) * 180) / Math.PI + 360) % 360;
    const skin = nearHue(hue, SKIN_HUE, SKIN_WIDTH) * (spec.skin ?? 0);
    // Saturation; skin gets only part of the change.
    let sat = base.saturation + (1 - base.saturation) * skin;
    let turn = 0;
    for (const hs of spec.hues ?? []) {
      const w = nearHue(hue, hs.at, hs.width) * (1 - skin);
      sat *= 1 + (hs.sat - 1) * w;
      turn += hs.turn * w;
    }
    const a = (turn * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    [cb, cr] = [(cb * c - cr * s) * sat, (cb * s + cr * c) * sat];
  }

  // A soft floor and rolled-off highlights.
  const toe = spec.toe ?? 0;
  y = toe + y * (1 - toe);
  const sh = spec.shoulder ?? 0;
  if (sh > 0) {
    const knee = 1 - sh * 0.35;
    if (y > knee) {
      const over = y - knee;
      const room = 1 - knee;
      y = knee + room * (1 - Math.exp(-over / room));
    }
  }

  [r, g, b] = toRgb(y, cb, cr);
  if (spec.split) {
    const lum = clamp01(y);
    const ws = (1 - lum) * (1 - lum);
    const wh = lum * lum;
    r += spec.split.shadow[0] * ws + spec.split.high[0] * wh;
    g += spec.split.shadow[1] * ws + spec.split.high[1] * wh;
    b += spec.split.shadow[2] * ws + spec.split.high[2] * wh;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** The look's LUT as a .cube file's text. */
export function cubeText(look) {
  const lines = [`TITLE "Stuccord ${look}"`, `LUT_3D_SIZE ${SIZE}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  // Red changes fastest, then green, then blue (the .cube order).
  for (let bi = 0; bi < SIZE; bi++)
    for (let gi = 0; gi < SIZE; gi++)
      for (let ri = 0; ri < SIZE; ri++) {
        const out = gradeColour(look, ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1));
        lines.push(out.map((v) => v.toFixed(6)).join(" "));
      }
  return lines.join("\n") + "\n";
}

/** The look's .cube file (made the first time); null for a look without one. */
export function lutFile(look) {
  if (!Object.hasOwn(LOOK_LUTS, look ?? "")) return null;
  return cachedCube(look, cubeText(look));
}

/** Writes a .cube to the temp folder (once: named by its contents). */
function cachedCube(name, text) {
  const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
  const dir = path.join(os.tmpdir(), "stuccord-luts");
  const file = path.join(dir, `${name}-${hash}.cube`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    // Written whole, then moved in: two exports at once never read half a file.
    const part = `${file}.${process.pid}.${Date.now()}.part`;
    fs.writeFileSync(part, text);
    fs.renameSync(part, file);
  }
  return file;
}

// ffmpeg filter syntax: forward slashes, and the drive colon (Windows) escaped.
const lut3d = (file) =>
  `lut3d=file='${file.replace(/\\/g, "/").replace(/:/g, "\\:")}':interp=tetrahedral`;

/**
 * The look's grade as an ffmpeg filter: its LUT, or (a look without one,
 * or a LUT that can't be made) null, and the caller keeps the simple grade.
 */
export function lutFilter(look) {
  let file;
  try {
    file = lutFile(look);
  } catch (e) {
    console.warn(`[Worker] The ${look} LUT couldn't be made:`, e?.message || e);
    return null;
  }
  return file ? lut3d(file) : null;
}

// ---------- ready-made LUTs (the packs: import-luts.mjs) ----------

const PACK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "luts");

/**
 * A pack LUT as a .cube, mixed with the untouched picture by strength
 * (0-1, to the nearest 5%); null when there's no such LUT.
 */
export function packCubeText(id, strength = 1) {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,80}$/.test(id)) return null;
  const file = path.join(PACK_DIR, `${id}.lut`);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (buf.length !== SIZE ** 3 * 6) return null;
  const k = Math.round(Math.min(1, Math.max(0, Number(strength) || 0)) * 20) / 20;
  const lines = [`TITLE "Stuccord ${id} ${k}"`, `LUT_3D_SIZE ${SIZE}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  let o = 0;
  for (let bi = 0; bi < SIZE; bi++)
    for (let gi = 0; gi < SIZE; gi++)
      for (let ri = 0; ri < SIZE; ri++) {
        const src = [ri, gi, bi].map((i) => i / (SIZE - 1));
        const out = src.map((x) => {
          const v = buf.readUInt16LE(o) / 65535;
          o += 2;
          return x + (v - x) * k;
        });
        lines.push(out.map((v) => v.toFixed(6)).join(" "));
      }
  return lines.join("\n") + "\n";
}

/**
 * A pack LUT as an ffmpeg filter, at a strength (0-1); null when there's no
 * such LUT or it can't be made (the caller keeps the look's own grade).
 */
export function packLutFilter(id, strength = 1) {
  try {
    const text = packCubeText(id, strength);
    return text ? lut3d(cachedCube(`pack-${id}`, text)) : null;
  } catch (e) {
    console.warn(`[Worker] The ${id} LUT couldn't be made:`, e?.message || e);
    return null;
  }
}

// ---------- the skin check for ready-made LUTs ----------
// The packs were made for other footage: on the owner's (darker skin, bright
// wall) 15 of the 24 crushed the face or turned it. Before one is used, it's
// tried on the video's own skin (colour.js samples, after the correction)
// and turned down until skin keeps its depth, colour and hue, or dropped.

/** Skin may get no darker than this share of its brightness, */
const PACK_SKIN_DEPTH = 0.85;
/** keep this share of its colour, but no more than PACK_SKIN_COLOUR_MAX (orange skin), */
const PACK_SKIN_COLOUR = 0.6;
const PACK_SKIN_COLOUR_MAX = 1.4;
/** A LUT that leaves skin with less than this share of its colour is black and white on purpose. */
const PACK_MONO = 0.1;
/** and turn by no more than this (degrees, on average). */
const PACK_SKIN_TURN = 8;
/** Lowest strength tried before the LUT is dropped. */
const PACK_MIN_STRENGTH = 0.2;

const packData = new Map();
function packTable(id) {
  if (packData.has(id)) return packData.get(id);
  let table = null;
  if (typeof id === "string" && /^[a-z0-9-]{1,80}$/.test(id)) {
    const file = path.join(PACK_DIR, `${id}.lut`);
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      if (buf.length === SIZE ** 3 * 6) {
        table = new Float32Array(SIZE ** 3 * 3);
        for (let i = 0; i < table.length; i++) table[i] = buf.readUInt16LE(i * 2) / 65535;
      }
    }
  }
  packData.set(id, table);
  return table;
}

/** One colour through a pack LUT (trilinear), as the export's lut3d does (near enough). */
function packColour(table, r, g, b) {
  const n = SIZE - 1;
  const at = (v) => {
    const x = Math.min(n, Math.max(0, v * n));
    const i = Math.min(n - 1, Math.floor(x));
    return [i, x - i];
  };
  const [ri, rf] = at(r);
  const [gi, gf] = at(g);
  const [bi, bf] = at(b);
  const out = [0, 0, 0];
  for (let db = 0; db < 2; db++)
    for (let dg = 0; dg < 2; dg++)
      for (let dr = 0; dr < 2; dr++) {
        const w = (dr ? rf : 1 - rf) * (dg ? gf : 1 - gf) * (db ? bf : 1 - bf);
        if (!w) continue;
        const o = (((bi + db) * SIZE + (gi + dg)) * SIZE + (ri + dr)) * 3;
        out[0] += table[o] * w;
        out[1] += table[o + 1] * w;
        out[2] += table[o + 2] * w;
      }
  return out;
}

/**
 * The strength a pack LUT can be used at on this video's skin (`skin`: 0-1
 * RGB colours, after the correction): the asked strength, or lower, to the
 * nearest 5%; 0 when even PACK_MIN_STRENGTH harms skin (or there's no such
 * LUT). Without skin colours the asked strength stands.
 */
export function packSkinSafeStrength(id, strength, skin) {
  const table = packTable(id);
  if (!table) return 0;
  const asked = Math.round(Math.min(1, Math.max(0, Number(strength) || 0)) * 20) / 20;
  if (!Array.isArray(skin) || skin.length < 4) return asked;
  const before = skin.map(([r, g, b]) => toYcc(r, g, b));
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const y0 = median(before.map((c) => c[0]));
  const c0 = median(before.map((c) => Math.hypot(c[1], c[2])));
  const through = (k) =>
    skin.map(([r, g, b]) => {
      const o = packColour(table, r, g, b);
      return toYcc(r + (o[0] - r) * k, g + (o[1] - g) * k, b + (o[2] - b) * k);
    });
  // Black and white on purpose: only skin's depth is checked.
  const mono = median(through(1).map((c) => Math.hypot(c[1], c[2]))) < c0 * PACK_MONO;
  // Black and white is all or nothing: turned down it's half-coloured.
  if (mono) return median(through(asked).map((c) => c[0])) >= y0 * PACK_SKIN_DEPTH ? asked : 0;
  for (let k = asked; k >= PACK_MIN_STRENGTH - 1e-9; k = Math.round((k - 0.05) * 20) / 20) {
    const after = through(k);
    const y1 = median(after.map((c) => c[0]));
    const c1 = median(after.map((c) => Math.hypot(c[1], c[2])));
    let turn = 0;
    after.forEach((c, i) => {
      let d = Math.abs(Math.atan2(c[2], c[1]) - Math.atan2(before[i][2], before[i][1])) * (180 / Math.PI);
      if (d > 180) d = 360 - d;
      turn += d;
    });
    turn /= after.length;
    if (
      y1 >= y0 * PACK_SKIN_DEPTH &&
      c1 >= c0 * PACK_SKIN_COLOUR &&
      c1 <= c0 * PACK_SKIN_COLOUR_MAX &&
      turn <= PACK_SKIN_TURN
    ) {
      return k;
    }
  }
  return 0;
}

// ---------- the whole grade as one table (the editor's preview) ----------

/**
 * The export's grade as one SIZE^3 RGB table (8-bit, red fastest, as in a
 * .cube): `correct` (the correction, colour.js correctColour), then a
 * ready-made LUT at strength `pack.k`, or else the look's LUT. The editor
 * draws the picture through it, so it shows what the export will.
 */
export function bakeGradeTable({ correct, look = null, pack = null }) {
  const table = pack?.k > 0 ? packTable(pack.id) : null;
  const out = Buffer.alloc(SIZE ** 3 * 3);
  let o = 0;
  for (let bi = 0; bi < SIZE; bi++)
    for (let gi = 0; gi < SIZE; gi++)
      for (let ri = 0; ri < SIZE; ri++) {
        let [r, g, b] = correct(ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1));
        if (table) {
          const p = packColour(table, r, g, b);
          r += (p[0] - r) * pack.k;
          g += (p[1] - g) * pack.k;
          b += (p[2] - b) * pack.k;
        } else if (look && Object.hasOwn(LOOK_LUTS, look)) {
          [r, g, b] = gradeColour(look, r, g, b);
        }
        out[o++] = Math.round(clamp01(r) * 255);
        out[o++] = Math.round(clamp01(g) * 255);
        out[o++] = Math.round(clamp01(b) * 255);
      }
  return { size: SIZE, data: out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[2] || path.join(os.tmpdir(), "stuccord-luts");
  fs.mkdirSync(out, { recursive: true });
  for (const look of Object.keys(LOOK_LUTS)) fs.writeFileSync(path.join(out, `${look}.cube`), cubeText(look));
  console.log(`[luts] ${Object.keys(LOOK_LUTS).length} LUTs written to ${out}`);
}
