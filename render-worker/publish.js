// Posting finished exports to social platforms, and the once-a-minute tick
// that tells the app to send scheduled posts.
//
// The app signs each /publish request (like /jobs) and sends a short-lived
// access token for the account, a signed link to the video (and cover), and
// where to report back. Nothing here is stored: the video goes to a temp
// file, is uploaded, and is deleted.

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UPLOADS_AT_ONCE = 2;
const TICK_EVERY_MS = 60 * 1000;

const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

export function validatePublishPayload(p) {
  if (!p || typeof p !== "object") return "Payload must be an object";
  if (typeof p.post_id !== "string" || !UUID.test(p.post_id)) return "Invalid post_id";
  if (p.platform !== "youtube") return "Posting there isn't supported yet";
  if (typeof p.access_token !== "string" || !p.access_token) return "Missing access_token";
  if (!isHttpUrl(p.video_url)) return "Invalid video_url";
  if (p.cover_url != null && !isHttpUrl(p.cover_url)) return "Invalid cover_url";
  if (!isHttpUrl(p.callback_url)) return "Invalid callback_url";
  if (typeof p.title !== "string" || !p.title.trim()) return "Missing title";
  if (!["public", "unlisted", "private"].includes(p.privacy)) return "Invalid privacy";
  return null;
}

/** Streams a link to a file, returning its type. */
async function downloadTo(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error(`Couldn't get the video (${r.status})`);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
  return r.headers.get("content-type") || "";
}

// ---------- YouTube ----------

const YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

/** A readable message for a YouTube API error. */
async function youtubeError(res) {
  const j = await res.json().catch(() => null);
  const reason = j?.error?.errors?.[0]?.reason || "";
  const message = j?.error?.message || `error ${res.status}`;
  if (res.status === 401) return "YouTube stopped accepting this sign-in. Reconnect the channel.";
  if (reason === "quotaExceeded") return "YouTube's daily upload allowance for Stuccord is used up. Try again tomorrow.";
  if (reason === "uploadLimitExceeded") return "This channel has hit YouTube's upload limit for today.";
  if (reason === "youtubeSignupRequired") return "This Google account needs a YouTube channel first.";
  return `YouTube: ${message}`.slice(0, 400);
}

