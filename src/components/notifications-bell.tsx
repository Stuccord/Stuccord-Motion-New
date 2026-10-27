// The bell in the top bar: exports that finished or failed (from render
// jobs), with a dot and count for ones since the bell was last opened. It
// listens for exports finishing while you're on these pages and tells you
// (a toast, and a desktop notification if you turned those on in Settings).

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listNotifications } from "@/lib/projects.functions";
import {
  DEFAULT_PREFS,
  markSeen,
  readPrefs,
  readSeenAt,
  type NotificationPrefs,
} from "@/lib/notification-prefs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function NotificationsBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchList = useServerFn(listNotifications);
  const { data: items = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchList(),
    staleTime: 30_000,
  });

  // The user's choices and when they last opened the bell (on their account).
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [seenAt, setSeenAt] = useState(0);
  useEffect(() => {
    const apply = (user: { id: string; user_metadata?: Record<string, unknown> } | null) => {
      setUserId(user?.id ?? null);
      setPrefs(readPrefs(user?.user_metadata));
      setSeenAt(readSeenAt(user?.user_metadata));
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      apply(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const shown = items.filter((n) =>
    n.kind === "export_done" ? prefs.exportDone : prefs.exportFailed,
  );
  const unread = shown.filter((n) => Date.parse(n.at) > seenAt).length;

  // Exports finishing from now on: tell the user once each.
  const told = useRef(new Set<string>());
  const latest = useRef({ prefs, items });
  latest.current = { prefs, items };
  useEffect(() => {
    for (const n of items) told.current.add(n.id);
  }, [items]);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "render_jobs", filter: `user_id=eq.${userId}` },
        (payload) => {
          const job = payload.new as {
            id: string;
            project_id: string;
            status: string;
            error?: string | null;
          };
          if (job.status !== "completed" && job.status !== "failed") return;
          if (told.current.has(job.id)) return;
          told.current.add(job.id);
          void qc.invalidateQueries({ queryKey: ["notifications"] });
          void qc.invalidateQueries({ queryKey: ["projects"] });
          void qc.invalidateQueries({ queryKey: ["usage-stats"] });
          const p = latest.current.prefs;
          const done = job.status === "completed";
          if (done ? !p.exportDone : !p.exportFailed) return;
          const title = done ? "Your export is ready" : "Your export failed";
          const body = done
            ? "Open the project to watch or download it."
            : (job.error ?? "Open the project to try again.");
          const open = () =>
            navigate({ to: "/projects/$projectId", params: { projectId: job.project_id } });
          if (done)
            toast.success(title, { description: body, action: { label: "Open", onClick: open } });
          else toast.error(title, { description: body, action: { label: "Open", onClick: open } });
          if (
            p.desktop &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.visibilityState !== "visible"
          ) {
            const note = new Notification(title, { body });
            note.onclick = () => {
              window.focus();
              open();
            };
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc, navigate]);

  const [open, setOpen] = useState(false);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Opening the bell marks everything in it as seen.
    if (next && unread > 0) {
      setSeenAt(Date.now());
      markSeen().catch((e) => console.warn("[notifications] Couldn't save as seen:", e));
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="p-2 rounded-lg hover:bg-surface relative text-muted-foreground hover:text-foreground transition-colors"
          aria-label={unread ? `Notifications (${unread} new)` : "Notifications"}
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold leading-[15px] text-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <div className="text-sm font-semibold">Notifications</div>
          <Link
            to="/settings"
            search={{ tab: "notifications" } as never}
            onClick={() => setOpen(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
        </div>
        {shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            Nothing yet. You&apos;ll see your exports here when they finish.
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto divide-y divide-border">
            {shown.map((n) => {
              const isNew = Date.parse(n.at) > seenAt;
              const done = n.kind === "export_done";
              return (
                <li key={n.id}>
                  <button
                    className={cn(
                      "w-full text-left flex gap-2.5 px-3 py-2.5 hover:bg-surface transition-colors",
                      isNew && "bg-primary/5",
                    )}
                    onClick={() => {
                      setOpen(false);
                      navigate({ to: "/projects/$projectId", params: { projectId: n.project_id } });
                    }}
                  >
                    {done ? (
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-foreground">
                        {done ? "Export ready" : "Export failed"}:{" "}
                        <span className="font-medium">{n.project_title}</span>
                      </span>
                      {!done && n.error && (
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {n.error}
                        </span>
                      )}
                      <span className="block text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.at), { addSuffix: true })}
                      </span>
                    </span>
                    {isNew && (
                      <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-primary shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
