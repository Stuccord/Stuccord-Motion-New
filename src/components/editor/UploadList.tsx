// Files being uploaded, at the top of the Media panel: each with its
// progress, percent and time left, and Cancel / Retry.

import { useEffect, useState } from "react";
import { AlertCircle, Check, Film, Image as ImageIcon, Music2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { secondsLeft, type UploadItem } from "./useUploadQueue";

function formatLeft(s: number | null) {
  if (s == null || !Number.isFinite(s)) return null;
  if (s < 5) return "a few seconds left";
  if (s < 60) return `${Math.round(s)} s left`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s left`;
  return `${Math.floor(m / 60)} h ${m % 60} min left`;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UploadList({
  items,
  onCancel,
  onRetry,
  onDismiss,
}: {
  items: UploadItem<unknown>[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  // Redraw each second so the time left counts down between progress events.
  const [, tick] = useState(0);
  const anyGoing = items.some((it) => it.status === "uploading");
  useEffect(() => {
    if (!anyGoing) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyGoing]);

  if (items.length === 0) return null;
  return (
    <ul className="px-2.5 pt-1.5 pb-1 space-y-1.5" aria-label="Uploads">
      {items.map((it) => {
        const pct =
          it.status === "done" || it.status === "saving"
            ? 100
            : Math.floor((it.loaded / Math.max(1, it.file.size)) * 100);
        const kind = it.file.type.startsWith("audio/")
          ? Music2
          : it.file.type.startsWith("image/")
            ? ImageIcon
            : Film;
        const Icon = kind;
        const status =
          it.status === "queued"
            ? "Waiting…"
            : it.status === "uploading"
              ? [`${pct}%`, formatLeft(secondsLeft(it))].filter(Boolean).join(" · ")
              : it.status === "saving"
                ? "Adding to timeline…"
                : it.status === "done"
                  ? "Added"
                  : it.error;
        return (
          <li
            key={it.id}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-[11px]",
              it.status === "error"
                ? "border-rose-500/30 bg-rose-950/20"
                : "border-white/[0.08] bg-white/[0.03]",
            )}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {it.status === "error" ? (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
              ) : it.status === "done" ? (
                <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              ) : (
                <Icon className="w-3.5 h-3.5 shrink-0 text-violet-300" />
              )}
              <span className="truncate text-neutral-200 font-medium" title={it.file.name}>
                {it.file.name}
              </span>
              <span className="ml-auto shrink-0 text-neutral-500 font-mono">
                {formatSize(it.file.size)}
              </span>
              {it.status === "error" && it.canRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(it.id)}
                  className="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-violet-300 hover:text-white hover:bg-white/[0.08]"
                  title="Try this file again"
                >
                  <RotateCcw className="w-3 h-3" /> Retry
                </button>
              )}
              {(it.status === "queued" || it.status === "uploading" || it.status === "error") && (
                <button
                  type="button"
                  onClick={() => (it.status === "error" ? onDismiss(it.id) : onCancel(it.id))}
                  className="shrink-0 w-5 h-5 grid place-items-center rounded text-neutral-400 hover:text-white hover:bg-white/[0.08]"
                  aria-label={
                    it.status === "error" ? `Dismiss ${it.file.name}` : `Cancel ${it.file.name}`
                  }
                  title={it.status === "error" ? "Dismiss" : "Cancel upload"}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {it.status !== "error" && (
              <div className="mt-1 h-1 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300",
                    it.status === "done" ? "bg-emerald-500" : "bg-violet-500",
                    it.status === "saving" && "animate-pulse",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
            <div
              className={cn(
                "mt-1 font-mono tabular-nums",
                it.status === "error" ? "text-rose-300 break-words" : "text-neutral-400",
              )}
            >
              {status}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
