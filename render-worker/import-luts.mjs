// Brings ready-made LUT packs into the app: node import-luts.mjs <folder>...
//
// Reads every .cube (Resolve and others: a 3D LUT, red changing fastest)
// and .3dl (Photoshop/Lustre: a 3D LUT, blue changing fastest, whole-number
// values) in the folders, and for each:
//   - luts/<id>.lut  the LUT resampled to 33x33x33, red fastest, as
//                    16-bit numbers (little-endian, 0-65535 for 0-1); the
//                    export reads it (pack-luts.js)
//   - an entry in src/motion/lut-packs.ts: its name, its pack (the folder's
//     name up to "_LUTs" or the first "_"), and a rough version of it the
//     editor preview can draw (per-channel curves, then saturation)
//
// Running it again replaces the list with the LUTs in the folders given.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 33;
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, "luts");
const TS_FILE = path.join(here, "..", "src", "motion", "lut-packs.ts");

/** A LUT read from a file: n points per side, values 0-1, red fastest. */
function readCube(text) {
  let n = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const v = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === "LUT_3D_SIZE") n = Number(rest[0]);
    else if (key === "LUT_1D_SIZE") throw new Error("a 1D LUT");
    else if (key === "DOMAIN_MIN") min = rest.map(Number);
    else if (key === "DOMAIN_MAX") max = rest.map(Number);
    else if (/^[-\d.]/.test(key)) v.push(Number(key), Number(rest[0]), Number(rest[1]));
  }
  if (min.some((x) => x !== 0) || max.some((x) => x !== 1)) throw new Error("an unusual domain");
  if (!n || v.length !== n * n * n * 3) throw new Error(`size ${n}, ${v.length / 3} entries`);
  return { n, v: Float64Array.from(v) };
}

function read3dl(text) {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/).map(Number));
  // The first line: the input points along each side (0 ... 1023 or 4095).
  const grid = rows[0];
  const n = grid.length;
  const data = rows.slice(1).filter((r) => r.length === 3);
  if (data.length !== n * n * n) throw new Error(`${n} points a side, ${data.length} entries`);
  if (grid.some((g, i) => Math.abs(g - (i * grid[n - 1]) / (n - 1)) > 1.5))
    throw new Error("uneven input points");
  let top = 0;
  for (const r of data) top = Math.max(top, ...r);
  // Output depth: 10, 12 or 16 bits.
  const scale = top <= 1023 ? 1023 : top <= 4095 ? 4095 : 65535;
  const v = new Float64Array(n * n * n * 3);
  // Blue changes fastest here; red fastest in our order.
  let i = 0;
  for (let r = 0; r < n; r++)
    for (let g = 0; g < n; g++)
      for (let b = 0; b < n; b++, i++) {
        const o = (r + g * n + b * n * n) * 3;
        v[o] = data[i][0] / scale;
        v[o + 1] = data[i][1] / scale;
        v[o + 2] = data[i][2] / scale;
      }
  return { n, v };
}

/** The LUT's colour for r, g, b (0-1), trilinear between its points. */
function sample({ n, v }, r, g, b) {
  const pos = (x) => {
    const p = Math.min(Math.max(x, 0), 1) * (n - 1);
    const i = Math.min(Math.floor(p), n - 2);
    return [i, p - i];
  };
  const [ri, rf] = pos(r);
  const [gi, gf] = pos(g);
  const [bi, bf] = pos(b);
  const out = [0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const dr = k & 1, dg = (k >> 1) & 1, db = (k >> 2) & 1;
    const w = (dr ? rf : 1 - rf) * (dg ? gf : 1 - gf) * (db ? bf : 1 - bf);
    if (!w) continue;
    const o = (ri + dr + (gi + dg) * n + (bi + db) * n * n) * 3;
    out[0] += v[o] * w;
    out[1] += v[o + 1] * w;
    out[2] += v[o + 2] * w;
  }
  return out;
}

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * A rough version for the preview: each channel's curve along the greys
 * (9 points), then the saturation that best matches the LUT on colours.
 */
