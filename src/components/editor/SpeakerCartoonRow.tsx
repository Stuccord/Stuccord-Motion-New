// The speaker's cartoon in the Graphics panel (stage 8): one per project,
// made by the AI from a clear frame of the footage (picked automatically,
// changeable) or the user's own photo, once they confirm they are the
// speaker or have the speaker's permission.

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Smile, Sparkles } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { SpeakerCartoon } from "@/lib/motion-plan";
import type { SpeakerFrame } from "@/lib/speaker-frames";
import { SCENE_UPLOAD_TYPES } from "./useStoryImages";

export type CartoonControls = {
  character: SpeakerCartoon | null;
  /** A link to show the cartoon. */
  url: string | undefined;
  busy: boolean;
  canEdit: boolean;
  /** Pictures in the plan waiting for the cartoon. */
  waiting: number;
  /** Clear frames of the speaker from the footage, best first (null: couldn't read it). */
  findFrames: () => Promise<SpeakerFrame[] | null>;
  make: (photo: Blob, from: "footage" | "upload") => Promise<boolean>;
};

type Photo = { blob: Blob; url: string; from: "footage" | "upload" };

export function SpeakerCartoonRow({ cartoon }: { cartoon: CartoonControls }) {
  const [open, setOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [chosen, setChosen] = useState(0);
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // Object links for the photos shown, freed when the row goes away.
  const links = useRef<string[]>([]);
  useEffect(() => () => links.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const link = (b: Blob) => {
    const u = URL.createObjectURL(b);
    links.current.push(u);
    return u;
  };

  const start = async () => {
    setOpen(true);
    setConsent(false);
    setChosen(0);
    setNote(null);
    setFinding(true);
    try {
      const frames = await cartoon.findFrames();
      setPhotos(
        (frames ?? []).map((f) => ({
          blob: f.photo,
          url: link(f.photo),
          from: "footage" as const,
        })),
      );
      if (!frames) setNote("Couldn't read the video here. Upload a photo instead.");
      else if (!frames.length) setNote("No clear frame of a person found. Upload a photo instead.");
    } finally {
      setFinding(false);
    }
  };

  const takeUpload = (f: File) => {
    setPhotos((ps) => [{ blob: f, url: link(f), from: "upload" }, ...ps]);
    setChosen(0);
    setNote(null);
  };

  const photo = photos[chosen];
  const confirm = async () => {
    if (!photo || !consent) return;
    if (await cartoon.make(photo.blob, photo.from)) setOpen(false);
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Smile className="w-3 h-3 text-fuchsia-300" />
        <span className="text-[11px] text-neutral-300 flex-1">Cartoon of the speaker</span>
        {cartoon.canEdit && !open && (
          <button
            onClick={() => void start()}
            disabled={cartoon.busy}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-medium bg-fuchsia-500/20 text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3" /> {cartoon.character ? "Make again" : "Make cartoon"}
          </button>
        )}
      </div>

      {cartoon.character ? (
        <div className="flex items-center gap-2">
          <div className="w-12 h-12 rounded-md overflow-hidden bg-neutral-900 border border-white/10 shrink-0 grid place-items-center">
            {cartoon.busy ? (
              <Loader2 className="w-4 h-4 animate-spin text-fuchsia-200" />
            ) : cartoon.url ? (
              <img
                src={cartoon.url}
                alt="The speaker's cartoon"
                className="w-full h-full object-cover"
              />
            ) : null}
          </div>
          <p className="text-[10px] text-neutral-500 leading-snug">
            Made from{" "}
            {cartoon.character.from === "footage" ? "a frame of the video" : "an uploaded photo"}.
            Used in cartoons and in story scenes with the speaker in them.
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-neutral-500 leading-snug">
          A 3D animated version of the speaker, for cartoons and story scenes with them in.
          {cartoon.waiting > 0 && (
            <span className="text-fuchsia-200">
              {" "}
              {cartoon.waiting} picture{cartoon.waiting === 1 ? " is" : "s are"} waiting for it.
            </span>
          )}
        </p>
      )}

      {open && (
        <div className="space-y-2 pt-1 border-t border-white/[0.06]">
          {finding ? (
            <p className="flex items-center gap-1.5 text-[10px] text-neutral-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Finding a clear frame of the speaker…
            </p>
          ) : (
            <>
              {photos.length > 0 && (
                <div className="flex gap-1.5">
                  {photos.slice(0, 4).map((p, i) => (
                    <button
                      key={p.url}
                      onClick={() => setChosen(i)}
                      aria-label={`Use photo ${i + 1}`}
                      className={cn(
                        "w-14 h-14 rounded-md overflow-hidden border-2",
                        i === chosen
                          ? "border-fuchsia-400"
                          : "border-transparent opacity-60 hover:opacity-100",
                      )}
                    >
                      <img src={p.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              {note && <p className="text-[10px] text-amber-300">{note}</p>}
              <button
                onClick={() => file.current?.click()}
                className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white"
              >
                <ImagePlus className="w-3 h-3" /> Upload a photo instead
              </button>
              <input
                ref={file}
                type="file"
                accept={SCENE_UPLOAD_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) takeUpload(f);
                }}
              />
              <label className="flex items-start gap-2 text-[10px] text-neutral-300 leading-snug">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  className="mt-0.5"
                  aria-label="Consent"
                />
                I am the person in this photo, or I have their permission to make a cartoon of them.
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void confirm()}
                  disabled={!photo || !consent || cartoon.busy}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-40"
                >
                  {cartoon.busy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Make cartoon
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="text-[10px] text-neutral-500 hover:text-white"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-neutral-500 ml-auto">Uses 1 AI picture</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
