// The New project page's "Your pictures": screenshots or photos the creator
// wants in the video, each with an optional note. The automatic edit shows
// each one where they talk about it (src/lib/user-pictures.ts).

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MAX_PICTURE_NOTE,
  MAX_USER_PICTURES,
  USER_PICTURE_ACCEPT,
  userPictureType,
} from "@/lib/user-pictures";

/** Largest picture the page takes before shrinking it (a phone photo is well under). */
const MAX_PICTURE_MB = 25;

export type PendingPicture = {
  id: string;
  file: File;
  /** A local URL for its thumbnail (released when it's removed). */
  url: string;
  note: string;
};

export function NewProjectPictures({
  pictures,
  onChange,
  disabled,
}: {
  pictures: PendingPicture[];
  onChange: (next: PendingPicture[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function add(list: FileList | File[]) {
    const wrong: string[] = [];
    const big: string[] = [];
    const added: PendingPicture[] = [];
    for (const file of Array.from(list)) {
      if (!userPictureType(file)) wrong.push(file.name);
      else if (file.size > MAX_PICTURE_MB * 1024 * 1024) big.push(file.name);
      else if (pictures.some((p) => p.file.name === file.name && p.file.size === file.size))
        continue;
      else added.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), note: "" });
    }
    if (wrong.length)
      toast.error(`${wrong.join(", ")}: only JPG, PNG or WebP pictures can be added.`);
    if (big.length) toast.error(`${big.join(", ")}: over ${MAX_PICTURE_MB} MB.`);
    const room = MAX_USER_PICTURES - pictures.length;
    if (added.length > room) {
      toast.error(`Up to ${MAX_USER_PICTURES} pictures a video.`);
      for (const p of added.slice(Math.max(0, room))) URL.revokeObjectURL(p.url);
    }
    const kept = added.slice(0, Math.max(0, room));
    if (kept.length) onChange([...pictures, ...kept]);
  }

  function remove(id: string) {
    const gone = pictures.find((p) => p.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    onChange(pictures.filter((p) => p.id !== id));
  }

  const full = pictures.length >= MAX_USER_PICTURES;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Your pictures <span className="font-normal text-muted-foreground">· optional</span>
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {pictures.length}/{MAX_USER_PICTURES}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Screenshots or photos you want in the video: a dashboard, a payout, a post, your product.
        The AI shows each one when you talk about it. A note helps it pick the moment.
      </p>

      {pictures.length > 0 && (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {pictures.map((p, i) => (
            <li key={p.id} className="flex gap-3 rounded-2xl border border-border bg-card p-2.5">
              <img
                src={p.url}
                alt={p.file.name}
                className="h-[72px] w-[72px] shrink-0 rounded-lg bg-black object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium">{p.file.name}</div>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    disabled={disabled}
                    aria-label={`Remove ${p.file.name}`}
                    className="rounded-md p-1 hover:bg-white/5 disabled:opacity-50"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
                <Input
                  aria-label={`Note for picture ${i + 1}`}
                  className="h-8 text-xs"
                  maxLength={MAX_PICTURE_NOTE}
                  placeholder="When to show it, e.g. when I talk about my first $10k"
                  value={p.note}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange(
                      pictures.map((x) => (x.id === p.id ? { ...x, note: e.target.value } : x)),
                    )
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-sm transition-colors disabled:opacity-50",
            dragOver
              ? "border-primary bg-white/[0.06] text-foreground"
              : "border-border text-muted-foreground hover:border-white/20 hover:text-foreground",
          )}
        >
          <ImagePlus className="h-4 w-4" />
          {pictures.length ? "Add more pictures" : "Add screenshots or photos"}
          <span className="text-xs text-muted-foreground/80">· JPG, PNG or WebP</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={USER_PICTURE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) add(e.target.files);
          e.target.value = "";
        }}
      />
    </section>
  );
}
