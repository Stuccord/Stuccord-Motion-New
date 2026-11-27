// The editor's side of the cleaned voice (clean-voice.server.ts): asks for
// the main track's recordings at the Noise removal setting a moment after
// they or the setting change, then again every so often while some are
// still being made, and hands back their links by recording path.

import { useEffect, useRef, useState } from "react";
import { getCleanVoices } from "@/lib/clean-voice.functions";
import type { NoiseMode } from "@/lib/noise-removal";

/** Wait after a change before asking (editing settles). */
const SETTLE_MS = 1500;
/** How often to look again while some are being made. */
const LOOK_AGAIN_MS = 15_000;
/** Stop looking after this long without a new one (the worker gave up). */
const GIVE_UP_MS = 10 * 60 * 1000;
/** Links are good for an hour: fetched again before then. */
const REFRESH_MS = 45 * 60 * 1000;

export type CleanVoiceState = {
  /** Cleaned sound links by recording path (for the setting asked for). */
  urls: Record<string, string>;
  /** Recordings still being cleaned. */
  waiting: number;
};

export function useCleanVoice(
  projectId: string | undefined,
  paths: string[],
  mode: NoiseMode,
): CleanVoiceState {
  const [state, setState] = useState<CleanVoiceState>({ urls: {}, waiting: 0 });
  const wanted = [...new Set(paths)].sort();
  const key = projectId && mode !== "off" && wanted.length ? `${mode}|${wanted.join("|")}` : "";
  const latest = useRef(wanted);
  latest.current = wanted;
  useEffect(() => {
    // A different setting: the other setting's sound isn't this one's.
    setState({ urls: {}, waiting: 0 });
    if (!key || !projectId || mode === "off") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastNewAt = Date.now();
    let known = "";
    let renew = false;
    const ask = async () => {
      let waiting = 0;
      try {
        const res = await getCleanVoices({
          data: { project_id: projectId, mode, paths: latest.current },
        });
        if (!alive) return;
        waiting = res.waiting;
        const got = Object.keys(res.urls).sort().join("|");
        if (got !== known || renew) {
          known = got;
          lastNewAt = Date.now();
          const fresh = renew;
          // Files already playing keep their links, unless being renewed.
          setState((old) => ({
            urls: Object.fromEntries(
              Object.entries(res.urls).map(([p, u]) => [p, (!fresh && old.urls[p]) || u]),
            ),
            waiting,
          }));
        } else setState((old) => (old.waiting === waiting ? old : { ...old, waiting }));
      } catch (e) {
        console.warn("[preview] Couldn't get the cleaned voice:", e);
        waiting = 1;
      }
      if (!alive) return;
      renew = false;
      if (waiting > 0 && Date.now() - lastNewAt < GIVE_UP_MS) {
        timer = setTimeout(ask, LOOK_AGAIN_MS);
      } else if (waiting > 0) {
        // The worker gave up: the recording plays as it is.
        setState((old) => ({ ...old, waiting: 0 }));
      } else if (known) {
        timer = setTimeout(() => {
          renew = true;
          void ask();
        }, REFRESH_MS);
      }
    };
    timer = setTimeout(ask, SETTLE_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, projectId, mode]);
  return state;
}
