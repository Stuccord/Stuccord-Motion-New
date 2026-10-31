// A Notes page's lines in the graphic panel (stage 10b): each line's words
// and its sketch. Lines are written on their words; a line added by hand
// goes after the others.

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_NOTE_LINES, SKETCH_IDS, type MotionElement, type NoteLine } from "@/lib/motion-plan";

export function NotesLinesEditor({
  element: el,
  readOnly,
  onLines,
  inputCls,
}: {
  element: MotionElement;
  readOnly: boolean;
  onLines: (lines: NoteLine[]) => void;
  inputCls: string;
}) {
  const lines = el.lines ?? [];
  const set = (i: number, patch: Partial<NoteLine>) =>
    onLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-1.5">
      {lines.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={l.text}
            maxLength={60}
            readOnly={readOnly}
            placeholder={`Line ${i + 1}`}
            onChange={(e) => set(i, { text: e.target.value })}
            className={cn(inputCls, "h-7 flex-1")}
          />
          <select
            value={l.sketch ?? ""}
            disabled={readOnly}
            onChange={(e) => set(i, { sketch: (e.target.value || null) as NoteLine["sketch"] })}
            aria-label={`Sketch for line ${i + 1}`}
            className={cn(inputCls, "h-7 w-[84px] rounded-md px-1 text-[11px]")}
          >
            <option value="">No sketch</option>
            {SKETCH_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          {!readOnly && lines.length > 2 && (
            <button
              onClick={() => onLines(lines.filter((_, j) => j !== i))}
              aria-label={`Remove line ${i + 1}`}
              className="w-6 h-6 grid place-items-center rounded text-neutral-500 hover:text-red-300"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && lines.length < MAX_NOTE_LINES && (
        <button
          onClick={() => onLines([...lines, { at: el.end, text: "", sketch: null }])}
          className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white"
        >
          <Plus className="w-3 h-3" /> Add line
        </button>
      )}
      <p className="text-[10px] text-neutral-500 leading-snug">
        The speaker moves to one side and the page fills up line by line beside them.
      </p>
    </div>
  );
}
