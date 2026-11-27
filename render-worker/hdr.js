// HDR footage (iPhone 12 and later record HLG by default; some phones and
// cameras PQ) turned into normal video before anything else touches it: the
// export, the editor's preview copies, the preview cut-outs and the colour
// sheets. Without this, an HDR clip was read as if it were normal video:
// flat and washed out (colour down to 59% on HLG, 34% on PQ, measured on a
// test clip made to the broadcast standard, 2026-11-27).
//
// How: decoded to linear light with normal white at 203 nits (BT.2408: 75%
// of the HLG signal, 58% of PQ, which phones follow), moved from the wide
// BT.2020 colours to normal ones, then a Mobius curve: everything up to
// normal white stays as filmed, brighter highlights (sky, windows, lamps)
// roll off smoothly instead of flattening to white. Normal (SDR) clips are
// never touched.

/**
 * Whether this ffmpeg has the filters (zscale, tonemap): checked once at
 * start (checkHdrSupport). Without them HDR is left as it was, never failing
 * an export.
 */
let supported = true;

/** Checks this ffmpeg for the filters HDR needs; returns whether it has them. */
export function checkHdrSupport(spawnSync, ffmpegPath) {
  try {
    const out = String(spawnSync(ffmpegPath, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout ?? "");
    supported = /\szscale\s/.test(out) && /\stonemap\s/.test(out);
  } catch {
    supported = false;
  }
  if (!supported) console.warn("[hdr] This ffmpeg has no zscale/tonemap: HDR footage won't be tone-mapped");
  return supported;
}

/** The transfer curves that mean HDR. */
const HDR_TRANSFERS = new Set(["arib-std-b67", "smpte2084"]);
/** Normal white in HDR footage (nits): BT.2408. */
const SDR_WHITE_NITS = 203;
/**
 * Where the highlight roll-off starts (tonemap's Mobius parameter). Tried on
 * a ramp to 1000 nits: 0.3 put white at 216 of 255, 0.85 left highlights no
 * room (400, 800 and 1000 nits all 254-255); 0.6 keeps white near 234 with
 * visible steps above it.
 */
const ROLL_OFF = 0.6;
/** How much the brightest highlights lose their colour (0: none). */
const HIGHLIGHT_DESAT = 0.5;

/**
 * The colour tags in ffmpeg's description of a video stream: ("tv,
 * bt2020nc/bt2020/arib-std-b67") or ("tv, bt709", one name for all three).
 * { matrix, primaries, transfer }, each null when not stated.
 */
export function colourTags(streamLine) {
  const m = /Video:.*?\b(?:yuv|gbr|rgb|gray|nv|p0)[\w]*\((?:tv|pc)?,?\s*([\w-]+)(?:\/([\w-]+)\/([\w-]+))?/.exec(
    streamLine ?? "",
  );
  if (!m) return { matrix: null, primaries: null, transfer: null };
  if (!m[2]) return { matrix: m[1], primaries: m[1], transfer: m[1] };
  return { matrix: m[1], primaries: m[2], transfer: m[3] };
}

/** Whether the colour tags (colourTags) are HDR. */
export const isHdr = (tags) => HDR_TRANSFERS.has(tags?.transfer ?? "");

/**
 * The filters that turn HDR footage into normal video (BT.709, video
 * levels, 8-bit), to go first in a video's filter chain; null for normal
 * footage.
 */
export function hdrToSdr(tags) {
  if (!supported || !isHdr(tags)) return null;
  const pin = tags.primaries && tags.primaries !== "unknown" ? tags.primaries : "bt2020";
  const min = tags.matrix && tags.matrix !== "unknown" ? tags.matrix : "bt2020nc";
  return [
    `zscale=tin=${tags.transfer}:pin=${pin}:min=${min}:t=linear:npl=${SDR_WHITE_NITS}`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    `tonemap=mobius:param=${ROLL_OFF}:desat=${HIGHLIGHT_DESAT}`,
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ].join(",");
}

/** A file's (or link's) colour tags, read from ffmpeg's description of it. */
export function probeColour(spawn, ffmpegPath, file) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", () => resolve(colourTags("")));
    child.on("close", () => resolve(colourTags(err.split("\n").find((l) => /Stream #.*Video:/.test(l)))));
  });
}
