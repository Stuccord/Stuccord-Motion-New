// Posting finished exports to social platforms (YouTube, TikTok, Instagram), and the once-a-minute tick
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
  if (!["youtube", "tiktok", "instagram"].includes(p.platform)) return "Posting there isn't supported yet";
  if (typeof p.access_token !== "string" || !p.access_token) return "Missing access_token";
  if (!isHttpUrl(p.video_url)) return "Invalid video_url";
  if (p.cover_url != null && !isHttpUrl(p.cover_url)) return "Invalid cover_url";
  if (!isHttpUrl(p.callback_url)) return "Invalid callback_url";
  if (p.platform === "youtube") {
    if (typeof p.title !== "string" || !p.title.trim()) return "Missing title";
    if (!["public", "unlisted", "private"].includes(p.privacy)) return "Invalid privacy";
  } else if (p.platform === "instagram") {
    if (typeof p.account_external_id !== "string" || !/^\d+$/.test(p.account_external_id)) return "Invalid Instagram account";
    const o = p.options;
    if (!o || (o.kind !== "reel" && o.kind !== "story")) return "Invalid Instagram options";
  } else {
    const o = p.options;
    if (!o || (o.mode !== "direct" && o.mode !== "draft")) return "Invalid TikTok options";
    if (o.mode === "direct" && !TIKTOK_PRIVACY.includes(o.privacy_level)) return "Invalid TikTok privacy";
  }
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

// ---------- TikTok ----------
//
// The file is sent in pieces of 10 MB (TikTok takes 5-64 MB; the last piece
// takes whatever is left, and a video under 10 MB goes in one piece). Then
// TikTok processes it; this waits up to 10 minutes for the result. If it's
// still processing, the post is reported as sent and the app checks on it
// later (src/lib/publishing/dispatch.server.ts, resolvePendingPosts).

const TT_API = "https://open.tiktokapis.com/v2";
const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
const TT_CHUNK = 10 * 1024 * 1024;
const TT_WAIT_MS = 10 * 60 * 1000;
// How often to ask TikTok; TIKTOK_POLL_MS only exists for tests.
const TT_POLL_MS = Number(process.env.TIKTOK_POLL_MS) || 5000;

const TIKTOK_ERRORS = {
  access_token_invalid: "TikTok stopped accepting this sign-in. Reconnect the account.",
  scope_not_authorized: "Reconnect TikTok and allow posting: a permission is missing.",
  spam_risk_too_many_posts: "TikTok's daily post limit for this account is reached. Try again tomorrow.",
  spam_risk_user_banned_from_posting: "TikTok isn't letting this account post right now.",
  reached_active_user_cap: "Stuccord's daily TikTok posting allowance is used up. Try again tomorrow.",
  unaudited_client_can_only_post_to_private_accounts: "TikTok only allows private posts from this app until it's approved.",
  privacy_level_option_mismatch: "That 'who can see' choice isn't available for this account any more.",
  rate_limit_exceeded: "TikTok is busy. Try again in a minute.",
  file_format_check_failed: "TikTok couldn't read this video. Try exporting it again.",
  duration_check_failed: "The video is too long or too short for this TikTok account.",
  frame_rate_check_failed: "TikTok doesn't accept this video's frame rate.",
  picture_size_check_failed: "TikTok doesn't accept this video's size.",
};
const tiktokText = (code, fallback) =>
  TIKTOK_ERRORS[code] || `TikTok: ${fallback || code}`.slice(0, 300);

