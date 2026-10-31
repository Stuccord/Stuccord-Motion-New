// A card stream's pictures, or a social profile's details and photos, in the
// graphic panel (stage 9b). Pictures are the user's uploads or frames of
// their footage; a card stream ends on the brand kit's logo.

import { useRef } from "react";
import { Film, ImagePlus, Loader2, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  EMPTY_PROFILE,
  maxScenes,
  PROFILE_GRID,
  type MotionElement,
  type ProfileDetails,
} from "@/lib/motion-plan";
import { SCENE_UPLOAD_TYPES } from "./useStoryImages";

/** What the panel can do with these pictures (useStoryImages). */
export type PictureTools = {
  urls: Record<string, string>;
  busy: Set<string>;
  addPictures: (elementId: string, files: Blob[], source: "upload" | "footage") => Promise<void>;
  setPicture: (
    elementId: string,
    index: number,
    file: Blob | null,
    source: "upload" | "footage",
  ) => Promise<void>;
  removePicture: (elementId: string, index: number) => void;
  fillFromFootage: (elementId: string) => Promise<void>;
};

export function PictureSetEditor({
  element: el,
  tools,
  readOnly,
  hasLogo,
  onProfile,
  inputCls,
}: {
  element: MotionElement;
  tools: PictureTools;
  readOnly: boolean;
  /** The brand kit has a logo (it ends a card stream). */
  hasLogo: boolean;
  onProfile: (profile: ProfileDetails) => void;
  inputCls: string;
}) {
  const scenes = el.scenes ?? [];
  const url = (i: number) => {
    const path = scenes[i]?.image?.path;
    return path ? tools.urls[path] : undefined;
  };
  const filling = tools.busy.has(`${el.id}:pics`);

  const fromVideo = !readOnly && (
    <button
      onClick={() => void tools.fillFromFootage(el.id)}
      disabled={filling}
      className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-medium text-neutral-300 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50"
    >
      {filling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Film className="w-3 h-3" />}
      Use frames from my video
    </button>
  );

  if (el.type === "stream") {
    const full = scenes.length >= maxScenes("stream");
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1.5">
          {scenes.map((sc, i) => (
            <Slot
              key={`${sc.image?.path ?? "empty"}-${i}`}
              url={url(i)}
              busy={false}
              readOnly={readOnly}
              label={`Picture ${i + 1}`}
              onClear={() => tools.removePicture(el.id, i)}
            />
          ))}
          {!readOnly && !full && (
            <FilePick
              multiple
              onFiles={(files) => void tools.addPictures(el.id, files, "upload")}
              className="aspect-[4/5] rounded-md border border-dashed border-white/15 grid place-items-center text-neutral-500 hover:text-white hover:border-white/30"
            >
              {filling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </FilePick>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">{fromVideo}</div>
        <p className="text-[10px] text-neutral-500 leading-snug">
          {scenes.length}/{maxScenes("stream")} pictures: screenshots, results, thumbnails.{" "}
          {hasLogo
            ? "Your brand kit logo lands last."
            : "Add a logo in your brand kit to end on it; until then the last picture lands on top."}
        </p>
      </div>
    );
  }

  // A social profile: its details, its photo (slot 0) and its grid (1-6).
  const d = el.profile ?? EMPTY_PROFILE;
  const set = (patch: Partial<ProfileDetails>) => onProfile({ ...d, ...patch });
  const slot = (i: number, round = false) => (
    <Slot
      url={url(i)}
      busy={tools.busy.has(`${el.id}:${i}`)}
      readOnly={readOnly}
      round={round}
      label={i === 0 ? "Profile photo" : `Grid photo ${i}`}
      onFile={(f) => void tools.setPicture(el.id, i, f, "upload")}
      onClear={url(i) ? () => void tools.setPicture(el.id, i, null, "upload") : undefined}
    />
  );
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2 items-start">
        <div className="w-14 shrink-0">{slot(0, true)}</div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-1">
            <span className="text-neutral-500 text-xs">@</span>
            <Input
              value={d.handle}
              maxLength={40}
              readOnly={readOnly}
              placeholder="handle"
              onChange={(e) =>
                set({ handle: e.target.value.replace(/^@+/, "").replace(/\s/g, "") })
              }
              className={cn(inputCls, "h-7")}
            />
          </div>
          <Input
            value={d.name}
            maxLength={60}
            readOnly={readOnly}
            placeholder="Name"
            onChange={(e) => set({ name: e.target.value })}
            className={cn(inputCls, "h-7")}
          />
        </div>
      </div>
      {!d.handle && !readOnly && (
        <p className="text-[10px] text-amber-300">Add your handle so the profile looks real.</p>
      )}
      <Textarea
        value={d.bio}
        maxLength={150}
        readOnly={readOnly}
        placeholder="Bio"
        onChange={(e) => set({ bio: e.target.value })}
        className={cn(inputCls, "min-h-[44px] resize-none text-[11px]")}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["posts", "Posts"],
            ["followers", "Followers"],
            ["following", "Following"],
          ] as const
        ).map(([k, label]) => (
          <Input
            key={k}
            value={d[k]}
            maxLength={12}
            readOnly={readOnly}
            placeholder={label}
            aria-label={label}
            onChange={(e) => set({ [k]: e.target.value })}
            className={cn(inputCls, "h-7 text-center")}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: PROFILE_GRID }, (_, i) => (
          <div key={i}>{slot(i + 1)}</div>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">{fromVideo}</div>
    </div>
  );
}

function Slot({
  url,
  busy,
  readOnly,
  round = false,
  label,
  onFile,
  onClear,
}: {
  url: string | undefined;
  busy: boolean;
  readOnly: boolean;
  round?: boolean;
  label: string;
  onFile?: (f: File) => void;
  onClear?: () => void;
}) {
  const body = busy ? (
    <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
  ) : url ? (
    <img src={url} alt="" className="w-full h-full object-cover" />
  ) : (
    <ImagePlus className="w-3.5 h-3.5 text-neutral-500" />
  );
  const shape = cn(
    "relative overflow-hidden grid place-items-center bg-white/[0.04] border border-white/10",
    round ? "aspect-square rounded-full" : "aspect-[4/5] rounded-md",
  );
  return (
    <div className="relative group">
      {onFile && !readOnly ? (
        <FilePick onFiles={(fs) => fs[0] && onFile(fs[0])} className={shape} label={label}>
          {body}
        </FilePick>
      ) : (
        <div className={shape} aria-label={label}>
          {body}
        </div>
      )}
      {onClear && !readOnly && url && (
        <button
          onClick={onClear}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neutral-900 border border-white/20 grid place-items-center text-neutral-400 hover:text-red-300 opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

/** A button that opens the file picker for pictures. */
function FilePick({
  multiple = false,
  onFiles,
  className,
  label,
  children,
}: {
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className: string;
  label?: string;
  children: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => input.current?.click()}
        className={cn("w-full", className)}
        aria-label={label ?? "Add pictures"}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={SCENE_UPLOAD_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}
