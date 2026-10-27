// Uploads files in the background, two at a time, so the editor stays
// usable. Each file has its own progress (percent, time left) and can be
// cancelled; one that fails doesn't stop the others and can be retried.

import { useCallback, useEffect, useRef, useState } from "react";
import { FinalUploadError, UploadCancelled } from "@/lib/upload-file";

const AT_ONCE = 2;
// Finished uploads stay in the list this long, then leave it.
const DONE_SHOWN_MS = 4000;

export type UploadStatus = "queued" | "uploading" | "saving" | "done" | "error";

export type UploadItem<Meta> = {
  id: string;
  /** Files added together (one drop or pick). */
  batchId: string;
  /** Order added, across all batches. */
  seq: number;
  file: File;
  meta: Meta;
  status: UploadStatus;
  loaded: number;
  /** When the bytes started going up (for the time left). */
  startedAt: number | null;
  error: string | null;
  /** Whether trying again could work. */
  canRetry: boolean;
};

/** What running one upload can do while it goes. */
export type UploadControl = {
  progress: (loaded: number) => void;
  /** The bytes are up; the clip is being added to the project. */
  saving: () => void;
  /** How to stop it part way. */
  onAbort: (abort: () => void) => void;
};

/** Seconds left for an item, once there's enough to tell. */
export function secondsLeft(item: UploadItem<unknown>, now = Date.now()): number | null {
  if (item.status !== "uploading" || !item.startedAt || item.loaded <= 0) return null;
  const elapsed = (now - item.startedAt) / 1000;
  if (elapsed < 1) return null;
  const speed = item.loaded / elapsed;
  return speed > 0 ? (item.file.size - item.loaded) / speed : null;
}

/** Overall progress of what's still going, for a compact badge. */
export function uploadSummary(items: UploadItem<unknown>[]) {
  const going = items.filter(
    (it) => it.status === "queued" || it.status === "uploading" || it.status === "saving",
  );
  if (going.length === 0) return null;
  // Over this round of files: those still going and those just finished.
  const round = items.filter((it) => it.status !== "error");
  const total = round.reduce((n, it) => n + it.file.size, 0);
  const loaded = round.reduce(
    (n, it) => n + (it.status === "done" || it.status === "saving" ? it.file.size : it.loaded),
    0,
  );
  return {
    left: going.length,
    count: round.length,
    pct: total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : 0,
  };
}

export function useUploadQueue<Meta, Result>(options: {
  /** Uploads one file and adds it to the project. */
  run: (item: UploadItem<Meta>, control: UploadControl) => Promise<Result>;
  /** A file finished (in any order). */
  onDone?: (item: UploadItem<Meta>, result: Result) => void;
  /** Every file of a batch has finished or failed: those that finished since last time, in the order they were added. */
  onBatchSettled?: (
    batchId: string,
    finished: { item: UploadItem<Meta>; result: Result }[],
  ) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [items, setItems] = useState<UploadItem<Meta>[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const aborts = useRef(new Map<string, () => void>());
  const running = useRef(new Set<string>());
  // Results waiting for the rest of their batch.
  const finished = useRef(new Map<string, { item: UploadItem<Meta>; result: Result }>());
  const seq = useRef(0);

  const patch = useCallback((id: string, change: Partial<UploadItem<Meta>>) => {
    setItems((all) => all.map((it) => (it.id === id ? { ...it, ...change } : it)));
  }, []);

  /** Adds files to the end of the queue as one batch. */
  const add = useCallback((entries: { file: File; meta: Meta; error?: string }[]) => {
    const batchId = crypto.randomUUID();
    const fresh = entries.map<UploadItem<Meta>>((e) => ({
      id: crypto.randomUUID(),
      batchId,
      seq: seq.current++,
      file: e.file,
      meta: e.meta,
      status: e.error ? "error" : "queued",
      loaded: 0,
      startedAt: null,
      error: e.error ?? null,
      canRetry: false,
    }));
    setItems((all) => [...all, ...fresh]);
    return batchId;
  }, []);

  const remove = useCallback((id: string) => {
    setItems((all) => all.filter((it) => it.id !== id));
  }, []);

  /** Stops a waiting or uploading file and takes it off the list. */
  const cancel = useCallback(
    (id: string) => {
      aborts.current.get(id)?.();
      remove(id);
    },
    [remove],
  );

  const retry = useCallback(
    (id: string) =>
      patch(id, { status: "queued", loaded: 0, startedAt: null, error: null, canRetry: false }),
    [patch],
  );

  // Reports a batch once none of its files is still waiting or going.
  const settleBatch = useCallback((batchId: string, all: UploadItem<Meta>[]) => {
    const busy = all.some(
      (it) =>
        it.batchId === batchId &&
        (it.status === "queued" || it.status === "uploading" || it.status === "saving"),
    );
    if (busy) return;
    // From the results kept aside: finished files may have left the list.
    const ready = [...finished.current.values()]
      .filter((f) => f.item.batchId === batchId)
      .sort((a, b) => a.item.seq - b.item.seq);
    for (const r of ready) finished.current.delete(r.item.id);
    if (ready.length) latest.current.onBatchSettled?.(batchId, ready);
  }, []);

  const start = useCallback(
    async (item: UploadItem<Meta>) => {
      running.current.add(item.id);
      patch(item.id, { status: "uploading", startedAt: Date.now(), loaded: 0 });
      const stillListed = () => itemsRef.current.some((it) => it.id === item.id);
      try {
        const result = await latest.current.run(item, {
          progress: (loaded) => patch(item.id, { loaded }),
          saving: () => patch(item.id, { status: "saving", loaded: item.file.size }),
          onAbort: (abort) => aborts.current.set(item.id, abort),
        });
        if (!stillListed()) return;
        finished.current.set(item.id, { item, result });
        patch(item.id, { status: "done" });
        latest.current.onDone?.(item, result);
        setTimeout(() => remove(item.id), DONE_SHOWN_MS);
      } catch (e) {
        if (e instanceof UploadCancelled || !stillListed()) return;
        patch(item.id, {
          status: "error",
          error: e instanceof Error ? e.message : "Upload failed",
          canRetry: !(e instanceof FinalUploadError),
        });
      } finally {
        running.current.delete(item.id);
        aborts.current.delete(item.id);
        // A free slot: let the next waiting file start.
        setItems((all) => [...all]);
      }
    },
    [patch, remove],
  );

  // Start waiting files while fewer than AT_ONCE are going, and report
  // batches that have just finished (the last file done, failed or cancelled).
  useEffect(() => {
    const free = AT_ONCE - running.current.size;
    items
      .filter((it) => it.status === "queued" && !running.current.has(it.id))
      .slice(0, Math.max(0, free))
      .forEach((it) => void start(it));
    for (const batchId of new Set([...finished.current.values()].map((f) => f.item.batchId))) {
      settleBatch(batchId, items);
    }
  }, [items, start, settleBatch]);

  // Closing or reloading the page while files are going asks first.
  const active = items.some(
    (it) => it.status === "queued" || it.status === "uploading" || it.status === "saving",
  );
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  // Leaving the editor stops what's still going.
  useEffect(
    () => () => {
      for (const abort of aborts.current.values()) abort();
    },
    [],
  );

  return { items, add, cancel, retry, remove, active };
}
