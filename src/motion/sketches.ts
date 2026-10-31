// Built-in sketches for the Notes page (stage 10b): simple line drawings,
// drawn on stroke by stroke as each idea is named. Each is one or more SVG
// paths in a 100 x 100 box. No app imports: the worker bundles src/motion
// on its own (src/lib/motion-plan.ts lists the same names).

export const SKETCH_PATHS = {
  laptop: ["M22 28 H78 V64 H22 Z", "M12 72 H88 L82 78 H18 Z", "M30 36 H70 M30 46 H58"],
  money: [
    "M14 30 H86 V70 H14 Z",
    "M50 38 C40 38 40 50 50 50 C60 50 60 62 50 62 M50 34 V66",
    "M22 38 V40 M78 60 V62",
  ],
  coins: [
    "M30 62 A16 8 0 1 0 62 62 A16 8 0 1 0 30 62",
    "M30 62 V72 A16 8 0 0 0 62 72 V62",
    "M44 40 A16 8 0 1 0 76 40 A16 8 0 1 0 44 40 M44 40 V50 A16 8 0 0 0 76 50 V40",
  ],
  person: ["M50 20 A12 12 0 1 0 50.1 20", "M26 84 C26 62 38 54 50 54 C62 54 74 62 74 84"],
  people: [
    "M34 30 A10 10 0 1 0 34.1 30 M66 30 A10 10 0 1 0 66.1 30",
    "M14 78 C14 60 24 52 34 52 C44 52 50 58 52 66",
    "M48 66 C50 58 56 52 66 52 C76 52 86 60 86 78",
  ],
  chart: ["M16 16 V84 H86", "M24 70 L42 52 L56 62 L80 30", "M70 30 H80 V40"],
  growth: ["M24 76 V60 M42 76 V48 M60 76 V36 M78 76 V22", "M16 84 H86"],
  stairs: ["M14 84 H32 V66 H50 V48 H68 V30 H86", "M78 18 L86 26 L94 18"],
  idea: [
    "M50 16 C32 16 24 30 24 42 C24 54 34 60 36 70 H64 C66 60 76 54 76 42 C76 30 68 16 50 16",
    "M38 78 H62 M42 86 H58",
  ],
  clock: ["M50 14 A36 36 0 1 0 50.1 14", "M50 30 V50 L64 60"],
  target: [
    "M50 14 A36 36 0 1 0 50.1 14",
    "M50 30 A20 20 0 1 0 50.1 30",
    "M50 46 A4 4 0 1 0 50.1 46",
  ],
  rocket: [
    "M50 12 C64 24 68 42 64 66 H36 C32 42 36 24 50 12",
    "M36 56 L24 72 L36 70 M64 56 L76 72 L64 70",
    "M44 76 L50 90 L56 76",
    "M50 34 A6 6 0 1 0 50.1 34",
  ],
  phone: ["M32 12 H68 V88 H32 Z", "M44 20 H56 M46 80 H54"],
  house: ["M14 48 L50 18 L86 48", "M24 40 V84 H76 V40", "M42 84 V62 H58 V84"],
  gear: [
    "M50 34 A16 16 0 1 0 50.1 34",
    "M50 14 V24 M50 76 V86 M14 50 H24 M76 50 H86 M24 24 L31 31 M69 69 L76 76 M76 24 L69 31 M31 69 L24 76",
  ],
  check: ["M18 52 L40 74 L84 28"],
  cart: ["M10 22 H24 L34 64 H76 L84 34 H28", "M38 78 A5 5 0 1 0 38.1 78 M70 78 A5 5 0 1 0 70.1 78"],
  mail: ["M14 26 H86 V74 H14 Z", "M14 26 L50 54 L86 26"],
  globe: [
    "M50 14 A36 36 0 1 0 50.1 14",
    "M14 50 H86",
    "M50 14 C34 30 34 70 50 86 C66 70 66 30 50 14",
  ],
  heart: ["M50 82 C20 60 12 42 22 28 C32 16 46 22 50 34 C54 22 68 16 78 28 C88 42 80 60 50 82"],
  star: ["M50 12 L60 38 L88 38 L66 56 L74 84 L50 68 L26 84 L34 56 L12 38 L40 38 Z"],
  arrow: ["M14 50 H82", "M64 32 L84 50 L64 68"],
  book: [
    "M50 24 C40 18 24 18 14 22 V80 C24 76 40 76 50 82 C60 76 76 76 86 80 V22 C76 18 60 18 50 24",
    "M50 24 V82",
  ],
  video: ["M14 26 H86 V74 H14 Z", "M42 38 L62 50 L42 62 Z"],
} as const satisfies Record<string, readonly string[]>;

export type SketchId = keyof typeof SKETCH_PATHS;
