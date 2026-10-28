// Thumbnails for clips: a JPEG of a frame from the video (or of the image
// itself), made in the browser and saved in the user's own storage folder at
// <user id>/thumbs/<clip id>.jpg. Shown on the Projects, Home and Assets
// pages. New uploads get one straight from the file on disk; older clips get
// one the first time they're shown (one at a time, in the background).

import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isImageFilename } from "@/lib/media-kind";
import { folderOfPath } from "@/lib/workspace";

// Big enough for a project card, small enough to load fast (~15-30 KB).
const LONG_SIDE = 480;
const QUALITY = 0.75;
const TIMEOUT_MS = 20_000;

/** A clip a thumbnail can be made from. */
export type ThumbClip = {
  id: string;
  storage_path: string;
  filename: string;
  trim_in_ms?: number | null;
  trim_out_ms?: number | null;
  duration_ms?: number | null;
};

/** Where to take the picture from: a second into the clip (or a third of it, if shorter). */
export function thumbnailTimeMs(c: ThumbClip): number {
  const inMs = c.trim_in_ms ?? 0;
  const outMs = c.trim_out_ms ?? c.duration_ms ?? inMs + 3000;
  return inMs + Math.max(0, Math.min(1000, (outMs - inMs) / 3));
}

function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const s = Math.min(1, LONG_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * s));
  canvas.height = Math.max(1, Math.round(h * s));
  const g = canvas.getContext("2d");
  if (!g) return Promise.resolve(null);
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY);
    } catch {
      // A picture from another site that doesn't allow reading it back.
      resolve(null);
    }
  });
}

/**
 * A JPEG thumbnail of a clip's file (a link or an object URL): the frame at
 * `atMs` of a video, or an image itself. null if it can't be read.
 */
export function makeThumbnail(src: string, filename: string, atMs: number): Promise<Blob | null> {
  if (isImageFilename(filename)) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      img.onload = () => {
        clearTimeout(timer);
        void toJpeg(img, img.naturalWidth, img.naturalHeight).then(resolve);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    });
  }
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    let done = false;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(b);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    video.addEventListener("error", () => finish(null));
    video.addEventListener("loadedmetadata", () => {
      const end = Math.max(0, (video.duration || 0) - 0.05);
      video.currentTime = Math.min(Math.max(0, atMs / 1000), end);
    });
    video.addEventListener("seeked", () => {
      if (!video.videoWidth) return finish(null);
      void toJpeg(video, video.videoWidth, video.videoHeight).then(finish);
    });
    video.src = src;
  });
}

/**
 * Saves a clip's thumbnail next to its file (the project's folder: the
 * user's, or a team's) and records it on the clip (with `record`, the
 * setClipThumbnail server function).
 */
export async function saveThumbnail(
  clipId: string,
  storagePath: string,
  jpeg: Blob,
  record: (v: { data: { id: string; path: string } }) => Promise<unknown>,
) {
  const path = `${folderOfPath(storagePath)}/thumbs/${clipId}.jpg`;
  const { error } = await supabase.storage
    .from("raw-clips")
    .upload(path, jpeg, { upsert: true, contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  await record({ data: { id: clipId, path } });
}

// One queue for the whole app: clips waiting for a thumbnail, done one at a
// time, carrying on when the page changes. Each clip is tried once per visit.
type Handlers = {
  sign: (v: { data: { path: string } }) => Promise<{ url: string }>;
  record: (v: { data: { id: string; path: string } }) => Promise<unknown>;
  onSaved?: () => void;
};
const tried = new Set<string>();
const waiting = new Map<string, ThumbClip>();
let handlers: Handlers | null = null;
let running = false;

/** This clip's thumbnail is being made elsewhere (e.g. from an upload): don't queue it. */
export function claimThumbnail(clipId: string) {
  tried.add(clipId);
  waiting.delete(clipId);
}

async function work() {
  if (running) return;
  running = true;
  try {
    for (let next = waiting.values().next(); !next.done; next = waiting.values().next()) {
      const c = next.value;
      waiting.delete(c.id);
      tried.add(c.id);
      const h = handlers;
      if (!h) break;
      try {
        const { url } = await h.sign({ data: { path: c.storage_path } });
        const jpeg = await makeThumbnail(url, c.filename, thumbnailTimeMs(c));
        if (!jpeg) continue;
        await saveThumbnail(c.id, c.storage_path, jpeg, h.record);
        handlers?.onSaved?.();
      } catch (e) {
        console.warn("[thumbnails] Couldn't make a thumbnail:", c.filename, e);
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Makes thumbnails for these clips (ones that have none), in the
 * background. `sign` gives a link to a file, `record` is setClipThumbnail,
 * and `onSaved` runs after each one is saved (e.g. to refresh the list).
 */
export function useThumbnailMaker(
  clips: ThumbClip[],
  sign: Handlers["sign"],
  record: Handlers["record"],
  onSaved?: () => void,
) {
  const latest = useRef<Handlers>({ sign, record, onSaved });
  latest.current = { sign, record, onSaved };
  const key = clips.map((c) => c.id).join(",");
  useEffect(() => {
    // The page on screen gets the "saved" calls.
    handlers = {
      sign: (v) => latest.current.sign(v),
      record: (v) => latest.current.record(v),
      onSaved: () => latest.current.onSaved?.(),
    };
    for (const c of clips) if (!tried.has(c.id)) waiting.set(c.id, c);
    void work();
    // `key` stands for the clips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
