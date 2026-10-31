// The right-hand panel for a selected Motion Explainer graphic: change its
// type and what it says, put it behind the speaker, jump to it, or delete
// it. Changes show at once in
// the preview and are saved shortly after.

import { Crosshair, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BEHIND_TYPES,
  CTA_KINDS,
  ELEMENT_LABEL,
  ELEMENT_TYPES,
  ZOOM_KINDS,
  markEdited,
  withType,
  type ElementType,
  type MotionElement,
} from "@/lib/motion-plan";
import { GRAPHIC_TINT } from "./graphic-tint";
import { StoryScenesEditor, type StoryTools } from "./StoryScenesEditor";

const CTA_LABEL: Record<(typeof CTA_KINDS)[number], string> = {
  like: "Like",
  subscribe: "Subscribe",
  comment: "Comment",
  link: "Link below",
};

const HINT: Record<ElementType, string> = {
  keyline: "A key sentence written out on screen while it's said.",
  counter: "A number that counts up as it's said.",
  list: "Items that stack one by one.",
  card: "A glass card with a title and a few lines.",
  compare: "Two sides, A vs B.",
  story: "A short story: one AI picture per scene, joined by one camera move.",
  chapter: "A full-screen divider for a new part, with progress.",
  label: "A small label naming the current topic.",
  cta: "A button the pointer clicks (like, subscribe…).",
  zoom: "Zooms the picture in or eases it out.",
};

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "bg-black/40 border-white/10 text-neutral-100 text-[12px] focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40";

