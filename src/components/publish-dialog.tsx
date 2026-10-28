// Post a finished export to connected accounts, now or at a set time.
// Opened from the editor (Publish button) and from the Publishing page.

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Send } from "lucide-react";
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
import { PlatformIcon } from "@/components/platform-icon";
import { InstagramSection } from "@/components/publish-instagram";
import { TikTokSection } from "@/components/publish-tiktok";
import { NEW_INSTAGRAM_FORM, instagramFormProblem } from "@/lib/instagram-form";
import {
  NEW_TIKTOK_FORM,
  tiktokFormProblem,
  tiktokOptions,
  type TikTokForm,
} from "@/lib/tiktok-form";
import { cn } from "@/lib/utils";
import { listProjects } from "@/lib/projects.functions";
import {
  createPosts,
  getExportPreview,
  getTikTokCreatorInfo,
  listSocialAccounts,
} from "@/lib/publishing.functions";
import {
  CAPTION_MAX,
  PLATFORM_LABEL,
  SCHEDULE_MAX_AHEAD_DAYS,
  TIKTOK_CAPTION_MAX,
  INSTAGRAM_CAPTION_MAX,
  type InstagramOptions,
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
  const fetchPreview = useServerFn(getExportPreview);
  const fetchCreator = useServerFn(getTikTokCreatorInfo);
  const post = useServerFn(createPosts);
  const accounts = useQuery({
    queryKey: ["social-accounts"],
    queryFn: () => fetchAccounts(),
    enabled: open,
    retry: false,
  });
  const projects = useQuery({
    queryKey: ["projects", "personal"],
    queryFn: () => fetchProjects({ data: { workspace: "personal" } }),
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
  const [tiktok, setTiktok] = useState<Record<string, TikTokForm>>({});
  const [instagram, setInstagram] = useState<Record<string, InstagramOptions>>({});
  const [videoSeconds, setVideoSeconds] = useState<number | null>(null);

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
    setTiktok({});
    setInstagram({});
    setVideoSeconds(null);
  }, [open, defaultTitle]);

  const all = accounts.data ?? [];
  // Every working account is ticked to start with.
  useEffect(() => {
    if (open) setPicked(all.filter((a) => a.status === "active").map((a) => a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accounts.data]);

  const project = projectId ?? pickedProject;
  const preview = useQuery({
    queryKey: ["export-preview", project],
    queryFn: () => fetchPreview({ data: { projectId: project } }),
    enabled: open && !!project,
    staleTime: 30 * 60 * 1000,
  });

  const chosen = all.filter((a) => picked.includes(a.id));
  const hasYoutube = chosen.some((a) => a.platform === "youtube");
  const tiktokAccounts = chosen.filter((a) => a.platform === "tiktok");
  const hasTiktok = tiktokAccounts.length > 0;
  // TikTok asks apps to check the account each time the form is shown.
  const creators = useQueries({
    queries: tiktokAccounts.map((a) => ({
      queryKey: ["tiktok-creator", a.id],
      queryFn: () => fetchCreator({ data: { accountId: a.id } }),
      enabled: open,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    })),
  });
  const formFor = (id: string) => tiktok[id] ?? NEW_TIKTOK_FORM;
  const problems = tiktokAccounts.map((a, i) =>
    tiktokFormProblem(formFor(a.id), creators[i]?.data, videoSeconds),
  );
  const tiktokBlocked = tiktokAccounts.some(
    (a, i) => formFor(a.id).mode === "direct" && (!!creators[i]?.error || !!problems[i]),
  );
  const anyDirect = tiktokAccounts.some((a) => formFor(a.id).mode === "direct");
  const anyBranded = tiktokAccounts.some((a) => {
    const f = formFor(a.id);
    return f.mode === "direct" && f.disclose && f.brand_content;
  });
  const igAccounts = chosen.filter((a) => a.platform === "instagram");
  const hasInstagram = igAccounts.length > 0;
  const igFormFor = (id: string) => instagram[id] ?? NEW_INSTAGRAM_FORM;
  const igProblems = igAccounts.map((a) =>
    preview.data?.ext === "webm"
      ? "Instagram needs an MP4. Export with Render Video (the cloud export), then post."
      : instagramFormProblem(igFormFor(a.id), caption.trim() || title, videoSeconds),
  );
  const igBlocked = igProblems.some((x) => !!x);
  // Platforms that use the text box as their caption.
  const captioned = hasTiktok || igAccounts.some((a) => igFormFor(a.id).kind === "reel");
  const captionMax = hasTiktok
    ? TIKTOK_CAPTION_MAX
    : hasInstagram
      ? INSTAGRAM_CAPTION_MAX
      : CAPTION_MAX;

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
          tiktok: Object.fromEntries(
            tiktokAccounts.map((a) => [a.id, tiktokOptions(formFor(a.id))]),
          ),
          instagram: Object.fromEntries(igAccounts.map((a) => [a.id, igFormFor(a.id)])),
          scheduledAt: later ? new Date(when).toISOString() : null,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.scheduled
          ? `Scheduled for ${new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
          : hasTiktok || hasInstagram
            ? `Posting now. ${hasTiktok && hasInstagram ? "TikTok and Instagram" : hasTiktok ? "TikTok" : "Instagram"} can take a few minutes to process it before it shows on the profile.`
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
  const textOk = (!hasYoutube || !!title.trim()) && caption.length <= captionMax;
  const ready =
    !!project &&
    picked.length > 0 &&
    textOk &&
    whenOk &&
    !tiktokBlocked &&
    !igBlocked &&
    !send.isPending;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const t = (light: string, darkCls: string) => (dark ? darkCls : light);
  const fieldCls = t(
    "",
    "bg-white/5 border-white/10 text-neutral-100 placeholder:text-neutral-500",
  );
  const muted = t("text-neutral-500", "text-neutral-400");
  const switchCls = t("", "data-[state=unchecked]:bg-white/20");
  const linkCls = t("text-violet-700 underline", "text-violet-300 underline");

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
        ) : all.length === 0 ? (
          <div className="py-6 text-center space-y-3">
            <p className={cn("text-sm", muted)}>
              Connect a YouTube, TikTok or Instagram account first.
            </p>
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
                      setVideoSeconds(null);
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

            {preview.data?.url && (
              <video
                key={preview.data.url}
                src={preview.data.url}
                controls
                playsInline
                preload="metadata"
                aria-label="Preview of the video you're posting"
                onLoadedMetadata={(e) =>
                  setVideoSeconds(
                    Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null,
                  )
                }
                className="w-full max-h-56 rounded-lg bg-black object-contain"
              />
            )}

            <div className="space-y-1.5">
              <Label>Post to</Label>
              <div className="space-y-1.5">
                {all.map((a) => {
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
                        <PlatformIcon platform={a.platform} className="w-5 h-5" />
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

            {hasYoutube && (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="pub-title">
                    {hasTiktok || hasInstagram ? "Title (YouTube)" : "Title"}
                  </Label>
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
            )}

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="pub-caption">
                  {hasYoutube && captioned
                    ? "Description and caption"
                    : captioned
                      ? "Caption"
                      : "Description"}
                </Label>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    caption.length > captionMax ? "text-rose-500" : muted,
                  )}
                >
                  {caption.length}/{captionMax}
                </span>
              </div>
              <Textarea
                id="pub-caption"
                rows={4}
                value={caption}
                maxLength={CAPTION_MAX}
                onChange={(e) => setCaption(e.target.value)}
                placeholder={
                  captioned
                    ? "Say what it's about and add #hashtags"
                    : "Say more, add links and #hashtags (#Shorts helps vertical videos)"
                }
                className={fieldCls}
              />
              {captioned && !caption.trim() && hasYoutube && (
                <p className={cn("text-[11px]", muted)}>
                  Empty: the title is used as the caption instead.
                </p>
              )}
            </div>

            {hasYoutube && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>
                    {hasTiktok || hasInstagram ? "Who can watch (YouTube)" : "Who can watch"}
                  </Label>
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
            )}

            {tiktokAccounts.map((a, i) => (
              <TikTokSection
                key={a.id}
                account={a}
                form={formFor(a.id)}
                onChange={(f) => setTiktok((cur) => ({ ...cur, [a.id]: f }))}
                info={creators[i]?.data}
                infoError={
                  creators[i]?.error
                    ? creators[i].error instanceof Error
                      ? creators[i].error.message
                      : "Couldn't check this TikTok account"
                    : null
                }
                problem={problems[i]}
                dark={dark}
              />
            ))}

            {igAccounts.map((a, i) => (
              <InstagramSection
                key={a.id}
                account={a}
                form={igFormFor(a.id)}
                onChange={(f) => setInstagram((cur) => ({ ...cur, [a.id]: f }))}
                problem={igProblems[i]}
                dark={dark}
              />
            ))}

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

            {anyDirect && (
              <p className={cn("text-[12px]", muted)} data-tiktok-consent>
                By posting, you agree to TikTok&apos;s{" "}
                {anyBranded && (
                  <>
                    <a
                      href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                      target="_blank"
                      rel="noreferrer"
                      className={linkCls}
                    >
                      Branded Content Policy
                    </a>{" "}
                    and{" "}
                  </>
                )}
                <a
                  href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                  target="_blank"
                  rel="noreferrer"
                  className={linkCls}
                >
                  Music Usage Confirmation
                </a>
                .
              </p>
            )}
          </div>
        )}

        {all.length > 0 && (
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
