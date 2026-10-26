// Small frame thumbnails for timeline clips, grabbed in the browser from the
// clip's video at its trim point.

const THUMB_HEIGHT = 72;
const CAPTURE_TIMEOUT_MS = 20_000;

/** Cache key for a clip's thumbnail: its source file and where it starts. */
export function thumbnailKey(clip: { storage_path: string; trim_in_ms?: number | null }) {
  return `${clip.storage_path}@${clip.trim_in_ms ?? 0}`;
}

/**
 * Grabs the frame at `atMs` as a small JPEG data URL, or null if the video
 * can't be loaded, decoded or read back (e.g. the browser can't play the
 * format, or the server doesn't allow cross-origin reads).
 */
export function captureVideoFrame(src: string, atMs: number) {
  return new Promise<string | null>((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);

    video.addEventListener("error", () => finish(null));
    video.addEventListener("loadedmetadata", () => {
      const t = Math.min(Math.max(0, atMs / 1000), Math.max(0, (video.duration || 0) - 0.05));
      video.currentTime = t;
    });
    video.addEventListener("seeked", () => {
      try {
        const scale = THUMB_HEIGHT / (video.videoHeight || THUMB_HEIGHT);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((video.videoWidth || THUMB_HEIGHT) * scale));
        canvas.height = THUMB_HEIGHT;
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        // A cross-origin frame can't be read back; go without a thumbnail.
        finish(null);
      }
    });
    video.src = src;
  });
}
