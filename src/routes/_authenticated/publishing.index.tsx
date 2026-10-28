import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  Eye,
  Loader2,
  MessageCircle,
  Plus,
  RotateCcw,
  ThumbsUp,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PublishDialog } from "@/components/publish-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  cancelPost,
  deletePost,
  disconnectAccount,
  getPublishingSetup,
  listPosts,
  listSocialAccounts,
  reschedulePost,
  startConnect,
} from "@/lib/publishing.functions";
import { PlatformIcon } from "@/components/platform-icon";
import {
  PLATFORM_LABEL,
  TIKTOK_PRIVACY_LABEL,
  SCHEDULE_MAX_AHEAD_DAYS,
  type InstagramOptions,
  type TikTokOptions,
  type Platform,
  type SocialAccount,
  type SocialPost,
} from "@/lib/publishing-shared";

export const Route = createFileRoute("/_authenticated/publishing/")({
  head: () => ({ meta: [{ title: "Publishing — Stuccord Motion" }] }),
  component: PublishingPage,
});

const VIEWS = [
  { id: "waiting", label: "Scheduled" },
  { id: "posted", label: "Posted" },
  { id: "other", label: "Failed & canceled" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const fmtNum = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const tiktokOpts = (p: SocialPost) =>
  p.platform === "tiktok" ? (p.options as TikTokOptions) : null;

/** "Sent to drafts" for TikTok posts that went to the TikTok inbox. */
const isDraft = (p: SocialPost) => tiktokOpts(p)?.mode === "draft";

/** An Instagram Story (gone after a day). */
const isStory = (p: SocialPost) =>
  p.platform === "instagram" && (p.options as InstagramOptions).kind === "story";

/** Who can see a post, or what kind it is, when that's worth saying. */
function audience(p: SocialPost): string | null {
  const tt = tiktokOpts(p);
  if (tt) {
    if (tt.mode !== "direct") return null;
    return tt.privacy_level === "PUBLIC_TO_EVERYONE"
      ? null
      : TIKTOK_PRIVACY_LABEL[tt.privacy_level];
  }
  if (p.platform === "instagram") {
    if (isStory(p)) return "Story";
    return (p.options as InstagramOptions).kind === "reel" &&
      !(p.options as { share_to_feed?: boolean }).share_to_feed
      ? "Reels tab only"
      : null;
  }
  return p.privacy === "public" ? null : p.privacy;
}

function PublishingPage() {
  const qc = useQueryClient();
  const fetchSetup = useServerFn(getPublishingSetup);
  const fetchAccounts = useServerFn(listSocialAccounts);
  const fetchPosts = useServerFn(listPosts);
  const connect = useServerFn(startConnect);

  const setup = useQuery({ queryKey: ["publishing-setup"], queryFn: () => fetchSetup() });
  const accounts = useQuery({
    queryKey: ["social-accounts"],
    queryFn: () => fetchAccounts(),
    retry: false,
  });
  const posts = useQuery({
    queryKey: ["social-posts"],
    queryFn: () => fetchPosts(),
    retry: false,
    // Keep an eye on uploads and posts that are about to go out.
    refetchInterval: (q) =>
      (q.state.data ?? []).some(
        (p) =>
          p.status === "uploading" ||
          (p.status === "scheduled" && Date.parse(p.scheduled_at) < Date.now() + 2 * 60 * 1000),
      )
        ? 10_000
        : false,
  });

  const [view, setView] = useState<View>("waiting");
  const [composing, setComposing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<SocialAccount | null>(null);

  const go = useMutation({
    mutationFn: (platform: Platform) => connect({ data: { platform } }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grouped = useMemo(() => {
    const all = posts.data ?? [];
    return {
      waiting: all
        .filter((p) => p.status === "scheduled" || p.status === "uploading")
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      posted: all.filter((p) => p.status === "published"),
      other: all.filter((p) => p.status === "failed" || p.status === "canceled"),
    };
  }, [posts.data]);

  const platforms = setup.data?.platforms ?? [];
  const list = accounts.data ?? [];

  return (
    <AppShell
      title="Publishing"
      subtitle="Post your exports to YouTube, TikTok and Instagram, now or on a schedule."
    >
      <div className="space-y-6">
        {/* Accounts */}
        <section className="rounded-2xl bg-white border border-black/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-sm font-semibold">Connected accounts</div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Stuccord posts as these accounts. You can disconnect any time.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {platforms.map((pl) => (
                <Button
                  key={pl}
                  size="sm"
                  variant="outline"
                  onClick={() => go.mutate(pl)}
                  disabled={go.isPending}
                >
                  {go.isPending && go.variables === pl ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <PlatformIcon platform={pl} className="w-4 h-4 mr-1.5" />
                  )}
                  Connect {PLATFORM_LABEL[pl]}
                </Button>
              ))}
            </div>
          </div>

          {setup.isSuccess && platforms.length === 0 && (
            <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-900 mb-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Posting isn&apos;t switched on yet: the site owner still has to add the YouTube,
                TikTok or Instagram app keys. You can come back to connect your accounts once it is.
              </span>
            </div>
          )}

          {accounts.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : accounts.error ? (
            <p className="text-sm text-rose-600">
              {accounts.error instanceof Error
                ? accounts.error.message
                : "Couldn't load your accounts"}
            </p>
          ) : list.length === 0 ? (
            <p className="text-sm text-neutral-500">No accounts connected yet.</p>
          ) : (
            <div className="divide-y divide-black/5 rounded-xl border border-black/10">
              {list.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                  {a.avatar_url ? (
                    <img src={a.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-neutral-100 grid place-items-center">
                      <PlatformIcon platform={a.platform} className="w-4 h-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-[11px] text-neutral-500 flex items-center gap-1">
                      <PlatformIcon platform={a.platform} className="w-3 h-3" />
                      {PLATFORM_LABEL[a.platform]}
                      {a.status !== "active" && (
                        <span className="text-amber-700">· needs reconnecting</span>
                      )}
                    </div>
                  </div>
                  {a.status !== "active" && platforms.includes(a.platform) && (
                    <Button size="sm" variant="outline" onClick={() => go.mutate(a.platform)}>
                      Reconnect
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    onClick={() => setDisconnecting(a)}
                  >
                    <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Posts */}
        <section className="rounded-2xl bg-white border border-black/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div role="tablist" aria-label="Posts" className="flex gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[13px] font-medium transition",
                    view === v.id
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-600 hover:bg-neutral-100",
                  )}
                >
                  {v.label}
                  <span className="ml-1.5 tabular-nums opacity-60">{grouped[v.id].length}</span>
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setComposing(true)} disabled={list.length === 0}>
              <Plus className="w-4 h-4 mr-1.5" /> New post
            </Button>
          </div>

          {posts.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : posts.error ? (
            <p className="text-sm text-rose-600">
              {posts.error instanceof Error ? posts.error.message : "Couldn't load your posts"}
            </p>
          ) : grouped[view].length === 0 ? (
            <p className="text-sm text-neutral-500 py-6 text-center">
              {view === "waiting"
                ? "Nothing scheduled. Use New post, or Publish in the editor."
                : view === "posted"
                  ? "Nothing posted yet."
                  : "Nothing here."}
            </p>
          ) : (
            <div className="divide-y divide-black/5 rounded-xl border border-black/10">
              {grouped[view].map((p) => (
                <PostRow
                  key={p.id}
                  post={p}
                  onChanged={() => qc.invalidateQueries({ queryKey: ["social-posts"] })}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <PublishDialog open={composing} onOpenChange={setComposing} />
      <DisconnectDialog account={disconnecting} onClose={() => setDisconnecting(null)} />
    </AppShell>
  );
}

function StatusBadge({ post }: { post: SocialPost }) {
  if (post.status === "published" && isDraft(post)) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-pink-50 text-pink-700">
        Sent to TikTok drafts
      </span>
    );
  }
  const map: Record<SocialPost["status"], [string, string]> = {
    scheduled: ["Scheduled", "bg-violet-50 text-violet-700"],
    uploading: ["Uploading…", "bg-sky-50 text-sky-700"],
    published: ["Posted", "bg-emerald-50 text-emerald-700"],
    failed: ["Failed", "bg-rose-50 text-rose-700"],
    canceled: ["Canceled", "bg-neutral-100 text-neutral-600"],
  };
  const [label, cls] = map[post.status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full",
        cls,
      )}
    >
      {post.status === "uploading" && <Loader2 className="w-3 h-3 animate-spin" />}
      {label}
    </span>
  );
}

function PostRow({ post, onChanged }: { post: SocialPost; onChanged: () => void }) {
  const cancel = useServerFn(cancelPost);
  const move = useServerFn(reschedulePost);
  const remove = useServerFn(deletePost);
  const [moveOpen, setMoveOpen] = useState(false);
  const [when, setWhen] = useState(() => localInput(new Date(post.scheduled_at)));

  const act = useMutation({
    mutationFn: async (a: { kind: "cancel" | "retry" | "move" | "delete" }) => {
      if (a.kind === "cancel") return cancel({ data: { id: post.id } });
      if (a.kind === "delete") return remove({ data: { id: post.id } });
      return move({
        data: { id: post.id, scheduledAt: a.kind === "move" ? new Date(when).toISOString() : null },
      });
    },
    onSuccess: (_r, a) => {
      toast.success(
        a.kind === "cancel"
          ? "Post canceled"
          : a.kind === "delete"
            ? "Removed"
            : a.kind === "move"
              ? `Moved to ${fmtWhen(new Date(when).toISOString())}`
              : "Trying again now",
      );
      setMoveOpen(false);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const timeLabel =
    post.status === "published" && post.published_at
      ? `${isDraft(post) ? "Sent" : "Posted"} ${fmtWhen(post.published_at)}`
      : post.status === "scheduled"
        ? `Goes out ${fmtWhen(post.scheduled_at)}`
        : fmtWhen(post.scheduled_at);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <PlatformIcon platform={post.platform} className="w-4 h-4 shrink-0" />
          <span className="text-sm font-medium truncate">
            {post.title ||
              post.caption.split("\n")[0] ||
              (isStory(post) ? "Instagram Story" : `${PLATFORM_LABEL[post.platform]} post`)}
          </span>
          <StatusBadge post={post} />
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5 truncate">
          {post.account_name}
          {post.project_title ? ` · ${post.project_title}` : ""} · {timeLabel}
          {audience(post) ? ` · ${audience(post)}` : ""}
        </div>
        {post.error && post.status !== "published" && (
          <div
            className={cn(
              "text-[12px] mt-1",
              post.status === "failed" ? "text-rose-600" : "text-neutral-500",
            )}
          >
            {post.error}
          </div>
        )}
      </div>

      {post.status === "published" && !isDraft(post) && (
        <div className="flex items-center gap-4 text-[12px] text-neutral-600 tabular-nums">
          <span className="flex items-center gap-1" title="Views">
            <Eye className="w-3.5 h-3.5" /> {fmtNum(post.views)}
          </span>
          <span className="flex items-center gap-1" title="Likes">
            <ThumbsUp className="w-3.5 h-3.5" /> {fmtNum(post.likes)}
          </span>
          <span className="flex items-center gap-1" title="Comments">
            <MessageCircle className="w-3.5 h-3.5" /> {fmtNum(post.comments)}
          </span>
          {post.external_url && (
            <a
              href={post.external_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-violet-700 font-medium hover:underline"
            >
              Open <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      <div className="flex items-center gap-1">
        {post.status === "scheduled" && (
          <>
            <Popover open={moveOpen} onOpenChange={setMoveOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                  <CalendarClock className="w-3.5 h-3.5 mr-1" /> Move
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto space-y-2" align="end">
                <Input
                  type="datetime-local"
                  aria-label="New time"
                  value={when}
                  min={localInput(new Date(Date.now() + 5 * 60 * 1000))}
                  max={localInput(new Date(Date.now() + SCHEDULE_MAX_AHEAD_DAYS * 86_400_000))}
                  onChange={(e) => setWhen(e.target.value)}
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: "retry" })}>
                    Post now
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => act.mutate({ kind: "move" })}
                    disabled={act.isPending || !when}
                  >
                    Save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              onClick={() => act.mutate({ kind: "cancel" })}
              disabled={act.isPending}
            >
              <X className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
          </>
        )}
        {post.status === "failed" && post.account_id && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => act.mutate({ kind: "retry" })}
            disabled={act.isPending}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Try again
          </Button>
        )}
        {(post.status === "failed" || post.status === "canceled") && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Remove"
            className="text-neutral-500"
            onClick={() => act.mutate({ kind: "delete" })}
            disabled={act.isPending}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function DisconnectDialog({
  account,
  onClose,
}: {
  account: SocialAccount | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const drop = useServerFn(disconnectAccount);
  const m = useMutation({
    mutationFn: (id: string) => drop({ data: { id } }),
    onSuccess: () => {
      toast.success("Disconnected");
      void qc.invalidateQueries({ queryKey: ["social-accounts"] });
      void qc.invalidateQueries({ queryKey: ["social-posts"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {account?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Stuccord signs out of this account and its scheduled posts are canceled. Videos already
            posted stay up.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            className="bg-rose-600 hover:bg-rose-700"
            onClick={(e) => {
              e.preventDefault();
              if (account) m.mutate(account.id);
            }}
          >
            {m.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