function previewOf(lut) {
  const pts = 9;
  const curves = { r: [], g: [], b: [] };
  for (let i = 0; i < pts; i++) {
    const x = i / (pts - 1);
    const [r, g, b] = sample(lut, x, x, x);
    curves.r.push(round(r));
    curves.g.push(round(g));
    curves.b.push(round(b));
  }
  const curve = (c, x) => {
    const p = x * (pts - 1);
    const i = Math.min(Math.floor(p), pts - 2);
    return c[i] + (c[i + 1] - c[i]) * (p - i);
  };
  // Least squares: (lut - its luma) ≈ s * (curved - its luma).
  let num = 0;
  let den = 0;
  const steps = 8;
  for (let r = 0; r <= steps; r++)
    for (let g = 0; g <= steps; g++)
      for (let b = 0; b <= steps; b++) {
        const c = [r / steps, g / steps, b / steps];
        const curved = [curve(curves.r, c[0]), curve(curves.g, c[1]), curve(curves.b, c[2])];
        const out = sample(lut, ...c);
        const yc = luma(curved);
        const yo = luma(out);
        for (let k = 0; k < 3; k++) {
          num += (out[k] - yo) * (curved[k] - yc);
          den += (curved[k] - yc) ** 2;
        }
      }
  const saturation = round(Math.min(2, Math.max(0, den ? num / den : 1)), 2);
  return { curves, saturation };
}

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bBw\b/, "B&W");
const idOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function packName(dir) {
  // ".../Hue_Haven_LUTs_source_123/LUTS (FREEMIUM 14)" → "Hue Haven"
  const parts = path.resolve(dir).split(path.sep);
  const top = parts.find((p) => /_LUTs?_/i.test(p)) ?? parts[parts.length - 1];
  return top.split(/_LUTs?_/i)[0].replace(/_/g, " ").trim();
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("Usage: node import-luts.mjs <folder>...");
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith(".lut")) fs.rmSync(path.join(OUT_DIR, f));

const entries = [];
for (const dir of dirs) {
  const pack = packName(dir);
  for (const file of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".cube" && ext !== ".3dl") continue;
    const name = titleCase(path.basename(file, path.extname(file)));
    const id = idOf(`${pack} ${name}`);
    let lut;
    try {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      lut = ext === ".cube" ? readCube(text) : read3dl(text);
    } catch (e) {
      console.warn(`[luts] Skipped ${file}: ${e.message}`);
      continue;
    }
    const buf = Buffer.alloc(SIZE ** 3 * 6);
    let o = 0;
    let mono = true;
    for (let b = 0; b < SIZE; b++)
      for (let g = 0; g < SIZE; g++)
        for (let r = 0; r < SIZE; r++) {
          const out = sample(lut, r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1));
          if (Math.max(...out) - Math.min(...out) > 0.02) mono = false;
          for (const x of out) {
            buf.writeUInt16LE(Math.round(Math.min(Math.max(x, 0), 1) * 65535), o);
            o += 2;
          }
        }
    fs.writeFileSync(path.join(OUT_DIR, `${id}.lut`), buf);
    entries.push({ id, name, pack, mono, preview: previewOf(lut) });
    console.log(`[luts] ${pack} / ${name} → luts/${id}.lut`);
  }
}

const ts = `// Ready-made colour LUTs a video can use in place of its look's own colour
// (the plan's \`lut\`). Made by render-worker/import-luts.mjs from the LUT
// packs; the export applies the real LUT (render-worker/luts/<id>.lut), the
// editor preview a rough version of it (per-channel curves, then saturation).
// Don't edit by hand: run the import again.

export type PackLut = {
  id: string;
  name: string;
  pack: string;
  /** Black and white. */
  mono: boolean;
  /** The preview's version: curves at 9 even points (0-1), then saturation. */
  preview: { curves: { r: number[]; g: number[]; b: number[] }; saturation: number };
};

export const PACK_LUTS: PackLut[] = ${JSON.stringify(entries, null, 2)};

export const PACK_LUT_IDS = PACK_LUTS.map((l) => l.id);

/** A pack LUT by id, or null. */
export function packLut(id: string | null | undefined): PackLut | null {
  return PACK_LUTS.find((l) => l.id === id) ?? null;
}
`;
fs.writeFileSync(TS_FILE, ts);
console.log(`[luts] ${entries.length} LUTs; list written to ${path.relative(process.cwd(), TS_FILE)}`);