async function youtubeUpload(p, file, size, type, log) {
  const auth = { authorization: `Bearer ${p.access_token}` };
  const init = await fetch(`${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(size),
      "x-upload-content-type": type,
    },
    body: JSON.stringify({
      snippet: {
        title: p.title.slice(0, 100),
        description: String(p.caption || "").slice(0, 5000),
        categoryId: "22",
      },
      status: {
        privacyStatus: p.privacy,
        selfDeclaredMadeForKids: !!p.made_for_kids,
        embeddable: true,
      },
    }),
    signal: AbortSignal.timeout(60 * 1000),
  });
  if (!init.ok) throw new Error(await youtubeError(init));
  const session = init.headers.get("location");
  if (!session) throw new Error("YouTube didn't start the upload");

  // Send the file; if the connection drops or YouTube has a hiccup, ask how
  // much arrived and carry on from there.
  let offset = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(session, {
        method: "PUT",
        headers: {
          ...auth,
          "content-length": String(size - offset),
          "content-type": type,
          ...(offset > 0 ? { "content-range": `bytes ${offset}-${size - 1}/${size}` } : {}),
        },
        body: Readable.toWeb(fs.createReadStream(file, { start: offset })),
        duplex: "half",
        signal: AbortSignal.timeout(2 * 60 * 60 * 1000),
      });
      if (res.ok) {
        const video = await res.json();
        if (!video?.id) throw new Error("YouTube didn't return the video");
        return video.id;
      }
      if (res.status < 500 && res.status !== 308) throw Object.assign(new Error(await youtubeError(res)), { final: true });
      log(`upload interrupted (${res.status}), resuming`);
    } catch (e) {
      if (e.final) throw e;
      log(`upload interrupted (${e?.message || e}), resuming`);
    }
    await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt)));
    const check = await fetch(session, {
      method: "PUT",
      headers: { ...auth, "content-length": "0", "content-range": `bytes */${size}` },
      signal: AbortSignal.timeout(60 * 1000),
    }).catch(() => null);
    if (check?.ok) {
      const video = await check.json().catch(() => null);
      if (video?.id) return video.id;
    }
    if (check?.status === 308) {
      const range = check.headers.get("range");
      offset = range ? Number(range.split("-")[1]) + 1 : 0;
    } else if (check && check.status >= 400 && check.status < 500) {
      throw new Error(await youtubeError(check));
    }
  }
  throw new Error("The upload to YouTube kept failing. Try again later.");
}

/** Sets the video's cover. Needs a verified channel, so a failure is only logged. */
async function youtubeCover(p, videoId, log) {
  try {
    const img = await fetch(p.cover_url, { signal: AbortSignal.timeout(60 * 1000) });
    if (!img.ok) return;
    const res = await fetch(`${YT_UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${p.access_token}`,
        "content-type": img.headers.get("content-type") || "image/jpeg",
      },
      body: Buffer.from(await img.arrayBuffer()),
      signal: AbortSignal.timeout(60 * 1000),
    });
    if (!res.ok) log(`cover not set: ${await youtubeError(res)}`);
  } catch (e) {
    log(`cover not set: ${e?.message || e}`);
  }
}

// ---------- the endpoint and the tick ----------

export function registerPublishing(app, { verifySignature, callback, signBody }) {
  let uploading = 0;

  app.post("/publish", (req, res) => {
    if (!verifySignature(req)) return res.status(401).send("bad signature");
    const p = req.body;
    const invalid = validatePublishPayload(p);
    if (invalid) return res.status(400).json({ ok: false, error: invalid });
    if (uploading >= MAX_UPLOADS_AT_ONCE) {
      res.setHeader("Retry-After", "60");
      return res.status(503).json({ ok: false, error: "Worker is busy" });
    }
    uploading++;
    res.status(202).json({ ok: true });

    const log = (m) => console.log(`[Publish ${p.post_id}] ${m}`);
    (async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "stuccord-post-"));
      try {
        await callback(p.callback_url, { post_id: p.post_id, status: "uploading" });
        const file = path.join(dir, "video");
        const type = (await downloadTo(p.video_url, file)).split(";")[0].trim();
        const { size } = await fsp.stat(file);
        if (!size) throw new Error("The video file is empty");
        log(`uploading ${(size / 1e6).toFixed(1)} MB to YouTube`);
        const id = await youtubeUpload(p, file, size, type.startsWith("video/") ? type : "video/mp4", log);
        if (p.cover_url) await youtubeCover(p, id, log);
        log(`posted ${id}`);
        await callback(p.callback_url, {
          post_id: p.post_id,
          status: "published",
          external_id: id,
          external_url: `https://www.youtube.com/watch?v=${id}`,
        });
      } catch (e) {
        log(`failed: ${e?.message || e}`);
        await callback(p.callback_url, {
          post_id: p.post_id,
          status: "failed",
          error: String(e?.message || e).slice(0, 400),
        });
      } finally {
        uploading--;
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    })();
  });

  // Once a minute, ask the app to send posts that are due (and update view
  // counts). Needs PUBLIC_APP_URL; without it, only "Post now" works.
  const appUrl = process.env.PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    console.warn("[Worker] PUBLIC_APP_URL not set: scheduled posts won't go out");
    return;
  }
  let tickUrl;
  try {
    tickUrl = new URL("/api/public/publishing-tick", new URL(appUrl).origin).toString();
  } catch {
    console.warn("[Worker] PUBLIC_APP_URL isn't a valid address: scheduled posts won't go out");
    return;
  }
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const body = JSON.stringify({ at: new Date().toISOString() });
      const r = await fetch(tickUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-stuccord-signature": signBody(body) },
        body,
        signal: AbortSignal.timeout(2 * 60 * 1000),
      });
      if (!r.ok && r.status !== 404) console.warn(`[Worker] Publishing tick: ${r.status}`);
    } catch (e) {
      console.warn("[Worker] Publishing tick failed:", e?.message || e);
    } finally {
      ticking = false;
    }
  };
  setInterval(tick, TICK_EVERY_MS).unref?.();
}
