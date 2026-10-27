// What a timeline clip draws inside it, like CapCut: a filmstrip of frames
// from across its file and a waveform of its sound. Both are made in the
// browser from the clip's file, once per file, and drawn for whatever part
// of the file the clip shows (so a trimmed or split clip shows its own part).

const FRAME_HEIGHT = 48;
// About this many frames per file, at least a second apart.
const FRAMES_PER_FILE = 80;
const MIN_FRAME_GAP_MS = 1000;
const FRAME_TIMEOUT_MS = 15_000;

/** Frames from one file: when each is from (ms, rising) and the picture. */
export type Filmstrip = { times: number[]; images: HTMLImageElement[]; ratio: number };

/** Loudness of one file: `peaks[i]` (0-1) covers `bucketMs` from i × bucketMs. */
export type Waveform = { bucketMs: number; peaks: Float32Array };

// Files bigger than this aren't downloaded whole just for a waveform.
const WAVEFORM_MAX_BYTES = 300 * 1024 * 1024;
const WAVEFORM_BUCKET_MS = 50;
// Decoded at a low rate: enough for a picture of the sound, light on memory.
const WAVEFORM_SAMPLE_RATE = 8000;

/** The frame nearest `ms`, or null when none has been grabbed yet. */
export function frameAt(strip: Filmstrip, ms: number): HTMLImageElement | null {
  const { times, images } = strip;
  if (times.length === 0) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < ms) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - ms) <= Math.abs(times[lo] - ms)) lo--;
  return images[lo];
}

/**
 * Grabs frames spread across the video, calling `onUpdate` as they come in
 * (in time order). Resolves when done; gives up quietly (keeping what it
 * has) if the video can't be read.
 */
export function captureFilmstrip(
  src: string,
  durationMs: number,
  onUpdate: (strip: Filmstrip) => void,
  signal?: { cancelled: boolean },
) {
  return new Promise<void>((resolve) => {
    const gap = Math.max(MIN_FRAME_GAP_MS, durationMs / FRAMES_PER_FILE);
    const wanted: number[] = [];
    for (let t = 0; t < durationMs; t += gap) wanted.push(Math.round(t));
    const strip: Filmstrip = { times: [], images: [], ratio: 16 / 9 };
    if (wanted.length === 0) return resolve();

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      if (strip.times.length) onUpdate({ ...strip });
      resolve();
    };
    const next = () => {
      if (signal?.cancelled || i >= wanted.length) return finish();
      clearTimeout(timer);
      timer = setTimeout(finish, FRAME_TIMEOUT_MS);
      video.currentTime = Math.min(wanted[i] / 1000, Math.max(0, (video.duration || 0) - 0.05));
    };

    video.addEventListener("error", finish);
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth && video.videoHeight) strip.ratio = video.videoWidth / video.videoHeight;
      canvas.height = FRAME_HEIGHT;
      canvas.width = Math.max(1, Math.round(FRAME_HEIGHT * strip.ratio));
      next();
    });
    video.addEventListener("seeked", () => {
      try {
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = new Image();
        img.src = canvas.toDataURL("image/jpeg", 0.6);
        strip.times.push(wanted[i]);
        strip.images.push(img);
      } catch {
        // A cross-origin frame can't be read back: no filmstrip for this file.
        return finish();
      }
      i++;
      // Show the first frames straight away, then every few.
      if (strip.times.length <= 3 || strip.times.length % 8 === 0) onUpdate({ ...strip });
      next();
    });
    video.src = src;
  });
}

/**
 * The file's loudness over time, or null if it has no sound the browser can
 * decode (or is too big to download for this).
 */
export async function computeWaveform(
  src: string,
  sizeBytes: number | null,
): Promise<Waveform | null> {
  if (sizeBytes != null && sizeBytes > WAVEFORM_MAX_BYTES) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, WAVEFORM_SAMPLE_RATE);
    const audio = await ctx.decodeAudioData(data);
    const perBucket = Math.max(1, Math.round((audio.sampleRate * WAVEFORM_BUCKET_MS) / 1000));
    const buckets = Math.ceil(audio.length / perBucket);
    const peaks = new Float32Array(buckets);
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const samples = audio.getChannelData(ch);
      for (let b = 0; b < buckets; b++) {
        let max = peaks[b];
        const end = Math.min(samples.length, (b + 1) * perBucket);
        for (let s = b * perBucket; s < end; s++) {
          const v = Math.abs(samples[s]);
          if (v > max) max = v;
        }
        peaks[b] = max;
      }
    }
    // Scale so the loudest part fills the strip.
    let loudest = 0;
    for (const p of peaks) if (p > loudest) loudest = p;
    if (loudest > 0) for (let b = 0; b < buckets; b++) peaks[b] = peaks[b] / loudest;
    return { bucketMs: WAVEFORM_BUCKET_MS, peaks };
  } catch {
    return null;
  }
}
