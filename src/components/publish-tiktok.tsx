// The TikTok part of the Publish dialog, one per TikTok account. It follows
// TikTok's rules for apps that post: show the account, make the poster pick
// who can see it (nothing chosen for them), let them allow comments, Duet and
// Stitch (off to start, and greyed out where the account has them off), and
// ask whether the video promotes a brand.

import { AlertTriangle, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlatformIcon } from "@/components/platform-icon";
import { cn } from "@/lib/utils";
import {
  TIKTOK_PRIVACY_LABEL,
  type SocialAccount,
  type TikTokCreatorInfo,
  type TikTokPrivacy,
} from "@/lib/publishing-shared";
import type { TikTokForm } from "@/lib/tiktok-form";

export function TikTokSection({
  account,
  form,
  onChange,
  info,
  infoError,
  problem,
  dark,
}: {
  account: SocialAccount;
  form: TikTokForm;
  onChange: (f: TikTokForm) => void;
  info: TikTokCreatorInfo | undefined;
  infoError: string | null;
  problem: string | null;
  dark: boolean;
}) {
  const set = (patch: Partial<TikTokForm>) => onChange({ ...form, ...patch });
  const muted = dark ? "text-neutral-400" : "text-neutral-500";
  const border = dark ? "border-white/10" : "border-black/10";
  const fieldCls = dark ? "bg-white/5 border-white/10 text-neutral-100" : "";
  const switchCls = dark ? "data-[state=unchecked]:bg-white/20" : "";
  const id = (k: string) => `tt-${account.id}-${k}`;

  const toggle = (
    k: "allow_comment" | "allow_duet" | "allow_stitch",
    label: string,
    off: boolean,
  ) => (
    <label
      className={cn("flex items-center gap-2 text-[13px]", off && "opacity-50 cursor-not-allowed")}
      title={off ? "Turned off in this account's TikTok settings" : undefined}
    >
      <input
        type="checkbox"
        className="accent-violet-600"
        checked={form[k] && !off}
        disabled={off}
        onChange={(e) => set({ [k]: e.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <div className={cn("rounded-lg border p-3 space-y-3", border)} data-tiktok-section={account.id}>
      <div className="flex items-center gap-2">
        {info?.avatar_url || account.avatar_url ? (
          <img
            src={info?.avatar_url ?? account.avatar_url!}
            alt=""
            className="w-6 h-6 rounded-full"
          />
        ) : (
          <PlatformIcon platform="tiktok" className="w-5 h-5" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            TikTok · {info?.nickname || account.name}
          </div>
          {info?.username && <div className={cn("text-[11px]", muted)}>@{info.username}</div>}
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label={`How to post to ${account.name}`}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(
          [
            ["direct", "Post to profile", "Goes up with the choices below"],
            ["draft", "Send to TikTok drafts", "Finish it in the TikTok app"],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={form.mode === value}
            onClick={() => set({ mode: value })}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition",
              form.mode === value
                ? dark
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-violet-500 bg-violet-50"
                : border,
            )}
          >
            <div className="text-[13px] font-medium">{label}</div>
            <div className={cn("text-[11px]", muted)}>{hint}</div>
          </button>
        ))}
      </div>

      {form.mode === "draft" ? (
        <p className={cn("text-[12px]", muted)}>
          TikTok sends the video to the account&apos;s inbox. Open TikTok to add sounds and effects,
          then post it from there.
        </p>
      ) : infoError ? (
        <div className="flex gap-2 text-[13px] text-rose-500">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {infoError}
        </div>
      ) : !info ? (
        <div className={cn("flex items-center gap-2 text-xs", muted)}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking what this account can post…
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>Who can see this video</Label>
            <Select
              value={form.privacy}
              onValueChange={(v) => set({ privacy: v as TikTokPrivacy })}
            >
              <SelectTrigger aria-label={`Who can see it on ${account.name}`} className={fieldCls}>
                <SelectValue placeholder="Choose who can see it" />
              </SelectTrigger>
              <SelectContent>
                {info.privacy_level_options.map((p) => (
                  <SelectItem
                    key={p}
                    value={p}
                    disabled={p === "SELF_ONLY" && form.disclose && form.brand_content}
                  >
                    {TIKTOK_PRIVACY_LABEL[p]}
                    {p === "SELF_ONLY" && form.disclose && form.brand_content
                      ? " (not for branded content)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Let viewers</Label>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {toggle("allow_comment", "Comment", info.comment_disabled)}
              {toggle("allow_duet", "Duet", info.duet_disabled)}
              {toggle("allow_stitch", "Stitch", info.stitch_disabled)}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch
                id={id("disclose")}
                checked={form.disclose}
                onCheckedChange={(v) =>
                  set({ disclose: v, ...(v ? {} : { brand_organic: false, brand_content: false }) })
                }
                className={switchCls}
              />
              <Label htmlFor={id("disclose")}>Disclose video content</Label>
            </div>
            {form.disclose && (
              <div className="space-y-2 pl-1">
                <p className={cn("text-[12px]", muted)}>
                  Turn this on if the video promotes goods or services in exchange for something of
                  value. It can promote you, a third party, or both.
                </p>
                <label className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="accent-violet-600 mt-0.5"
                    checked={form.brand_organic}
                    onChange={(e) => set({ brand_organic: e.target.checked })}
                  />
                  <span>
                    Your brand
                    <span className={cn("block text-[11px]", muted)}>
                      You&apos;re promoting yourself or your own business. TikTok labels it
                      &quot;Promotional content&quot;.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="accent-violet-600 mt-0.5"
                    checked={form.brand_content}
                    onChange={(e) => set({ brand_content: e.target.checked })}
                  />
                  <span>
                    Branded content
                    <span className={cn("block text-[11px]", muted)}>
                      You&apos;re promoting another brand or a third party. TikTok labels it
                      &quot;Paid partnership&quot;.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>
        </>
      )}

      {problem && form.mode === "direct" && info && (
        <p className="text-[12px] text-amber-600">{problem}</p>
      )}
    </div>
  );
}