export function GraphicInspector({
  element,
  span,
  readOnly,
  onChange,
  onDelete,
  onSeek,
  onClose,
  story,
}: {
  element: MotionElement;
  /** Where it is on the timeline now; null when its words are trimmed away. */
  span: { startMs: number; endMs: number } | null;
  readOnly: boolean;
  onChange: (next: MotionElement) => void;
  onDelete: () => void;
  onSeek: (ms: number) => void;
  onClose: () => void;
  /** Story pictures: making, uploading and showing them. */
  story?: StoryTools;
}) {
  const el = element;
  const set = (patch: Partial<MotionElement>) => onChange(markEdited({ ...el, ...patch }));
  const showText = el.type !== "zoom";
  const showEmphasis = el.type === "keyline" || el.type === "card";
  const showItems = el.type === "list" || el.type === "compare" || el.type === "card";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-9 border-b border-white/[0.06] flex items-center gap-2 px-3 shrink-0">
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5",
            GRAPHIC_TINT[el.type],
          )}
        >
          {ELEMENT_LABEL[el.type]}
        </span>
        <span className="text-[11px] font-mono text-neutral-500">
          {span ? `${fmt(span.startMs)} – ${fmt(span.endMs)}` : "On trimmed-away words"}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="ml-auto w-6 h-6 grid place-items-center rounded text-neutral-500 hover:text-white hover:bg-white/[0.06]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <p className="text-[11px] text-neutral-500 leading-snug">{HINT[el.type]}</p>

        <Field label="Type">
          <select
            value={el.type}
            disabled={readOnly}
            onChange={(e) => onChange(withType(el, e.target.value as ElementType))}
            className="w-full h-8 rounded-md bg-black/40 border border-white/10 text-neutral-100 text-[12px] px-2"
          >
            {ELEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ELEMENT_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>

        {BEHIND_TYPES.has(el.type) && (
          <div className="flex items-start gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
            <div className="flex-1">
              <p className="text-[11px] text-neutral-200">Behind me</p>
              <p className="text-[10px] text-neutral-500 leading-snug">
                You stay in front of it; the room behind you darkens and blurs.
              </p>
            </div>
            <Switch
              checked={el.behind === true}
              disabled={readOnly}
              onCheckedChange={(on) => set({ behind: on })}
              aria-label="Behind me"
              className="data-[state=checked]:bg-violet-600"
            />
          </div>
        )}

        {showText && (
          <Field
            label={
              el.type === "counter"
                ? "Caption"
                : el.type === "list" || el.type === "compare" || el.type === "story"
                  ? "Title (optional)"
                  : "Text"
            }
          >
            <Textarea
              value={el.text}
              maxLength={200}
              readOnly={readOnly}
              onChange={(e) => set({ text: e.target.value })}
              className={cn(inputCls, "min-h-[64px] resize-none")}
            />
          </Field>
        )}

        {el.type === "story" && story && (
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">Scenes</span>
            <StoryScenesEditor
              element={el}
              tools={story}
              readOnly={readOnly}
              onScenes={(scenes) => set({ scenes })}
              inputCls={inputCls}
            />
          </div>
        )}

        {showEmphasis && (
          <Field label="Special word (italic, accent colour)">
            <Input
              value={el.emphasis ?? ""}
              maxLength={60}
              readOnly={readOnly}
              placeholder="One word from the text"
              onChange={(e) => set({ emphasis: e.target.value.trim() ? e.target.value : null })}
              className={cn(inputCls, "h-8")}
            />
            {el.emphasis && !el.text.toLowerCase().includes(el.emphasis.trim().toLowerCase()) && (
              <span className="text-[10px] text-amber-300">
                Not in the text, so it won't stand out.
              </span>
            )}
          </Field>
        )}

        {showItems && (
          <Field
            label={
              el.type === "compare"
                ? "The two sides (one per line)"
                : el.type === "card"
                  ? "Lines (up to 4)"
                  : "Items (one per line, up to 8)"
            }
          >
            <Textarea
              value={el.items.join("\n")}
              readOnly={readOnly}
              onChange={(e) =>
                set({
                  items: e.target.value
                    .split("\n")
                    .map((l) => l.slice(0, 80))
                    .slice(0, el.type === "compare" ? 2 : el.type === "card" ? 4 : 8),
                })
              }
              className={cn(inputCls, "min-h-[80px] resize-none font-mono")}
            />
          </Field>
        )}

        {el.type === "counter" && (
          <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
            <Field label="Before">
              <Input
                value={el.number?.prefix ?? ""}
                maxLength={8}
                readOnly={readOnly}
                placeholder="$"
                onChange={(e) =>
                  set({
                    number: {
                      value: el.number?.value ?? 0,
                      suffix: el.number?.suffix ?? "",
                      prefix: e.target.value,
                    },
                  })
                }
                className={cn(inputCls, "h-8")}
              />
            </Field>
            <Field label="Number">
              <Input
                type="number"
                value={String(el.number?.value ?? 0)}
                readOnly={readOnly}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v))
                    set({
                      number: {
                        prefix: el.number?.prefix ?? "",
                        suffix: el.number?.suffix ?? "",
                        value: v,
                      },
                    });
                }}
                className={cn(inputCls, "h-8")}
              />
            </Field>
            <Field label="After">
              <Input
                value={el.number?.suffix ?? ""}
                maxLength={12}
                readOnly={readOnly}
                placeholder="%"
                onChange={(e) =>
                  set({
                    number: {
                      value: el.number?.value ?? 0,
                      prefix: el.number?.prefix ?? "",
                      suffix: e.target.value,
                    },
                  })
                }
                className={cn(inputCls, "h-8")}
              />
            </Field>
          </div>
        )}

        {el.type === "cta" && (
          <Field label="Asks to">
            <select
              value={el.cta ?? "like"}
              disabled={readOnly}
              onChange={(e) => set({ cta: e.target.value as MotionElement["cta"] })}
              className="w-full h-8 rounded-md bg-black/40 border border-white/10 text-neutral-100 text-[12px] px-2"
            >
              {CTA_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CTA_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        )}

        {el.type === "zoom" && (
          <Field label="Zoom">
            <select
              value={el.zoom ?? "in"}
              disabled={readOnly}
              onChange={(e) => set({ zoom: e.target.value as MotionElement["zoom"] })}
              className="w-full h-8 rounded-md bg-black/40 border border-white/10 text-neutral-100 text-[12px] px-2"
            >
              {ZOOM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === "in" ? "Punch in" : "Ease out"}
                </option>
              ))}
            </select>
          </Field>
        )}

        {el.reason && (
          <p className="text-[10px] text-neutral-500">
            {el.source === "ai" ? "Why the AI chose it: " : ""}
            {el.reason}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => span && onSeek(span.startMs)}
            disabled={!span}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-neutral-200 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40"
          >
            <Crosshair className="w-3 h-3" /> Jump to it
          </button>
          {!readOnly && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-red-300 bg-red-500/10 hover:bg-red-500/20 ml-auto"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
