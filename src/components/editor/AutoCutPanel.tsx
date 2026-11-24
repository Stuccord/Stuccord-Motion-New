// Auto-cut silences: finds the pauses in the main track's videos (or the
// selected clip), shows them on the timeline and in a list where any can be
// unticked, then cuts the ticked ones out in one step (undo puts them back).
// With "fillers and retakes" on, the list also has the "um"s and the bad
// takes found from the transcript (suggestTakeCuts, src/lib/take-cuts.ts).

import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Loader2, Scissors, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Waveform } from "@/lib/clip-strips";
import {
  PAUSE_PRESETS,
  findPauses,
  keepRanges,
  totalMs,
  type PausePreset,
  type Range,
} from "@/lib/auto-cut";
import { suggestTakeCuts, transcribeForPlan } from "@/lib/motion-plan.functions";

export type AutoCutClip = {
  id: string;
  filename: string;
  storage_path: string;
  trim_in_ms?: number | null;
  trim_out_ms?: number | null;
  duration_ms?: number | null;
};

/** One thing to cut: a pause (from the sound), a filler or a bad take (from the words). */
type Cut = Range & { why: "pause" | "filler" | "take"; text?: string; reason?: string };
type WordCut = Range & { why: "filler" | "take"; text: string; reason: string };

type Suggestions = {
  clips: Record<string, WordCut[]>;
  /** Clips whose file has no transcript yet. */
  untranscribed: string[];
  /** False when the AI couldn't be asked about retakes. */
  takesChecked: boolean;
};

type Found = {
  clip: AutoCutClip;
  range: Range;
  pauses: Cut[];
  /** Pauses (by index) the user unticked. */
  skip: Set<number>;
};

type Scope = "track" | "selected";

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clock = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
const rangeOf = (c: AutoCutClip): Range => {
  const fromMs = c.trim_in_ms ?? 0;
  return { fromMs, toMs: c.trim_out_ms ?? c.duration_ms ?? fromMs };
};
const shorten = (t: string, n = 48) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const KIND: Record<Cut["why"], string> = { pause: "pause", filler: "filler", take: "retake" };

/** "3 pauses, 2 fillers, 1 retake". */
function cutCount(cuts: Cut[]): string {
  const n = (why: Cut["why"]) => cuts.filter((c) => c.why === why).length;
  return (["pause", "filler", "take"] as const)
    .filter((w) => n(w) > 0)
    .map((w) => `${n(w)} ${KIND[w]}${n(w) === 1 ? "" : "s"}`)
    .join(", ");
}

/** The pauses, plus the fillers and takes not already inside a pause (or a take), in order. */
function mergeCuts(pauses: Range[], words: WordCut[] | undefined): Cut[] {
  const out: Cut[] = pauses.map((p) => ({ ...p, why: "pause" as const }));
  const takes = (words ?? []).filter((w) => w.why === "take");
  for (const w of words ?? []) {
    const inside = (r: Range) => r !== w && r.fromMs <= w.fromMs && r.toMs >= w.toMs;
    if (pauses.some(inside) || takes.some(inside)) continue;
    out.push(w);
  }
  return out.sort((a, b) => a.fromMs - b.fromMs);
}

