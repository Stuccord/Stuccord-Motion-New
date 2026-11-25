// How sure RVM's matte looks, per stretch (cutout.js): measured for free on
// every frame while RVM runs. A stretch whose matte looks unsure isn't cut
// out: its graphics are drawn in front of the speaker instead, which always
// looks right, rather than showing through a patchy cut-out.
//
// Measured on a grid of every STEP-th pixel (only "stray" decides; the
// others are logged to learn from):
// - stray: matte pieces not joined to the speaker's body (a patch of wall,
//   a shelf, a lamp). Pieces touching the bottom of the frame are the body
//   going out of shot (beside a laptop, say) and don't count.
// - soft: a lot of half-sure matte (0.15-0.85) for the person's size,
//   beyond the thin soft edge hair and beards give.
// - flicker: the matte's shape jumping between frames by more than moving
//   does.

const STEP = 4;
const SURE = 0.5;
const SOFT_LO = 0.15;
const SOFT_HI = 0.85;
/** Pieces smaller than this many grid cells are speckle, not wall. */
const MIN_PIECE = 3;

/**
 * When a stretch counts as unsure. Only stray pieces count: a speaker split
 * into pieces (a body seen patchily through a glass podium, apart from the
 * head) or a patch of wall taken for them. Soft and flicker are logged, not
 * judged: blurry, compressed footage raises them without the matte being
 * wrong.
 *
 * Measured (stray avg / frames over 0.08): a clean talking head (IMG_2723)
 * 0.000 / 0.00 -> sure; a church stage behind a glass podium
 * (public/__test/speaker-small.mp4, frames 60-240) 0.074 / 0.19 -> unsure,
 * and its matte was patchy (body apart from the head); other stretches of
 * the same stage 0.000-0.010 / 0.00-0.07, whose matte was right. Tune from
 * the [doubt] lines in the worker's log.
 */
export const DOUBT_LIMITS = {
  /** Average stray share of the person's area. */
  stray: 0.02,
  /** Share of frames with a stray share over 0.08. */
  strayFrames: 0.15,
};

export class MatteDoubt {
  constructor(mw, mh) {
    this.gw = Math.ceil(mw / STEP);
    this.gh = Math.ceil(mh / STEP);
    this.mw = mw;
    this.mh = mh;
    const n = this.gw * this.gh;
    this.cur = new Uint8Array(n);
    this.prev = null;
    this.label = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.frames = 0;
    this.sum = { stray: 0, soft: 0, flicker: 0 };
    this.strayFrames = 0;
    this.flickerFrames = 0;
  }

  /** One frame of RVM's matte (0-1 per pixel, mw x mh). */
  add(pha) {
    const { gw, gh, mw, cur, label, queue } = this;
    const n = gw * gh;
    let area = 0;
    let soft = 0;
    for (let gy = 0; gy < gh; gy++) {
      const row = gy * STEP * mw;
      for (let gx = 0; gx < gw; gx++) {
        const v = pha[row + gx * STEP];
        const i = gy * gw + gx;
        const on = v > SURE ? 1 : 0;
        cur[i] = on;
        area += on;
        if (v > SOFT_LO && v < SOFT_HI) soft++;
      }
    }
    if (area < 4) {
      // No speaker in this frame: nothing to judge.
      this.prev = null;
      return;
    }

    // Joined pieces of the matte (four neighbours).
    label.fill(0);
    let pieces = 0;
    let biggest = 0;
    const sizes = [0];
    const bottoms = [false];
    for (let s = 0; s < n; s++) {
      if (!cur[s] || label[s]) continue;
      pieces++;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      label[s] = pieces;
      let size = 0;
      let bottom = false;
      while (head < tail) {
        const i = queue[head++];
        size++;
        const x = i % gw;
        const y = (i - x) / gw;
        if (y === gh - 1) bottom = true;
        const nb = [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1];
        for (const j of nb) {
          if (j >= 0 && cur[j] && !label[j]) {
            label[j] = pieces;
            queue[tail++] = j;
          }
        }
      }
      sizes.push(size);
      bottoms.push(bottom);
      if (size > sizes[biggest]) biggest = pieces;
    }
    let stray = 0;
    for (let p = 1; p <= pieces; p++) {
      if (p !== biggest && !bottoms[p] && sizes[p] >= MIN_PIECE) stray += sizes[p];
    }
    const strayShare = stray / area;

    let flicker = 0;
    if (this.prev) {
      let changed = 0;
      for (let i = 0; i < n; i++) if (cur[i] !== this.prev[i]) changed++;
      flicker = changed / area;
      this.sum.flicker += flicker;
      this.flickerFrames++;
    }
    this.prev = this.prev ?? new Uint8Array(n);
    this.prev.set(cur);

    this.frames++;
    this.sum.stray += strayShare;
    this.sum.soft += soft / area;
    if (strayShare > 0.08) this.strayFrames++;
  }

  /** The stretch's averages. */
  summary() {
    const f = Math.max(1, this.frames);
    return {
      frames: this.frames,
      stray: this.sum.stray / f,
      strayFrames: this.strayFrames / f,
      soft: this.sum.soft / f,
      flicker: this.sum.flicker / Math.max(1, this.flickerFrames),
    };
  }
}

/** Why a stretch's matte looks unsure, or null when it looks fine. */
export function doubtReason(s, limits = DOUBT_LIMITS) {
  if (!s.frames) return null;
  const why = [];
  if (s.stray > limits.stray) why.push(`stray ${s.stray.toFixed(3)}`);
  if (s.strayFrames > limits.strayFrames) why.push(`stray frames ${s.strayFrames.toFixed(2)}`);
  return why.length ? why.join(", ") : null;
}

export const describeDoubt = (s) =>
  `stray ${s.stray.toFixed(3)} (frames ${s.strayFrames.toFixed(2)}), soft ${s.soft.toFixed(2)}, flicker ${s.flicker.toFixed(2)}, ${s.frames} frames`;
