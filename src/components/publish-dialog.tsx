// Post a finished export to connected accounts, now or at a set time.
// Opened from the editor (Publish button) and from the Publishing page.

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Send, Youtube } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listProjects } from "@/lib/projects.functions";
import { createPosts, listSocialAccounts } from "@/lib/publishing.functions";
import {
  CAPTION_MAX,
  PLATFORM_LABEL,
  SCHEDULE_MAX_AHEAD_DAYS,
  TITLE_MAX,
  type Privacy,
} from "@/lib/publishing-shared";

/** A datetime-local value (the user's own time) for a Date. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function PublishDialog({
  open,
  onOpenChange,
  projectId,
  defaultTitle = "",
  dark = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Post this project's latest export; without it, the user picks one. */
  projectId?: string;
  defaultTitle?: string;
  /** The editor's dark look. */
  dark?: boolean;
}) {
  const qc = useQueryClient();
  const fetchAccounts = useServerFn(listSocialAccounts);
  const fetchProjects = useServerFn(listProjects);
  const post = useServerFn(createPosts);
  const accounts = useQuery({
    queryKey: ["social-accounts"],
    queryFn: () => fetchAccounts(),
    enabled: open,
    retry: false,
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchProjects(),
    enabled: open && !projectId,
  });
  const exported = useMemo(
    () => (projects.data ?? []).filter((p) => !!p.output_path),
    [projects.data],
  );

  const [pickedProject, setPickedProject] = useState<string>("");
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState(defaultTitle);
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [forKids, setForKids] = useState(false);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState("");

  // Fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setPickedProject("");
    setTitle(defaultTitle);
    setCaption("");
    setPrivacy("public");
    setForKids(false);
    setLater(false);
    setWhen(localInput(new Date(Date.now() + 60 * 60 * 1000)));
  }, [open, defaultTitle]);

  const active = (accounts.data ?? []).filter((a) => a.status === "active");
  // Every working account is ticked to start with.
  useEffect(() => {
    if (open) setPicked(active.map((a) => a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accounts.data]);

  const project = projectId ?? pickedProject;
  const send = useMutation({
    mutationFn: () =>
      post({
        data: {
          projectId: project,
          accountIds: picked,
          title: title.trim(),
          caption,
          privacy,
          madeForKids: forKids,
          scheduledAt: later ? new Date(when).toISOString() : null,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.scheduled
          ? `Scheduled for ${new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
          : r.created === 1
            ? "Posting now: it shows on the Publishing page when it's up"
            : `Posting to ${r.created} accounts now`,
      );
      void qc.invalidateQueries({ queryKey: ["social-posts"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const whenOk = !later || (when && !Number.isNaN(new Date(when).getTime()));
  const ready = !!project && picked.length > 0 && !!title.trim() && whenOk && !send.isPending;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const t = (light: string, darkCls: string) => (dark ? darkCls : light);
  const fieldCls = t(
    "",
    "bg-white/5 border-white/10 text-neutral-100 placeholder:text-neutral-500",
  );
  const muted = t("text-neutral-500", "text-neutral-400");
  const switchCls = t("", "data-[state=unchecked]:bg-white/20");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-[560px] max-h-[92vh] overflow-y-auto",
          dark && "bg-[#0f0f18] border-white/10 text-neutral-100",
        )}
      >
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2", dark && "text-neutral-50")}>
            <Send className="w-4 h-4 text-violet-500" /> Publish
          </DialogTitle>
          <DialogDescription className={muted}>
            Post your latest export to your connected accounts, now or later.
          </DialogDescription>
        </DialogHeader>

        {accounts.isLoading ? (
          <div className={cn("flex items-center gap-2 text-sm py-6", muted)}>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your accounts…
          </div>
        ) : accounts.error ? (
          <p className="text-sm text-rose-500 py-4">
            {accounts.error instanceof Error
              ? accounts.error.message
              : "Couldn't load your accounts"}
          </p>
        ) : (accounts.data ?? []).length === 0 ? (
          <div className="py-6 text-center space-y-3">
            <p className={cn("text-sm", muted)}>Connect a YouTube channel first.</p>
            <Button asChild size="sm">
              <Link to="/publishing">Go to Publishing</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {!projectId && (
              <div className="space-y-1.5">
                <Label>Video</Label>
                {projects.isLoading ? (
                  <div className={cn("text-xs", muted)}>Loading projects…</div>
                ) : exported.length === 0 ? (
                  <p className={cn("text-xs", muted)}>
                    No exported videos yet. Open a project and export it first.
                  </p>
                ) : (
                  <Select
                    value={pickedProject}
                    onValueChange={(v) => {
                      setPickedProject(v);
                      if (!title.trim())
                        setTitle(exported.find((p) => p.id === v)?.title.slice(0, TITLE_MAX) ?? "");
                    }}
                  >
                    <SelectTrigger aria-label="Video" className={fieldCls}>
                      <SelectValue placeholder="Pick an exported project" />
                    </SelectTrigger>
                    <SelectContent>
                      {exported.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Post to</Label>
              <div className="space-y-1.5">
                {(accounts.data ?? []).map((a) => {
                  const on = picked.includes(a.id);
                  const broken = a.status !== "active";
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer",
                        t("border-black/10", "border-white/10"),
                        on &&
                          t("border-violet-500 bg-violet-50", "border-violet-500 bg-violet-500/10"),
                        broken && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="accent-violet-600"
                        checked={on}
                        disabled={broken}
                        onChange={(e) =>
                          setPicked((cur) =>
                            e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id),
                          )
                        }
                      />
                      {a.avatar_url ? (
                        <img src={a.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                      ) : (
                        <Youtube className="w-5 h-5 text-red-500" />
                      )}
                      <span className="text-sm font-medium truncate flex-1">{a.name}</span>
                      <span className={cn("text-[11px]", broken ? "text-amber-600" : muted)}>
                        {broken ? "Reconnect on the Publishing page" : PLATFORM_LABEL[a.platform]}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="pub-title">Title</Label>
                <span className={cn("text-[11px] tabular-nums", muted)}>
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <Input
                id="pub-title"
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's this video about?"
                className={fieldCls}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="pub-caption">Description</Label>
                <span className={cn("text-[11px] tabular-nums", muted)}>
                  {caption.length}/{CAPTION_MAX}
                </span>
              </div>
              <Textarea
                id="pub-caption"
                rows={4}
                value={caption}
                maxLength={CAPTION_MAX}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Say more, add links and #hashtags (#Shorts helps vertical videos)"
                className={fieldCls}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Who can watch</Label>
                <Select value={privacy} onValueChange={(v) => setPrivacy(v as Privacy)}>
                  <SelectTrigger aria-label="Who can watch" className={fieldCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="unlisted">Unlisted (anyone with the link)</SelectItem>
                    <SelectItem value="private">Private (only you)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-kids">Made for kids</Label>
                <div className="flex items-center gap-2 h-10">
                  <Switch
                    id="pub-kids"
                    checked={forKids}
                    onCheckedChange={setForKids}
                    className={switchCls}
                  />
                  <span className={cn("text-xs", muted)}>
                    {forKids ? "Yes, it's made for kids" : "No"}
                  </span>
                </div>
              </div>
            </div>

            <div
              className={cn(
                "rounded-lg border p-3 space-y-2",
                t("border-black/10", "border-white/10"),
              )}
            >
              <div className="flex items-center gap-2">
                <Switch
                  id="pub-later"
                  checked={later}
                  onCheckedChange={setLater}
                  className={switchCls}
                />
                <Label htmlFor="pub-later" className="flex items-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5" /> Schedule for later
                </Label>
              </div>
              {later && (
                <div className="space-y-1">
                  <Input
                    type="datetime-local"
                    aria-label="When to post"
                    value={when}
                    min={localInput(new Date(Date.now() + 5 * 60 * 1000))}
                    max={localInput(new Date(Date.now() + SCHEDULE_MAX_AHEAD_DAYS * 86_400_000))}
                    onChange={(e) => setWhen(e.target.value)}
                    className={cn("w-fit", fieldCls)}
                  />
                  <p className={cn("text-[11px]", muted)}>
                    Your time ({tz}). Up to {SCHEDULE_MAX_AHEAD_DAYS} days ahead.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {(accounts.data ?? []).length > 0 && (
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className={cn(dark && "text-neutral-300 hover:bg-white/5 hover:text-white")}
            >
              Cancel
            </Button>
            <Button onClick={() => send.mutate()} disabled={!ready}>
              {send.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : later ? (
                <CalendarClock className="w-4 h-4 mr-1.5" />
              ) : (
                <Send className="w-4 h-4 mr-1.5" />
              )}
              {later ? "Schedule" : "Post now"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