export function AutoCutPanel({
  projectId,
  trackClips,
  selectedClip,
  clipStartMs,
  waveforms,
  loadWaveform,
  onMarksChange,
  onSeek,
  onApply,
  isApplying,
}: {
  projectId: string;
  /** Videos on V1, in order (images and audio left out). */
  trackClips: AutoCutClip[];
  /** The selected clip when it's a video (any track), else null. */
  selectedClip: AutoCutClip | null;
  /** Where each clip starts on the timeline (ms). */
  clipStartMs: Map<string, number>;
  /** Waveforms by file (storage path) already read for the timeline. */
  waveforms: Record<string, Waveform | null>;
  /** Reads a file's waveform now (null: it has no sound the browser can read). */
  loadWaveform: (clip: AutoCutClip) => Promise<Waveform | null>;
  /** The ticked pauses, by clip id, to mark on the timeline (ms into the file). */
  onMarksChange: (marks: Record<string, Range[]>) => void;
  /** Moves the playhead to a time in a clip's file. */
  onSeek: (clipId: string, sourceMs: number) => void;
  /** Cuts: the pieces of each clip to keep. */
  onApply: (cuts: { id: string; keep: Range[] }[], summary: string) => Promise<void>;
  isApplying: boolean;
}) {
  const [scope, setScope] = useState<Scope>("track");
  const [preset, setPreset] = useState<PausePreset>("normal");
  const [found, setFound] = useState<Found[] | null>(null);
  const [noSound, setNoSound] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [withWords, setWithWords] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [asking, setAsking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const suggestFn = useServerFn(suggestTakeCuts);
  const transcribeFn = useServerFn(transcribeForPlan);

  const targets = useMemo(
    () => (scope === "selected" ? (selectedClip ? [selectedClip] : []) : trackClips),
    [scope, selectedClip, trackClips],
  );
  // Results go stale when the clips change (trimmed, cut, moved, removed).
  const targetsKey = targets
    .map((c) => `${c.id}:${c.trim_in_ms ?? 0}:${c.trim_out_ms ?? ""}`)
    .join("|");
  useEffect(() => {
    setFound(null);
    setNoSound([]);
    setSuggestions(null);
  }, [targetsKey]);

  // The timeline shows the ticked pauses.
  useEffect(() => {
    const marks: Record<string, Range[]> = {};
    for (const f of found ?? []) {
      const on = f.pauses.filter((_, i) => !f.skip.has(i));
      if (on.length > 0) marks[f.clip.id] = on;
    }
    onMarksChange(marks);
  }, [found, onMarksChange]);
  useEffect(() => () => onMarksChange({}), [onMarksChange]);

  const detect = (
    waves: Map<string, Waveform | null>,
    p: PausePreset,
    sugg: Suggestions | null,
  ) => {
    const out: Found[] = [];
    const silent: string[] = [];
    for (const clip of targets) {
      const wave = waves.get(clip.storage_path);
      const words = sugg?.clips[clip.id];
      if (!wave && !words?.length) {
        silent.push(clip.filename);
        continue;
      }
      const range = rangeOf(clip);
      const pauses = mergeCuts(wave ? findPauses(wave, range, p) : [], words);
      // A clip that would be cut away completely is left alone.
      if (keepRanges(range, pauses)) out.push({ clip, range, pauses, skip: new Set() });
    }
    setFound(out);
    setNoSound(silent);
  };

  const [waveCache, setWaveCache] = useState(new Map<string, Waveform | null>());
  const find = async (p = preset) => {
    const waves = new Map(waveCache);
    const missing = targets.filter(
      (c) => !waves.has(c.storage_path) && waveforms[c.storage_path] === undefined,
    );
    for (const c of targets) {
      if (waveforms[c.storage_path] !== undefined)
        waves.set(c.storage_path, waveforms[c.storage_path]);
    }
    if (missing.length > 0) {
      setProgress({ done: 0, of: missing.length });
      for (const [i, c] of missing.entries()) {
        waves.set(c.storage_path, await loadWaveform(c).catch(() => null));
        setProgress({ done: i + 1, of: missing.length });
      }
      setProgress(null);
    }
    setWaveCache(waves);
    // The fillers and takes are asked for once; changing the preset reuses them.
    let sugg = withWords ? suggestions : null;
    if (withWords && !sugg) {
      setAsking(true);
      try {
        sugg = await suggestFn({
          data: { project_id: projectId, clip_ids: targets.map((c) => c.id) },
        });
        setSuggestions(sugg);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't look for fillers and retakes.");
      } finally {
        setAsking(false);
      }
    }
    detect(waves, p, sugg);
  };

  // Starts the transcript for clips that have none (the worker makes it).
  const getWords = async () => {
    setTranscribing(true);
    try {
      await transcribeFn({ data: { project_id: projectId } });
      setSuggestions(null);
      toast("Getting the words. Press Find again in a minute or two.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the transcript.");
    } finally {
      setTranscribing(false);
    }
  };

  // Changing the preset redoes the search straight away (the sound is read).
  const pickPreset = (p: PausePreset) => {
    setPreset(p);
    if (found) void find(p);
  };

  const ticked = (found ?? []).flatMap((f) => f.pauses.filter((_, i) => !f.skip.has(i)));
  const total = (found ?? []).reduce((n, f) => n + f.pauses.length, 0);
  const savedMs = totalMs(ticked);
  const toggle = (fi: number, pi: number) =>
    setFound((list) =>
      (list ?? []).map((f, i) => {
        if (i !== fi) return f;
        const skip = new Set(f.skip);
        if (skip.has(pi)) skip.delete(pi);
        else skip.add(pi);
        return { ...f, skip };
      }),
    );
  const setAll = (on: boolean) =>
    setFound((list) =>
      (list ?? []).map((f) => ({
        ...f,
        skip: on ? new Set() : new Set(f.pauses.map((_, i) => i)),
      })),
    );

  const apply = async () => {
    const cuts = (found ?? []).flatMap((f) => {
      const keep = keepRanges(
        f.range,
        f.pauses.filter((_, i) => !f.skip.has(i)),
      );
      return keep ? [{ id: f.clip.id, keep }] : [];
    });
    if (cuts.length === 0) return;
    await onApply(cuts, `Cut ${cutCount(ticked)} · ${sec(savedMs)} shorter`);
    setFound(null);
  };

  const busy = progress !== null || asking || isApplying;
  const untranscribed = withWords ? (suggestions?.untranscribed.length ?? 0) : 0;

  return (
    <div className="flex flex-col h-full min-h-0 text-neutral-200">
      <div className="p-3 space-y-3 border-b border-white/[0.06] shrink-0">
        <div>
          <div className="text-[13px] font-semibold flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-violet-400" /> Auto-cut silences
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug">
            Finds the pauses in your videos&apos; sound, and the &ldquo;um&rdquo;s and retakes in
            what&apos;s said. Untick any you want to keep, then cut them all at once. Undo puts them
            back.
          </p>
        </div>

        <Segmented
          label="Cut pauses in"
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={[
            {
              value: "track",
              label: `All of V1 (${trackClips.length})`,
              disabled: trackClips.length === 0,
            },
            { value: "selected", label: "Selected clip", disabled: !selectedClip },
          ]}
        />
        <Segmented
          label="How much"
          value={preset}
          onChange={(v) => pickPreset(v as PausePreset)}
          options={(Object.keys(PAUSE_PRESETS) as PausePreset[]).map((p) => ({
            value: p,
            label: PAUSE_PRESETS[p].label,
          }))}
        />
        <p className="text-[11px] text-neutral-500 -mt-1">{PAUSE_PRESETS[preset].hint}.</p>
        <label className="flex items-start gap-2 text-[12px] text-neutral-300 cursor-pointer">
          <Checkbox
            checked={withWords}
            onCheckedChange={(v) => {
              setWithWords(v === true);
              setFound(null);
            }}
            className="border-white/30 mt-px"
          />
          <span>
            Also cut fillers and retakes
            <span className="block text-[11px] text-neutral-500">
              &ldquo;Um&rdquo;, &ldquo;uh&rdquo; and lines said again (AI reads the words)
            </span>
          </span>
        </label>

        <Button
          size="sm"
          className="w-full bg-violet-600 hover:bg-violet-500 text-white"
          disabled={busy || targets.length === 0}
          onClick={() => void find()}
        >
          {progress ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Reading the sound… {progress.done}/{progress.of}
            </>
          ) : asking ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Reading the words…
            </>
          ) : (
            <>
              <Search className="w-3.5 h-3.5 mr-1.5" />
              {found ? "Find again" : withWords ? "Find pauses, fillers & retakes" : "Find pauses"}
            </>
          )}
        </Button>
        {targets.length === 0 && (
          <p className="text-[11px] text-neutral-500">
            {scope === "selected"
              ? "Select a video clip on the timeline first."
              : "Add a video to V1 first."}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {found && (
          <div className="p-3 space-y-3">
            {noSound.length > 0 && (
              <div className="flex gap-1.5 text-[11px] text-amber-300/90">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  No sound to read in {noSound.join(", ")};{" "}
                  {noSound.length === 1 ? "it's" : "they're"} left as{" "}
                  {noSound.length === 1 ? "it is" : "they are"}.
                </span>
              </div>
            )}
            {untranscribed > 0 && (
              <div className="flex gap-1.5 text-[11px] text-amber-300/90">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  {untranscribed === 1 ? "A clip has" : `${untranscribed} clips have`} no transcript
                  yet, so only pauses are found there.{" "}
                  <button
                    type="button"
                    className="underline hover:text-amber-200 disabled:opacity-50"
                    disabled={transcribing}
                    onClick={() => void getWords()}
                  >
                    {transcribing ? "Starting…" : "Get the words"}
                  </button>
                </span>
              </div>
            )}
            {withWords && suggestions && !suggestions.takesChecked && (
              <div className="flex gap-1.5 text-[11px] text-amber-300/90">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  Retakes couldn&apos;t be checked right now. Pauses and fillers are listed.
                </span>
              </div>
            )}
            {total === 0 ? (
              <div className="text-[12px] text-neutral-400 text-center py-6">
                Nothing to cut found.
                {preset !== "tight" && (
                  <>
                    {" "}
                    Try <b>Tight</b> to catch shorter pauses.
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-300">
                    {ticked.length} of {total} · {sec(savedMs)} shorter
                  </span>
                  <button
                    type="button"
                    className="text-violet-300 hover:text-violet-200"
                    onClick={() => setAll(ticked.length < total)}
                  >
                    {ticked.length < total ? "Tick all" : "Untick all"}
                  </button>
                </div>
                {found.map((f, fi) =>
                  f.pauses.length === 0 ? null : (
                    <div key={f.clip.id} className="space-y-1">
                      <div className="text-[11px] font-medium text-neutral-400 truncate">
                        {f.clip.filename}
                      </div>
                      {f.pauses.map((p, pi) => {
                        const at = (clipStartMs.get(f.clip.id) ?? 0) + (p.fromMs - f.range.fromMs);
                        const on = !f.skip.has(pi);
                        return (
                          <div
                            key={pi}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] border",
                              !on
                                ? "border-white/[0.05] bg-white/[0.02] text-neutral-500"
                                : p.why === "pause"
                                  ? "border-rose-500/30 bg-rose-500/[0.07]"
                                  : p.why === "filler"
                                    ? "border-amber-500/30 bg-amber-500/[0.07]"
                                    : "border-sky-500/30 bg-sky-500/[0.07]",
                            )}
                          >
                            <Checkbox
                              checked={on}
                              onCheckedChange={() => toggle(fi, pi)}
                              aria-label={`Cut the ${KIND[p.why]} at ${clock(at)}`}
                              className="border-white/30"
                            />
                            <button
                              type="button"
                              className="flex-1 min-w-0 text-left hover:text-white"
                              title={p.reason ? `${p.reason}: “${p.text}”` : "Show this moment"}
                              onClick={() =>
                                onSeek(f.clip.id, Math.max(f.range.fromMs, p.fromMs - 500))
                              }
                            >
                              <span className="tabular-nums">{clock(at)}</span>
                              <span className="ml-1.5 text-[11px] text-neutral-400">
                                {p.why === "pause"
                                  ? "Pause"
                                  : p.why === "filler"
                                    ? `Filler “${p.text}”`
                                    : "Retake"}
                              </span>
                              {p.why === "take" && p.text && (
                                <span className="block truncate text-[11px] text-neutral-500">
                                  &ldquo;{shorten(p.text)}&rdquo;
                                </span>
                              )}
                            </button>
                            <span className="tabular-nums text-neutral-400">
                              {sec(p.toMs - p.fromMs)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ),
                )}
              </>
            )}
          </div>
        )}
      </div>

      {found && total > 0 && (
        <div className="p-3 border-t border-white/[0.06] flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="text-neutral-400 hover:text-white hover:bg-white/5"
            disabled={busy}
            onClick={() => setFound(null)}
          >
            <X className="w-3.5 h-3.5 mr-1" /> Clear
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-rose-600 hover:bg-rose-500 text-white"
            disabled={busy || ticked.length === 0}
            onClick={() => void apply()}
          >
            {isApplying ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Scissors className="w-3.5 h-3.5 mr-1.5" />
            )}
            Cut {ticked.length} {ticked.length === 1 ? "piece" : "pieces"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex rounded-md bg-white/[0.04] p-0.5 gap-0.5"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 h-7 rounded px-1.5 text-[11px] font-medium transition-colors disabled:opacity-35",
              value === o.value
                ? "bg-violet-600/80 text-white"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
