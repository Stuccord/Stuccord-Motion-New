// Higgsfield's API (server only: uses HF_API_KEY_ID and HF_API_KEY_SECRET).
// A generation is a queued request: submit it, then check its status until
// it's done, and fetch the result from the link it gives (Higgsfield deletes
// results after 7 days, so callers keep their own copy). Pictures we already
// have go up through Higgsfield's own upload links, so our storage stays
// private. Failed and turned-down requests aren't charged.
// Docs: https://docs.higgsfield.ai (auth, requests, polling, file uploads, errors).

const BASE = "https://api.higgsfield.ai";

/** A problem the user can act on; its message is shown as is. */
export class HiggsfieldError extends Error {
  /** True for a network failure or a 5xx/429: worth trying the same call again. */
  transient = false;
}

const isTransient = (e: HiggsfieldError) => e.transient;

function transientError(message: string): HiggsfieldError {
  const e = new HiggsfieldError(message);
  e.transient = true;
  return e;
}

export type Bytes = { data: Uint8Array; mimeType: string };

/** A request's state (the terminal ones: completed, failed, nsfw, canceled). */
export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export type HfResult = {
  status: HfStatus;
  request_id: string;
  images?: { url: string }[];
  video?: { url: string };
};

type Fetch = typeof fetch;

/** True when the server has a Higgsfield key. */
export function hasHiggsfieldKey(): boolean {
  return Boolean(process.env.HF_API_KEY_ID?.trim() && process.env.HF_API_KEY_SECRET?.trim());
}

function authHeader(): string {
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (!id || !secret) {
    throw new HiggsfieldError(
      "AI generation isn't set up yet (HF_API_KEY_ID / HF_API_KEY_SECRET are missing on the server).",
    );
  }
  return `Key ${id}:${secret}`;
}

/** Plain words for an error answer; logs the details for us. */
function explain(status: number, body: unknown, what: string): HiggsfieldError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const text = typeof detail === "string" ? detail : JSON.stringify(detail ?? body ?? "");
  console.warn(`[higgsfield] ${what} → ${status}:`, text.slice(0, 300));
  if (status === 401) return new HiggsfieldError("Higgsfield didn't accept the server's API key.");
  if (status === 403) {
    return new HiggsfieldError("AI generation is paused: the Higgsfield balance has run out.");
  }
  if (status === 429) {
    return transientError("The AI service is busy right now. Try again in a minute.");
  }
  if (status === 423 || status === 503) {
    return transientError("This AI model is unavailable right now. Try again later.");
  }
  if (status === 400 || status === 422) {
    return new HiggsfieldError(
      "The AI service couldn't use this request. Try describing it differently.",
    );
  }
  if (status >= 500) return transientError("The AI service had a problem. Try again in a moment.");
  return new HiggsfieldError("The AI service had a problem. Try again in a moment.");
}

