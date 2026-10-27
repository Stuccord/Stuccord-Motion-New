// What the user wants to be told about, saved on their account (Supabase
// auth user metadata), and when they last looked at the bell.

import { supabase } from "@/integrations/supabase/client";

export type NotificationPrefs = {
  /** An export finished. */
  exportDone: boolean;
  /** An export failed. */
  exportFailed: boolean;
  /** Also show a desktop notification (when the browser allows it). */
  desktop: boolean;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  exportDone: true,
  exportFailed: true,
  desktop: false,
};

type Meta = Record<string, unknown> | undefined;

export function readPrefs(meta: Meta): NotificationPrefs {
  const m = meta ?? {};
  const flag = (key: string, d: boolean) => (typeof m[key] === "boolean" ? (m[key] as boolean) : d);
  return {
    exportDone: flag("notify_export_done", DEFAULT_PREFS.exportDone),
    exportFailed: flag("notify_export_failed", DEFAULT_PREFS.exportFailed),
    desktop: flag("notify_desktop", DEFAULT_PREFS.desktop),
  };
}

/** When the bell was last opened (ms), or 0. */
export function readSeenAt(meta: Meta): number {
  const v = meta?.notifications_seen_at;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export async function savePrefs(prefs: NotificationPrefs) {
  const { error } = await supabase.auth.updateUser({
    data: {
      notify_export_done: prefs.exportDone,
      notify_export_failed: prefs.exportFailed,
      notify_desktop: prefs.desktop,
    },
  });
  if (error) throw new Error(error.message);
}

export async function markSeen(at = new Date()) {
  const { error } = await supabase.auth.updateUser({
    data: { notifications_seen_at: at.toISOString() },
  });
  if (error) throw new Error(error.message);
}
