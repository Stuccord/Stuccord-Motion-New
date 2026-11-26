// Downloads a clip's file once, in pieces, into memory, for the live preview.
//
// The browser's own video download can hang for good on a shaky connection
// (one request stops sending and is never given up on), leaving the preview
// on "Loading…". Here every piece has a time limit: one that goes quiet is
// dropped and asked for again from where it stopped. Once the whole file is
// in, every clip cut from it plays from that one copy, so cuts and replays
// need no more internet.
//
// Files are kept by storage path for the session (until the page is
// reloaded), the oldest let go once they take up too much memory. Files over
// MAX_BYTES aren't downloaded: they play straight from the link as before.

import { useEffect, useRef, useSyncExternalStore } from "react";

/** Bigger files stream from their link (holding them would take too much memory). */
const MAX_BYTES = 300 * 1024 * 1024;
/** All files held together; the oldest are let go past this. */
const MAX_TOTAL_BYTES = 700 * 1024 * 1024;
/** One piece of the file per request. */
const PIECE_BYTES = 1024 * 1024;
/** A request that sends nothing for this long is dropped and asked again. */
const QUIET_MS = 15_000;

type Entry = {
  /** too-big and failed: not held; the file plays from its link. */
  state: "downloading" | "done" | "too-big" | "failed";
  /** Bytes in so far (also when the size isn't known). */
  received?: number;
  /** 0-1, once the size is known. */
  progress: number;
  /** The file in memory (done only). */
  objectUrl?: string;
  bytes: number;
  usedAt: number;
};

const entries = new Map<string, Entry>();
// In development, readable from the browser console: window.__clipDownloads.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __clipDownloads: Map<string, Entry> }).__clipDownloads = entries;
}
/** The latest link for each file (they're renewed), read before each piece. */
const links = new Map<string, string>();
/** Asks the editor for a fresh link (the old one stopped working). */
const askFresh = new Map<string, () => void>();
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
  version++;
  for (const l of listeners) l();
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lets go of the oldest finished files until all of them fit. */
function trim(keep: Set<string>) {
  let total = 0;
  for (const e of entries.values()) total += e.state === "done" ? e.bytes : 0;
  const oldest = [...entries.entries()]
    .filter(([path, e]) => e.state === "done" && !keep.has(path))
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [path, e] of oldest) {
    if (total <= MAX_TOTAL_BYTES) break;
    total -= e.bytes;
    if (e.objectUrl) URL.revokeObjectURL(e.objectUrl);
    entries.delete(path);
  }
}

/**
 * One request for bytes `from`..`to` (inclusive), read as it arrives.
 * Dropped when it goes quiet for QUIET_MS. Returns the bytes and the file's
 * total size (from the reply), or throws.
 */
