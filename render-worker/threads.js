// How many threads each ffmpeg the worker starts may use.
//
// ffmpeg starts threads for every CPU it sees, and in a container it sees
// the whole host's CPUs, not the instance's share. Each thread holds whole
// 1080x1920 frames, so the final pass (graphics laid over the video) peaked
// near 2 GB and Render restarted the worker. Measured on an 8-second 9:16
// video with three graphics and a cut-out: about 1,970 MB with ffmpeg's own
// choice, 720 MB with 2 threads (same speed), 590 MB with 1 (twice as slow).

export const FFMPEG_THREADS = 2;

/**
 * ffmpeg arguments with every decoder, filter graph and the encoder limited
 * to FFMPEG_THREADS. Adds -threads before each input and before the output
 * (the last argument, unless it's an input: a command that only reads).
 */
export function limitThreads(args, threads = FFMPEG_THREADS) {
  const n = String(threads);
  const out = ["-filter_threads", n, "-filter_complex_threads", n];
  const last = args.length - 1;
  const lastIsInput = last > 0 && args[last - 1] === "-i";
  args.forEach((a, i) => {
    if (a === "-i") out.push("-threads", n);
    if (i === last && !lastIsInput) out.push("-threads", n);
    out.push(a);
  });
  return out;
}
