// The editor's side of the preview cut-outs (see cutout-preview.ts): asks
// for the behind stretches' cut-outs a moment after they appear or change,
// then again every so often while some are still being made, and hands
// back the saved ones by file.

import { useEffect, useRef, useState } from "react";
import { getPreviewCutouts } from "@/lib/projects.functions";
import type { CutoutStretch, PreviewCutout } from "@/lib/cutout-preview";

/** Wait after the stretches change before asking (editing settles). */
const SETTLE_MS = 2500;
/** How often to look again while some are being made. */
const LOOK_AGAIN_MS = 20_000;
/** Stop looking after this long without a new one (the worker gave up). */
const GIVE_UP_MS = 15 * 60 * 1000;
/** Links are good for an hour: fetched again before then. */
const REFRESH_MS = 45 * 60 * 1000;

export function usePreviewCutouts(
  projectId: string | undefined,
  stretches: CutoutStretch[],
  enabled: boolean,
): Record<string, PreviewCutout[]> {
  const [byPath, setByPath] = useState<Record<string, PreviewCutout[]>>({});
  const key = enabled && projectId ? JSON.stringify(stretches) : "";
  const latest = useRef(stretches);
  latest.current = stretches;
  useEffect(() => {
    if (!key || !projectId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let lastNewAt = startedAt;
    let known = "";
    let refreshing = false;
    const ask = async () => {
      let waiting = 0;
      try {
        const res = await getPreviewCutouts({
          data: { project_id: projectId, stretches: latest.current },
        });
        if (!alive) return;
        waiting = res.waiting;
        const got = res.cutouts
          .map((c) => `${c.path}@${c.fromMs}-${c.toMs}`)
          .sort()
          .join("|");
        if (got !== known || refreshing) {
          known = got;
          lastNewAt = Date.now();
          // Same files as before keep their links (the player keeps playing
          // them), unless the links are being renewed.
          const renew = refreshing;
          setByPath((old) => {
            const next: Record<string, PreviewCutout[]> = {};
            for (const c of res.cutouts) {
              const kept = renew
                ? undefined
                : old[c.path]?.find((o) => o.fromMs === c.fromMs && o.toMs === c.toMs);
              (next[c.path] ??= []).push(kept ?? c);
            }
            return next;
          });
        }
      } catch (e) {
        console.warn("[preview] Couldn't get the cut-outs:", e);
        waiting = 1;
      }
      if (!alive) return;
      refreshing = false;
      if (waiting > 0 && Date.now() - lastNewAt < GIVE_UP_MS)
        timer = setTimeout(ask, LOOK_AGAIN_MS);
      else if (known) {
        timer = setTimeout(() => {
          refreshing = true;
          void ask();
        }, REFRESH_MS);
      }
    };
    timer = setTimeout(ask, SETTLE_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, projectId]);
  return byPath;
}