async function tiktokCall(path, token, body) {
  const res = await fetch(`${TT_API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60 * 1000),
  });
  const raw = await res.text();
  let j = {};
  try {
    j = JSON.parse(raw);
  } catch {}
  const code = j?.error?.code || (res.ok ? "ok" : `http_${res.status}`);
  if (code !== "ok") throw new Error(tiktokText(res.status === 401 ? "access_token_invalid" : code, j?.error?.message));
  return { data: j.data || {}, raw };
}

async function tiktokUpload(p, file, size, type, log) {
  const o = p.options;
  const count = Math.max(1, Math.floor(size / TT_CHUNK));
  const chunk = count === 1 ? size : TT_CHUNK;
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count };
  const caption = String(p.caption || "").trim() || String(p.title || "").trim();
  const { data } =
    o.mode === "direct"
      ? await tiktokCall("/post/publish/video/init/", p.access_token, {
          post_info: {
            title: caption.slice(0, 2200),
            privacy_level: o.privacy_level,
            disable_comment: !o.allow_comment,
            disable_duet: !o.allow_duet,
            disable_stitch: !o.allow_stitch,
            brand_organic_toggle: !!o.brand_organic,
            brand_content_toggle: !!o.brand_content,
          },
          source_info,
        })
      : await tiktokCall("/post/publish/inbox/video/init/", p.access_token, { source_info });
  if (!data.upload_url || !data.publish_id) throw new Error("TikTok didn't start the upload");
  const publishId = String(data.publish_id);

  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? size - 1 : start + chunk - 1;
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      try {
        const res = await fetch(data.upload_url, {
          method: "PUT",
          headers: {
            "content-type": type,
            "content-length": String(end - start + 1),
            "content-range": `bytes ${start}-${end}/${size}`,
          },
          body: Readable.toWeb(fs.createReadStream(file, { start, end })),
          duplex: "half",
          signal: AbortSignal.timeout(30 * 60 * 1000),
        });
        if (res.ok) ok = true;
        else if (res.status < 500) throw Object.assign(new Error(`TikTok refused the upload (${res.status})`), { final: true });
        else log(`piece ${i + 1} failed (${res.status}), retrying`);
      } catch (e) {
        if (e.final) throw e;
        log(`piece ${i + 1} interrupted (${e?.message || e}), retrying`);
      }
      if (!ok) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
    if (!ok) throw new Error("The upload to TikTok kept failing. Try again later.");
  }
  log(`uploaded in ${count} piece(s), waiting for TikTok`);

  // Wait for TikTok to process it.
  const until = Date.now() + TT_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, TT_POLL_MS));
    let st;
    try {
      st = await tiktokCall("/post/publish/status/fetch/", p.access_token, { publish_id: publishId });
    } catch (e) {
      log(`status check failed: ${e?.message || e}`);
      continue;
    }
    const status = st.data.status;
    if (status === "FAILED") throw new Error(tiktokText(st.data.fail_reason, "the post failed"));
    if (status === "SEND_TO_USER_INBOX") return { publishId, draft: true };
    if (status === "PUBLISH_COMPLETE") {
      // A 64-bit id: read as text so it isn't rounded.
      const m = st.raw.match(/"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)/);
      return { publishId, postId: m ? m[1] : null };
    }
  }
  return { publishId };
}

// ---------- Instagram ----------
//
// Instagram fetches the video itself from the signed link, so nothing is
// downloaded here: make a media container (a Reel or a Story), wait until
// Instagram has processed it, then publish it.

const IG_API = "https://graph.instagram.com/v21.0";
const IG_WAIT_MS = 15 * 60 * 1000;
// How often to ask Instagram; INSTAGRAM_POLL_MS only exists for tests.
const IG_POLL_MS = Number(process.env.INSTAGRAM_POLL_MS) || 10_000;

async function igCall(method, pathAndQuery, token, params) {
  const u = new URL(`${IG_API}/${pathAndQuery}`);
  u.searchParams.set("access_token", token);
  const res = await fetch(u, {
    method,
    headers: params ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
    body: params ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(60 * 1000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const e = j.error || {};
    if (e.code === 190 || res.status === 401) throw new Error("Instagram stopped accepting this sign-in. Reconnect the account.");
    // 9 / 2207042: the account's 24-hour posting limit.
    if (e.error_subcode === 2207042) throw new Error("This Instagram account has hit its daily posting limit. Try again tomorrow.");
    throw new Error(`Instagram: ${e.error_user_msg || e.message || `error ${res.status}`}`.slice(0, 300));
  }
  return j;
}

async function instagramPublish(p, log) {
  const o = p.options;
  const ig = p.account_external_id;
  const params =
    o.kind === "story"
      ? { media_type: "STORIES", video_url: p.video_url }
      : {
          media_type: "REELS",
          video_url: p.video_url,
          caption: String(p.caption || p.title || "").slice(0, 2200),
          share_to_feed: o.share_to_feed ? "true" : "false",
          ...(p.cover_url ? { cover_url: p.cover_url } : {}),
        };
  const container = await igCall("POST", `${ig}/media`, p.access_token, params);
  if (!container.id) throw new Error("Instagram didn't start the post");
  log(`container ${container.id}, waiting for Instagram`);

  const until = Date.now() + IG_WAIT_MS;
  let ready = false;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, IG_POLL_MS));
    let st;
    try {
      st = await igCall("GET", `${container.id}?fields=status_code,status`, p.access_token);
    } catch (e) {
      if (/Reconnect/.test(e.message)) throw e;
      log(`status check failed: ${e.message}`);
      continue;
    }
    if (st.status_code === "FINISHED") { ready = true; break; }
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
      throw new Error(`Instagram couldn't process the video${st.status ? ` (${String(st.status).slice(0, 150)})` : ""}. Check it's an MP4 within Instagram's limits.`);
    }
  }
  if (!ready) throw new Error("Instagram took too long to process the video. Try again.");

  const published = await igCall("POST", `${ig}/media_publish`, p.access_token, { creation_id: container.id });
  if (!published.id) throw new Error("Instagram didn't publish the post");
  let permalink = null;
  try {
    permalink = (await igCall("GET", `${published.id}?fields=permalink`, p.access_token)).permalink || null;
  } catch {}
  return { id: String(published.id), permalink };
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
        if (p.platform === "instagram") {
          log(`posting a ${p.options.kind} to Instagram`);
          const r = await instagramPublish(p, log);
          log(`posted ${r.id}`);
          await callback(p.callback_url, {
            post_id: p.post_id,
            status: "published",
            external_id: r.id,
            external_url: r.permalink,
          });
          return;
        }
        const file = path.join(dir, "video");
        const type = (await downloadTo(p.video_url, file)).split(";")[0].trim();
        const { size } = await fsp.stat(file);
        if (!size) throw new Error("The video file is empty");
        const videoType = type.startsWith("video/") ? type : "video/mp4";
        if (p.platform === "tiktok") {
          log(`uploading ${(size / 1e6).toFixed(1)} MB to TikTok (${p.options.mode})`);
          const r = await tiktokUpload(p, file, size, videoType, log);
          log(r.draft ? "sent to TikTok drafts" : `posted ${r.postId || "(TikTok still processing)"}`);
          await callback(p.callback_url, {
            post_id: p.post_id,
            status: "published",
            external_id: r.postId || null,
            external_ref: r.draft || r.postId ? null : r.publishId,
          });
        } else {
          log(`uploading ${(size / 1e6).toFixed(1)} MB to YouTube`);
          const id = await youtubeUpload(p, file, size, videoType, log);
          if (p.cover_url) await youtubeCover(p, id, log);
          log(`posted ${id}`);
          await callback(p.callback_url, {
            post_id: p.post_id,
            status: "published",
            external_id: id,
            external_url: `https://www.youtube.com/watch?v=${id}`,
          });
        }
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
