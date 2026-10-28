// The Instagram part of the Publish dialog, one per Instagram account: post
// the video as a Reel (and choose whether it also shows in the feed) or as a
// Story.

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PlatformIcon } from "@/components/platform-icon";
import { cn } from "@/lib/utils";
import type { InstagramOptions, SocialAccount } from "@/lib/publishing-shared";

export function InstagramSection({
  account,
  form,
  onChange,
  problem,
  dark,
}: {
  account: SocialAccount;
  form: InstagramOptions;
  onChange: (f: InstagramOptions) => void;
  problem: string | null;
  dark: boolean;
}) {
  const muted = dark ? "text-neutral-400" : "text-neutral-500";
  const border = dark ? "border-white/10" : "border-black/10";
  const id = `ig-${account.id}-feed`;

  return (
    <div
      className={cn("rounded-lg border p-3 space-y-3", border)}
      data-instagram-section={account.id}
    >
      <div className="flex items-center gap-2">
        {account.avatar_url ? (
          <img src={account.avatar_url} alt="" className="w-6 h-6 rounded-full" />
        ) : (
          <PlatformIcon platform="instagram" className="w-5 h-5" />
        )}
        <div className="text-sm font-medium truncate">Instagram · {account.name}</div>
      </div>

      <div
        role="radiogroup"
        aria-label={`How to post to ${account.name}`}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(
          [
            ["reel", "Reel", "With your caption, up to 15 minutes"],
            ["story", "Story", "Gone after 24 hours, up to 60 seconds"],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={form.kind === value}
            onClick={() =>
              onChange(value === "reel" ? { kind: "reel", share_to_feed: true } : { kind: "story" })
            }
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition",
              form.kind === value
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

      {form.kind === "reel" ? (
        <div className="flex items-start gap-2">
          <Switch
            id={id}
            checked={form.share_to_feed}
            onCheckedChange={(v) => onChange({ kind: "reel", share_to_feed: v })}
            className={cn(dark && "data-[state=unchecked]:bg-white/20")}
          />
          <div>
            <Label htmlFor={id}>Also show in the feed</Label>
            <p className={cn("text-[11px]", muted)}>
              {form.share_to_feed
                ? "It shows on the profile grid and in followers' feeds, as well as in Reels."
                : "It only shows in the Reels tab."}
            </p>
          </div>
        </div>
      ) : (
        <p className={cn("text-[12px]", muted)}>
          Stories don&apos;t have captions. Your followers see it for 24 hours.
        </p>
      )}

      {problem && <p className="text-[12px] text-amber-600">{problem}</p>}
    </div>
  );
}
