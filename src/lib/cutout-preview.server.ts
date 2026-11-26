// The editor preview's cut-outs (see cutout-preview.ts): which are saved,
// and asking the render worker (/cutout) for the missing ones, in the
// background, once per stretch per server every ASK_AGAIN_MS (another tab
// or a refresh doesn't ask again while one is being made).

import {
  covers,
  cutoutPath,
  cutoutPieces,
  parseCutoutName,
  type CutoutStretch,
  type PreviewCutout,
} from "@/lib/cutout-preview";

const ASK_AGAIN_MS = 15 * 60 * 1000;
const asked = new Map<string, number>();
/** Pieces the worker can't make (no Pixelcut, an old worker), until when. */
const refused = new Map<string, number>();

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin.storage.from("raw-clips");
}

/** The cut-outs saved for a file. */
async function savedFor(path: string): Promise<CutoutStretch[]> {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const name = path.slice(slash + 1);
  const storage = await admin();
  const { data } = await storage.list(folder, { search: `${name}.cutout.`, limit: 200 });
  return (data ?? []).flatMap((f) => {
    if (!f.name.startsWith(`${name}.cutout.`)) return [];
    const at = parseCutoutName(f.name);
    return at ? [{ path, ...at }] : [];
  });
}

/** Starts making one piece's cut-out; never throws. */
async function requestCutout(piece: CutoutStretch): Promise<void> {
  const key = cutoutPath(piece);
  if (Date.now() - (asked.get(key) ?? 0) < ASK_AGAIN_MS) return;
  asked.set(key, Date.now());
  try {
    const { workerSecret } = await import("@/lib/worker-secret");
    const secret = workerSecret();
    if (!secret || !process.env.RENDER_WORKER_URL?.trim()) {
      refused.set(key, Date.now() + ASK_AGAIN_MS);
      return;
    }
    const { hmacHex, workerEndpoint } = await import("@/lib/motion-plan.functions");
    const storage = await admin();
    const [{ data: source }, { data: upload }] = await Promise.all([
      storage.createSignedUrl(piece.path, 60 * 60 * 2),
      storage.createSignedUploadUrl(key, { upsert: true }),
    ]);
    if (!source?.signedUrl || !upload?.signedUrl) return;
    const body = JSON.stringify({
      path: piece.path,
      from_ms: piece.fromMs,
      to_ms: piece.toMs,
      source_url: source.signedUrl,
      upload_url: upload.signedUrl,
    });
    const res = await fetch(workerEndpoint("cutout").toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stuccord-signature": await hmacHex(secret, body),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    // An older worker (404) or one without Pixelcut (503): the preview keeps
    // its own cut-out; asked again much later.
    if (res.status !== 202) {
      console.warn(`[cutout-preview] The worker didn't take ${key}: HTTP ${res.status}`);
      asked.set(key, Date.now() + ASK_AGAIN_MS * 4);
      refused.set(key, Date.now() + ASK_AGAIN_MS * 5);
    }
  } catch (e) {
    console.warn(`[cutout-preview] Couldn't ask for ${key}:`, e);
  }
}

/**
 * The saved cut-outs for the stretches (with links), and how many pieces
 * are still being made (asked for now, if they weren't already).
 */
export async function previewCutouts(
  stretches: CutoutStretch[],
): Promise<{ cutouts: PreviewCutout[]; waiting: number; unavailable: number }> {
  const byPath = new Map<string, CutoutStretch[]>();
  for (const s of stretches) byPath.set(s.path, [...(byPath.get(s.path) ?? []), s]);
  const storage = await admin();
  const cutouts: PreviewCutout[] = [];
  let waiting = 0;
  // Pieces that won't come (the worker can't make them): the editor uses its own cut-out.
  let unavailable = 0;
  for (const [path, wanted] of byPath) {
    const saved = await savedFor(path);
    const used = new Set<CutoutStretch>();
    for (const s of wanted) {
      for (const piece of cutoutPieces(s)) {
        // A saved one holding this piece (or the stretch's own part of it).
        const part = {
          path,
          fromMs: Math.max(piece.fromMs, s.fromMs),
          toMs: Math.min(piece.toMs, s.toMs),
        };
        const have = saved.find((c) => covers(c, part));
        if (have) used.add(have);
        else if ((refused.get(cutoutPath(piece)) ?? 0) > Date.now()) unavailable++;
        else {
          waiting++;
          void requestCutout(piece);
        }
      }
    }
    for (const c of used) {
      const { data } = await storage.createSignedUrl(cutoutPath(c), 3600);
      if (data?.signedUrl) cutouts.push({ ...c, url: data.signedUrl });
    }
  }
  return { cutouts, waiting, unavailable };
}

/** Removes the files' saved cut-outs (their files are going); never throws. */
export async function removeCutouts(paths: string[]): Promise<void> {
  try {
    const all = (await Promise.all(paths.map(savedFor))).flat().map(cutoutPath);
    const storage = await admin();
    for (let i = 0; i < all.length; i += 500) {
      const { error } = await storage.remove(all.slice(i, i + 500));
      if (error) console.error("[cutout-preview] Failed to delete cut-outs:", error.message);
    }
  } catch (e) {
    console.error("[cutout-preview] Failed to delete cut-outs:", e);
  }
}

/**
 * The files' saved cut-outs with links good for `seconds`, for the export
 * (the worker reuses them: render-worker/pixelcut.js savedMatte). Never throws.
 */
export async function savedCutoutLinks(
  paths: string[],
  seconds: number,
): Promise<Map<string, { from_ms: number; to_ms: number; url: string }[]>> {
  const out = new Map<string, { from_ms: number; to_ms: number; url: string }[]>();
  try {
    const storage = await admin();
    for (const path of new Set(paths)) {
      const saved = await savedFor(path);
      if (!saved.length) continue;
      const { data } = await storage.createSignedUrls(saved.map(cutoutPath), seconds);
      const links = saved.flatMap((c, i) => {
        const url = data?.[i]?.signedUrl;
        return url ? [{ from_ms: c.fromMs, to_ms: c.toMs, url }] : [];
      });
      if (links.length) out.set(path, links);
    }
  } catch (e) {
    console.warn("[cutout-preview] Couldn't link the saved cut-outs:", e);
  }
  return out;
}
