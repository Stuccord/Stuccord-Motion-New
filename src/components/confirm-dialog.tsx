// "Are you sure?" in the app's own style, instead of the browser's confirm()
// box (which shows the site's address as its title and can't be styled).
// Laid out like Higgsfield's: a small dark card in the middle, a short bold
// title, one line on what happens, and Cancel beside the action (red when it
// deletes something).
//
//   if (await confirmDialog({ title: `Delete "${p.title}"?`, ... })) onDelete();
//
// <ConfirmDialogHost /> is mounted once, in the root route.

import { useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  /** One or two sentences on what will happen. */
  description?: string;
  /** The action's button (default "Confirm"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger": the action deletes or can't be undone (a red button). */
  tone?: "default" | "danger";
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Asks; resolves true for the action, false for Cancel, Escape or a click outside. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // One at a time: an earlier question still open counts as cancelled.
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...options, resolve };
    changed();
  });
}

function answer(ok: boolean) {
  const p = pending;
  pending = null;
  changed();
  p?.resolve(ok);
}

export function ConfirmDialogHost() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => null,
  );
  const danger = current?.tone === "danger";
  return (
    <AlertDialog open={!!current} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm gap-5 rounded-2xl border-white/10 bg-card p-6 shadow-2xl sm:rounded-2xl">
        <AlertDialogHeader className="space-y-1.5 text-left">
          <AlertDialogTitle className="text-base font-semibold leading-snug">
            {current?.title}
          </AlertDialogTitle>
          {current?.description ? (
            <AlertDialogDescription className="text-sm leading-relaxed">
              {current.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row gap-2 space-x-0 sm:space-x-0">
          <AlertDialogCancel
            className="mt-0 flex-1 rounded-full border-white/10 bg-white/5 hover:bg-white/10"
            onClick={() => answer(false)}
          >
            {current?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              "flex-1 rounded-full",
              danger && "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500",
            )}
            onClick={() => answer(true)}
          >
            {current?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
