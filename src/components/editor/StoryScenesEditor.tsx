// A story graphic's scenes in the graphic panel: each scene's picture (made
// by the AI or uploaded), its words on screen, and what the picture shows.
// A cartoon graphic has one scene, always with the speaker's cartoon in it.

import { useRef } from "react";
import { ImagePlus, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  MAX_SCENE_PROMPT,
  MAX_SCENES,
  type MotionElement,
  type MotionScene,
} from "@/lib/motion-plan";
import { SCENE_UPLOAD_TYPES } from "./useStoryImages";

/** What the panel can do with pictures (useStoryImages). */
export type StoryTools = {
  urls: Record<string, string>;
  busy: Set<string>;
  make: (elementId: string, index: number) => Promise<unknown>;
  makeMissing: (elementId: string) => Promise<void>;
  upload: (elementId: string, index: number, file: File) => Promise<void>;
  /** The project has a cartoon of its speaker (for scenes with them in). */
  hasCartoon: boolean;
};

export function StoryScenesEditor({
  element: el,
  tools,
  readOnly,
  onScenes,
  inputCls,
}: {
  element: MotionElement;
  tools: StoryTools;
  readOnly: boolean;
  onScenes: (scenes: MotionScene[]) => void;
  inputCls: string;
}) {
  const cartoon = el.type === "cartoon";
  const scenes = cartoon ? (el.scenes ?? []).slice(0, 1) : (el.scenes ?? []);
  const missing = scenes.filter((sc) => !sc.image).length;
  const anyBusy = scenes.some((_, i) => tools.busy.has(`${el.id}:${i}`));
  const set = (i: number, patch: Partial<MotionScene>) =>
    onScenes(scenes.map((sc, j) => (j === i ? { ...sc, ...patch } : sc)));

  return (
    <div className="space-y-3">
      {!cartoon && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-300 flex-1">
            {scenes.length} scene{scenes.length === 1 ? "" : "s"}
          </span>
          {!readOnly && missing > 0 && (
            <button
              onClick={() => void tools.makeMissing(el.id)}
              disabled={anyBusy}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium bg-orange-500/20 text-orange-100 hover:bg-orange-500/30 disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3" /> Make {missing} picture{missing === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}

      {scenes.map((sc, i) => (
        <SceneRow
          key={i}
          index={i}
          cartoon={cartoon}
          hasCartoon={tools.hasCartoon}
          scene={sc}
          url={sc.image ? tools.urls[sc.image.path] : undefined}
          busy={tools.busy.has(`${el.id}:${i}`)}
          readOnly={readOnly}
          canRemove={!cartoon && scenes.length > 1}
          inputCls={inputCls}
          onChange={(patch) => set(i, patch)}
          onMake={() => void tools.make(el.id, i)}
          onUpload={(file) => void tools.upload(el.id, i, file)}
          onRemove={() => onScenes(scenes.filter((_, j) => j !== i))}
        />
      ))}

      {!readOnly && !cartoon && scenes.length < MAX_SCENES && (
        <button
          onClick={() =>
            onScenes([...scenes, { at: el.end, text: "", emphasis: null, prompt: "", image: null }])
          }
          className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white"
        >
          <Plus className="w-3 h-3" /> Add scene
        </button>
      )}
    </div>
  );
}

function SceneRow({
  index,
  cartoon,
  hasCartoon,
  scene: sc,
  url,
  busy,
  readOnly,
  canRemove,
  inputCls,
  onChange,
  onMake,
  onUpload,
  onRemove,
}: {
  index: number;
  cartoon: boolean;
  hasCartoon: boolean;
  scene: MotionScene;
  url: string | undefined;
  busy: boolean;
  readOnly: boolean;
  canRemove: boolean;
  inputCls: string;
  onChange: (patch: Partial<MotionScene>) => void;
  onMake: () => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const speaker = cartoon || sc.speaker === true;
  // A picture with the speaker in it needs their cartoon first.
  const blocked = speaker && !hasCartoon;
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 space-y-2">
      <div className="flex gap-2">
        <div
          className={cn(
            "w-16 h-16 shrink-0 rounded-md overflow-hidden grid place-items-center",
            "bg-gradient-to-br from-orange-500/20 to-neutral-900 border border-white/10",
          )}
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin text-orange-200" />
          ) : url ? (
            <img src={url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[9px] text-neutral-500 text-center px-1">No picture yet</span>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500 flex-1">
              {cartoon ? "Cartoon" : `Scene ${index + 1}`}
              {sc.image?.source === "upload" ? " · your picture" : ""}
            </span>
            {!readOnly && canRemove && (
              <button
                onClick={onRemove}
                aria-label={`Remove scene ${index + 1}`}
                className="w-5 h-5 grid place-items-center rounded text-neutral-500 hover:text-red-300"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <Input
            value={sc.text}
            maxLength={80}
            readOnly={readOnly}
            placeholder={cartoon ? "Caption (optional)" : "Words on screen"}
            onChange={(e) => onChange({ text: e.target.value })}
            className={cn(inputCls, "h-7")}
          />
        </div>
      </div>
      <Textarea
        value={sc.prompt}
        maxLength={MAX_SCENE_PROMPT}
        readOnly={readOnly}
        placeholder={
          cartoon
            ? "What the speaker's cartoon is doing, where, and their expression"
            : "What the picture shows (a person, the place, the light and mood)"
        }
        onChange={(e) => onChange({ prompt: e.target.value })}
        className={cn(inputCls, "min-h-[52px] resize-none text-[11px]")}
      />
      {!cartoon && (
        <label className="flex items-center gap-2 text-[10px] text-neutral-400">
          <Switch
            checked={speaker}
            disabled={readOnly}
            onCheckedChange={(on) => onChange({ speaker: on || undefined })}
            aria-label={`The speaker is in scene ${index + 1}`}
            className="scale-75 data-[state=checked]:bg-fuchsia-600"
          />
          The speaker is in this scene (as their cartoon)
        </label>
      )}
      {blocked && !sc.image && (
        <p className="text-[10px] text-fuchsia-200/80">
          Make the speaker&apos;s cartoon first (Cartoon of the speaker, in the Graphics panel).
        </p>
      )}
      {!readOnly && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={onMake}
            disabled={busy || blocked || sc.prompt.trim().length < 3}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-medium bg-white/[0.08] text-neutral-100 hover:bg-white/[0.12] disabled:opacity-50"
          >
            {sc.image ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
            {sc.image ? "Make again" : "Make picture"}
          </button>
          <button
            onClick={() => file.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-medium text-neutral-400 hover:text-white disabled:opacity-50"
          >
            <ImagePlus className="w-3 h-3" /> Upload my own
          </button>
          <input
            ref={file}
            type="file"
            accept={SCENE_UPLOAD_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onUpload(f);
            }}
          />
        </div>
      )}
    </div>
  );
}