async function fetchPiece(
  url: string,
  from: number,
  to: number,
  /** Bytes of this piece so far, as they arrive. */
  onBytes?: (n: number) => void,
): Promise<{ data: Uint8Array; total: number | null; type: string | null; whole: boolean }> {
  const ctl = new AbortController();
  let quiet = setTimeout(() => ctl.abort(), QUIET_MS);
  const heard = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => ctl.abort(), QUIET_MS);
  };
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=${from}-${to}` },
      signal: ctl.signal,
      // The browser's cache may hold a half-written copy of a hung request.
      cache: "no-store",
    });
    heard();
    if (res.status !== 206 && res.status !== 200) {
      const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    // A 200 is the whole file (the server ignored the range).
    const whole = res.status === 200;
    const range = res.headers.get("content-range"); // bytes 0-1048575/3800000
    const total = whole
      ? Number(res.headers.get("content-length")) || null
      : Number(range?.split("/")[1]) || null;
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { data: buf, total, type: res.headers.get("content-type"), whole };
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      heard();
      parts.push(value);
      size += value.length;
      onBytes?.(size);
    }
    const data = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      data.set(p, at);
      at += p.length;
    }
    return { data, total, type: res.headers.get("content-type"), whole };
  } finally {
    clearTimeout(quiet);
  }
}

async function download(path: string, knownSize: number | null, urgent: boolean) {
  const entry = entries.get(path)!;
  const pieces: Uint8Array[] = [];
  let have = 0;
  // The size saved with the clip (the reply's own size header is hidden
  // from the page by the storage server's CORS rules).
  let total: number | null = knownSize && knownSize > 0 ? knownSize : null;
  if (total != null && total > MAX_BYTES) {
    entry.state = "too-big";
    changed();
    return;
  }
  let type: string | null = null;
  let failures = 0;
  while (total == null || have < total) {
    if (entries.get(path) !== entry) return; // let go meanwhile
    // The footage first: wait while any of it is downloading.
    if (!urgent && urgentRunning > 0) {
      await wait(500);
      continue;
    }
    const url = links.get(path);
    if (!url) {
      await wait(1000);
      continue;
    }
    try {
      let lastShown = 0;
      const piece = await fetchPiece(url, have, have + PIECE_BYTES - 1, (n) => {
        // Shown as it arrives (a slow piece can take a minute), a few times a second.
        entry.received = have + n;
        const now = performance.now();
        if (!total || now - lastShown < 250) return;
        lastShown = now;
        entry.progress = Math.min(1, (have + n) / total);
        changed();
      });
      if (piece.whole) {
        pieces.length = 0;
        have = 0;
      }
      total = piece.whole ? piece.data.length : (piece.total ?? total);
      type = piece.type ?? type;
      if (total != null && total > MAX_BYTES) {
        entry.state = "too-big";
        changed();
        return;
      }
      pieces.push(piece.data);
      have += piece.data.length;
      // Ran short: that was the end (when the size isn't known, or was off).
      if (!piece.whole && piece.data.length < PIECE_BYTES && (total == null || have < total)) {
        if (piece.data.length === 0) throw new Error("empty piece");
        total = have;
      }
      if (total == null && have > MAX_BYTES) {
        entry.state = "too-big";
        changed();
        return;
      }
      failures = 0;
      entry.progress = total ? Math.min(1, have / total) : 0;
      changed();
    } catch (e) {
      const status = (e as { status?: number }).status;
      // Asked for bytes past the end: the file ended exactly at a piece.
      if (status === 416 && have > 0) {
        total = have;
        continue;
      }
      // The file isn't there: give up (it plays from its link, as before).
      if (status === 404 || (status != null && status >= 400 && failures >= 5)) {
        entry.state = "failed";
        changed();
        return;
      }
      failures++;
      // An expired or refused link: ask for a fresh one (it arrives in `links`).
      if (status === 400 || status === 401 || status === 403) askFresh.get(path)?.();
      if (failures === 1 || failures % 5 === 0) {
        console.warn("[preview] Clip download piece failed; trying again", {
          path,
          at: have,
          of: total,
          try: failures,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await wait(Math.min(1000 * 2 ** Math.min(failures - 1, 4), 15_000));
    }
  }
  if (entries.get(path) !== entry) return;
  const blob = new Blob(pieces as BlobPart[], { type: type ?? "video/mp4" });
  entry.objectUrl = URL.createObjectURL(blob);
  entry.bytes = blob.size;
  entry.state = "done";
  entry.progress = 1;
  entry.usedAt = Date.now();
  changed();
  trim(new Set([path]));
}

/**
 * The more urgent files first: the footage before story clips. On a slow
 * connection everything downloading at once makes each as slow as all of
 * them together, so:
 * - footage (priority > 0) starts at once, however many files are going;
 * - story clips go AT_ONCE at a time, and pause between pieces while any
 *   footage is downloading (they may have started first, their links
 *   being ready sooner).
 */
const AT_ONCE = 2;
const waiting: { path: string; size: number | null }[] = [];
let lowRunning = 0;
/** Footage files downloading now. */
let urgentRunning = 0;

function next() {
  while (lowRunning < AT_ONCE && waiting.length) {
    const job = waiting.shift()!;
    lowRunning++;
    void download(job.path, job.size, false).finally(() => {
      lowRunning--;
      next();
    });
  }
}

/** Starts downloading a file, if it isn't held or on its way already. */
function ensure(path: string, size: number | null, priority: number) {
  const e = entries.get(path);
  if (e) {
    e.usedAt = Date.now();
    return;
  }
  entries.set(path, { state: "downloading", progress: 0, bytes: 0, usedAt: Date.now() });
  changed();
  if (priority > 0) {
    urgentRunning++;
    void download(path, size, true).finally(() => {
      urgentRunning--;
    });
  } else {
    waiting.push({ path, size });
    next();
  }
}

export type LocalClip = { url?: string; progress: number; state: Entry["state"] };

/**
 * The clips' files from memory, by storage path: `url` once a file is fully
 * in (play from it), and how far each download is. Starts downloading each
 * file once it has a signed link (renewed links are picked up).
 */
export function useLocalClips(
  files: { storage_path: string; size_bytes: number | null }[],
  signedLinks: Record<string, string>,
  onFreshLinkNeeded?: (path: string) => void,
  /** Higher downloads first (the footage: 1; story clips: 0). */
  priority = 0,
): Record<string, LocalClip> {
  const freshRef = useRef(onFreshLinkNeeded);
  freshRef.current = onFreshLinkNeeded;
  const sizes = new Map(files.map((f) => [f.storage_path, f.size_bytes]));
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const key = [...sizes.keys()].sort().join("\n");
  useEffect(() => {
    for (const path of key ? key.split("\n") : []) {
      const link = signedLinks[path];
      if (!link) continue;
      links.set(path, link);
      askFresh.set(path, () => freshRef.current?.(path));
      ensure(path, sizesRef.current.get(path) ?? null, priority);
    }
  }, [key, signedLinks, priority]);
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  const out: Record<string, LocalClip> = {};
  for (const path of key ? key.split("\n") : []) {
    const e = entries.get(path);
    if (e) out[path] = { url: e.objectUrl, progress: e.progress, state: e.state };
  }
  return out;
}
