import { Instagram, Music2, Send, Youtube } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/publishing-shared";

/** A small mark for each platform you can post to. */
export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  if (platform === "youtube") return <Youtube className={cn("text-red-500", className)} />;
  if (platform === "tiktok") return <Music2 className={cn("text-pink-500", className)} />;
  if (platform === "instagram") return <Instagram className={cn("text-fuchsia-600", className)} />;
  return <Send className={className} />;
}
