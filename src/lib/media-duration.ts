// Reads a video or audio file's length in the browser, from a URL (a signed
// storage URL or an object URL for a local File), by loading only its
// metadata into a detached media element.

const PROBE_TIMEOUT_MS = 20_000;

/** Length in whole milliseconds, or null if it can't be read in time. */
export function probeMediaDurationMs(src: string, kind: "video" | "audio" = "video") {
  return new Promise<number | null>((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.muted = true;

    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);

    el.addEventListener("loadedmetadata", () => {
      const d = el.duration;
      finish(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null);
    });
    el.addEventListener("error", () => finish(null));
    el.src = src;
  });
}

/** Length of a local file before it's uploaded. */
export async function probeFileDurationMs(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await probeMediaDurationMs(url, file.type.startsWith("audio/") ? "audio" : "video");
  } finally {
    URL.revokeObjectURL(url);
  }
}