async function call(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
  fetchFn: Fetch,
  what: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(`${BASE}/${path.replace(/^\//, "")}`, {
      method: init.method,
      headers: {
        Authorization: authHeader(),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    if (e instanceof HiggsfieldError) throw e;
    console.warn(`[higgsfield] ${what} failed:`, e);
    throw transientError("Couldn't reach the AI service. Try again in a moment.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw explain(res.status, body, what);
  return body;
}

/** Puts a picture where Higgsfield can read it; returns its link. */
export async function uploadToHiggsfield(file: Bytes, fetchFn: Fetch = fetch): Promise<string> {
  const contentType = file.mimeType === "image/jpg" ? "image/jpeg" : file.mimeType;
  const slot = (await call(
    "files/generate-upload-url",
    { method: "POST", body: { content_type: contentType } },
    fetchFn,
    "upload link",
  )) as { public_url?: string; upload_url?: string; upload_headers?: Record<string, string> };
  if (!slot?.upload_url || !slot.public_url) {
    throw new HiggsfieldError("The AI service didn't give an upload link. Try again in a moment.");
  }
  // The storage link is pre-signed: no API key goes to it.
  let put: Response;
  try {
    put = await fetchFn(slot.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType, ...(slot.upload_headers ?? {}) },
      body: new Uint8Array(file.data),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    console.warn("[higgsfield] upload failed:", e);
    throw new HiggsfieldError("Couldn't send the picture to the AI service. Try again.");
  }
  if (!put.ok) {
    console.warn("[higgsfield] upload →", put.status);
    throw new HiggsfieldError("Couldn't send the picture to the AI service. Try again.");
  }
  return slot.public_url;
}

/** Queues a generation; returns its request id. */
export async function submitGeneration(
  endpoint: string,
  input: Record<string, unknown>,
  fetchFn: Fetch = fetch,
): Promise<string> {
  const answer = (await call(
    endpoint,
    { method: "POST", body: input, idempotencyKey: crypto.randomUUID() },
    fetchFn,
    `submit ${endpoint}`,
  )) as { request_id?: string };
  if (!answer?.request_id) {
    throw new HiggsfieldError("The AI service didn't take the request. Try again in a moment.");
  }
  return answer.request_id;
}

/** A request's current state. */
export async function generationStatus(
  requestId: string,
  fetchFn: Fetch = fetch,
): Promise<HfResult> {
  return (await call(
    `requests/${encodeURIComponent(requestId)}/status`,
    { method: "GET" },
    fetchFn,
    "status",
  )) as HfResult;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Waits for a request to finish (checks at 2 s, then 1.5× longer each time up
 * to 10 s); throws with a message the user can act on when it doesn't succeed.
 */
export async function waitForGeneration(
  requestId: string,
  timeoutMs: number,
  fetchFn: Fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<HfResult> {
  const until = Date.now() + timeoutMs;
  let delay = 2000;
  // A status check that hits a network blip or a 5xx is retried (Higgsfield's
  // polling guide): the picture is already being made and paid for, so one
  // dropped check mustn't throw it away. A run of 5 failures in a row ends it.
  let misses = 0;
  for (;;) {
    await wait(delay + Math.random() * 300);
    let result: HfResult;
    try {
      result = await generationStatus(requestId, fetchFn);
      misses = 0;
    } catch (e) {
      if (!(e instanceof HiggsfieldError) || !isTransient(e) || ++misses >= 5) throw e;
      if (Date.now() + delay > until) {
        throw new HiggsfieldError("The AI service is taking too long. Try again in a moment.");
      }
      delay = Math.min(10_000, delay * 1.5);
      continue;
    }
    if (result.status === "completed") return result;
    if (result.status === "nsfw") {
      throw new HiggsfieldError(
        "The AI service turned this description down. Try describing it differently.",
      );
    }
    if (result.status === "failed" || result.status === "canceled") {
      throw new HiggsfieldError("The AI service couldn't make this one. Try again.");
    }
    if (Date.now() + delay > until) {
      throw new HiggsfieldError("The AI service is taking too long. Try again in a moment.");
    }
    delay = Math.min(10_000, delay * 1.5);
  }
}

/** The price of a request in US dollars (nothing is charged for asking). */
export async function estimateUsd(
  endpoint: string,
  input: Record<string, unknown>,
  fetchFn: Fetch = fetch,
): Promise<number | null> {
  const answer = (await call(
    `estimate/${endpoint}`,
    { method: "POST", body: input },
    fetchFn,
    `estimate ${endpoint}`,
  )) as { usd?: string | number };
  const usd = Number(answer?.usd);
  return Number.isFinite(usd) ? usd : null;
}

/**
 * Downloads a finished result. A 2K picture is about 5 MB, so the whole
 * download (the file itself included, not just its first answer) gets a few
 * minutes on a slow connection; a stalled one fails with a message, not a crash.
 */
export async function fetchResult(url: string, fetchFn: Fetch = fetch): Promise<Bytes> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) {
      console.warn("[higgsfield] download →", res.status);
      throw new HiggsfieldError("Couldn't fetch the result from the AI service. Try again.");
    }
    const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType };
  } catch (e) {
    if (e instanceof HiggsfieldError) throw e;
    console.warn("[higgsfield] download failed:", e);
    throw new HiggsfieldError("Couldn't fetch the result from the AI service. Try again.");
  }
}
