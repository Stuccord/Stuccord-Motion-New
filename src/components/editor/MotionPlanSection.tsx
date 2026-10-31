// Motion Explainer graphics in the AI Director tab (stage 1): transcribe the
// clips, ask the AI for a graphics plan, undo it, and see what it planned
// and where. Editing the graphics on the timeline comes in stage 2.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AudioLines, Loader2, Palette, RotateCcw, Undo2, Volume2, Wand2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { TimelineWord } from "@/lib/captions";
import {
  ELEMENT_LABEL,
  elementSpan,
  elementSummary,
  wordsByKey,
  type MotionElement,
  type MotionPlan,
} from "@/lib/motion-plan";
import {
  getMotionPlan,
  planMotionGraphics,
  transcribeForPlan,
  undoMotionPlan,
} from "@/lib/motion-plan.functions";

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const TYPE_TINT: Record<MotionElement["type"], string> = {
  keyline: "text-violet-300 border-violet-400/30",
  counter: "text-amber-300 border-amber-400/30",
  list: "text-cyan-300 border-cyan-400/30",
  card: "text-sky-300 border-sky-400/30",
  compare: "text-pink-300 border-pink-400/30",
  story: "text-orange-300 border-orange-400/30",
  chapter: "text-emerald-300 border-emerald-400/30",
  label: "text-neutral-300 border-white/15",
  cta: "text-red-300 border-red-400/30",
  zoom: "text-neutral-400 border-white/10",
};

/** The automatic sounds' controls (the editor keeps the plan and saves it). */
export type SoundControls = {
  enabled: boolean;
  /** 0-100. */
  volume: number;
  /** Sounds deleted by hand. */
  removedCount: number;
  canEdit: boolean;
  onToggle: (on: boolean) => void;
  onVolume: (volume: number) => void;
  onRestore: () => void;
};

/** The graphics' colour controls (the editor keeps the plan and saves it). */
export type ColourControls = {
  /** The colour in use (#RRGGBB), and where it comes from (motionAccent). */
  hex: string | null;
  from: "choice" | "kit" | "footage" | "default";
  /** Colours found in the video; null: not read yet. */
  footage: string[] | null;
  /** The brand kit's highlight colour. */
  kit: string | null;
  canEdit: boolean;
  /** A colour, or null for automatic. */
  onPick: (hex: string | null) => void;
};

export function MotionPlanSection({
  projectId,
  words,
  onSeekWord,
  sound,
  colour,
}: {
  projectId: string;
  /** The project's words where they are on the timeline now. */
  words: TimelineWord[];
  onSeekWord?: (word: TimelineWord) => void;
  /** Shown once there are graphics. */
  sound?: SoundControls;
  /** Shown once there are graphics. */
  colour?: ColourControls;
}) {
  const qc = useQueryClient();
  const fetchPlan = useServerFn(getMotionPlan);
  const planFn = useServerFn(planMotionGraphics);
  const undoFn = useServerFn(undoMotionPlan);
  const transcribeFn = useServerFn(transcribeForPlan);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const key = ["motion-plan", projectId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => fetchPlan({ data: { project_id: projectId } }),
    enabled: typeof window !== "undefined",
    // Watch a Transcribe run until the worker reports back.
    refetchInterval: (q) => (q.state.data?.transcribe.status === "running" ? 4000 : false),
  });

  // When transcribing finishes, the captions and the planner have new words.
  const lastStatus = useRef<string | null>(null);
  const status = state.data?.transcribe.status ?? null;
  useEffect(() => {
    if (lastStatus.current === "running" && status !== "running") {
      void qc.invalidateQueries({ queryKey: ["transcripts", projectId] });
      if (status === "done") toast.success("Transcribed. You can plan the graphics now.");
    }
    lastStatus.current = status;
  }, [status, qc, projectId]);

  const transcribe = useMutation({
    mutationFn: () => transcribeFn({ data: { project_id: projectId } }),
    onSuccess: (r) => {
      if (r.queued === 0) toast("Everything is transcribed already.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't start transcribing"),
  });

  const plan = useMutation({
    mutationFn: () => planFn({ data: { project_id: projectId } }),
    onSuccess: (r) => {
      const n = r.plan.elements.length;
      toast.success(`Planned ${n} graphic${n === 1 ? "" : "s"}.`);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Planning failed"),
  });

  const undo = useMutation({
    mutationFn: () => undoFn({ data: { project_id: projectId } }),
    onSuccess: () => {
      toast("Went back to the previous plan.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't undo"),
  });

  const byKey = useMemo(() => wordsByKey(words), [words]);

  if (state.isLoading || !state.data) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading graphics…
        </div>
      </Shell>
    );
  }

  const {
    plan: current,
    canUndo,
    canEdit,
    transcribe: tr,
    untranscribed,
    allowance,
    images,
  } = state.data;
  const running = tr.status === "running";
  const outOfPlans = allowance.used >= allowance.cap;
  const busy = plan.isPending || undo.isPending;

  return (
    <Shell>
      <p className="text-[10px] text-neutral-500 tabular-nums">
        {allowance.used} of {allowance.cap} AI plans used this month
        {allowance.team ? ` (${allowance.team.name})` : ""}
        {images ? ` · ${images.used} of ${images.cap} AI pictures` : ""}
      </p>

      {untranscribed > 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
          <p className="text-[11px] text-neutral-300 leading-snug">
            {running
              ? "Transcribing your clips…"
              : `${untranscribed} clip${untranscribed === 1 ? " needs" : "s need"} transcribing before the AI can plan graphics.`}
          </p>
          {tr.status === "failed" && tr.error && (
            <p className="text-[10px] text-red-300 leading-snug">{tr.error}</p>
          )}
          {canEdit && (
            <button
              onClick={() => transcribe.mutate()}
              disabled={running || transcribe.isPending}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium bg-white/[0.08] text-neutral-100 hover:bg-white/[0.12] disabled:opacity-50"
            >
              {running || transcribe.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <AudioLines className="w-3 h-3" />
              )}
              {running ? "Transcribing…" : tr.status === "failed" ? "Try again" : "Transcribe"}
            </button>
          )}
        </div>
      ) : (
        canEdit && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => (current ? setConfirmReplace(true) : plan.mutate())}
              disabled={busy || outOfPlans}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {plan.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Wand2 className="w-3 h-3" />
              )}
              {plan.isPending ? "Planning…" : current ? "Plan again" : "Plan graphics"}
            </button>
            {canUndo && (
              <button
                onClick={() => undo.mutate()}
                disabled={busy}
                title="Go back to the previous plan"
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-neutral-300 bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-50"
              >
                <Undo2 className="w-3 h-3" /> Undo
              </button>
            )}
          </div>
        )
      )}
      {plan.isPending && (
        <p className="text-[10px] text-neutral-500">This can take a minute for a long video.</p>
      )}
      {outOfPlans && canEdit && (
        <p className="text-[10px] text-amber-300">No AI plans left this month.</p>
      )}

      {colour && current && <ColourRow colour={colour} />}
      {sound && current && <SoundRow sound={sound} />}

      {current ? (
        <PlanList plan={current} byKey={byKey} onSeekWord={onSeekWord} />
      ) : (
        untranscribed === 0 && (
          <p className="text-[11px] text-neutral-500 leading-snug">
            No graphics yet. The AI reads what you say (and your script, if you added one) and picks
            key lines, numbers, lists, cards and zooms for the right words.
          </p>
        )
      )}

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the current graphics?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will plan the graphics again from scratch, and any changes you made will be
              replaced. You can go back once with Undo. This uses one of your monthly AI plans.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => plan.mutate()}>Plan again</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.04] p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <Wand2 className="w-3 h-3 text-violet-400" />
        <span className="text-[10px] uppercase tracking-widest text-neutral-400 font-semibold">
          Motion Explainer graphics
        </span>
      </div>
      {children}
    </div>
  );
}

function PlanList({
  plan,
  byKey,
  onSeekWord,
}: {
  plan: MotionPlan;
  byKey: Map<string, TimelineWord>;
  onSeekWord?: (word: TimelineWord) => void;
}) {
  const rows = plan.elements.map((el) => ({ el, span: elementSpan(el, byKey) }));
  const shown = rows.filter((r) => r.span).length;
  rows.sort((a, b) => (a.span?.startMs ?? Infinity) - (b.span?.startMs ?? Infinity));
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-neutral-500">
        {plan.elements.length} graphic{plan.elements.length === 1 ? "" : "s"} planned
        {shown < plan.elements.length
          ? ` · ${plan.elements.length - shown} on trimmed-away words`
          : ""}
      </p>
      <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
        {rows.map(({ el, span }) => {
          const word = byKey.get(`${el.start.clip_id}:${el.start.word_index}`);
          return (
            <li key={el.id}>
              <button
                onClick={() => word && onSeekWord?.(word)}
                disabled={!span || !onSeekWord}
                title={el.reason || undefined}
                className={cn(
                  "w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 border border-white/[0.04] bg-black/20",
                  span ? "hover:bg-white/[0.04]" : "opacity-40",
                )}
              >
                <span className="shrink-0 w-9 text-[10px] font-mono text-neutral-500 tabular-nums pt-px">
                  {span ? fmt(span.startMs) : "—"}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[9px] font-semibold uppercase tracking-wide border rounded px-1 py-px",
                    TYPE_TINT[el.type],
                  )}
                >
                  {ELEMENT_LABEL[el.type]}
                </span>
                <span className="text-[11px] text-neutral-300 leading-snug line-clamp-2">
                  {elementSummary(el)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const COLOUR_FROM: Record<ColourControls["from"], string> = {
  choice: "Picked by you",
  kit: "Automatic: your brand kit's colour",
  footage: "Automatic: from your video",
  default: "Automatic",
};

function ColourRow({ colour }: { colour: ColourControls }) {
  const auto = colour.from !== "choice";
  const same = (a: string | null, b: string | null) =>
    !!a && !!b && a.toUpperCase() === b.toUpperCase();
  // The video's colours, then the brand kit's (when it isn't one of them).
  const swatches = [
    ...(colour.footage ?? []).map((hex) => ({ hex, label: "From your video" })),
    ...(colour.kit && !(colour.footage ?? []).some((c) => same(c, colour.kit))
      ? [{ hex: colour.kit, label: "Brand kit" }]
      : []),
  ];
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Palette className="w-3 h-3 text-violet-300" />
        <span className="text-[11px] text-neutral-300 flex-1">Colour</span>
        {colour.hex && (
          <span
            className="w-3.5 h-3.5 rounded-full border border-white/20"
            style={{ background: colour.hex }}
            aria-hidden
          />
        )}
      </div>
      <p className="text-[10px] text-neutral-500 leading-snug">
        {COLOUR_FROM[colour.from]}
        {colour.footage === null
          ? " · reading your video's colours…"
          : colour.footage.length === 0
            ? " · no clear colour in your video"
            : ""}
      </p>
      {colour.canEdit && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => colour.onPick(null)}
            aria-pressed={auto}
            className={cn(
              "h-6 px-2 rounded-md text-[10px] font-medium border",
              auto
                ? "border-violet-400/60 bg-violet-500/15 text-violet-200"
                : "border-white/10 text-neutral-400 hover:text-white",
            )}
          >
            Auto
          </button>
          {swatches.map((s) => {
            const picked = !auto && same(colour.hex, s.hex);
            return (
              <button
                key={s.hex + s.label}
                onClick={() => colour.onPick(s.hex.toUpperCase())}
                title={`${s.label} (${s.hex})`}
                aria-label={`${s.label}: ${s.hex}`}
                aria-pressed={picked}
                className={cn(
                  "w-6 h-6 rounded-full border transition",
                  picked
                    ? "border-white ring-2 ring-violet-400/70"
                    : "border-white/20 hover:scale-110",
                )}
                style={{ background: s.hex }}
              />
            );
          })}
          <label
            title="Any colour"
            className="relative w-6 h-6 rounded-full border border-white/20 cursor-pointer overflow-hidden"
            style={{
              background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
            }}
          >
            <input
              type="color"
              value={colour.hex ?? "#7C5CFF"}
              onChange={(e) => colour.onPick(e.target.value.toUpperCase())}
              className="absolute inset-0 opacity-0 cursor-pointer"
              aria-label="Pick any colour"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function SoundRow({ sound }: { sound: SoundControls }) {
  // The slider moves freely; the plan changes when it's let go.
  const [draft, setDraft] = useState<number | null>(null);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Volume2 className="w-3 h-3 text-sky-300" />
        <span className="text-[11px] text-neutral-300 flex-1">Sounds (whooshes, clicks, hits)</span>
        <Switch
          checked={sound.enabled}
          disabled={!sound.canEdit}
          onCheckedChange={sound.onToggle}
          aria-label="Graphics sounds"
          className="data-[state=checked]:bg-sky-600"
        />
      </div>
      {sound.enabled && (
        <div className="flex items-center gap-2">
          <Slider
            value={[draft ?? sound.volume]}
            max={100}
            step={1}
            disabled={!sound.canEdit}
            onValueChange={(v) => setDraft(v[0])}
            onValueCommit={(v) => {
              setDraft(null);
              sound.onVolume(v[0]);
            }}
            className="flex-1"
            aria-label="Sounds volume"
          />
          <span className="text-[10px] font-mono text-neutral-500 w-7 text-right tabular-nums">
            {draft ?? sound.volume}
          </span>
        </div>
      )}
      {sound.removedCount > 0 && sound.canEdit && (
        <button
          onClick={sound.onRestore}
          className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white"
        >
          <RotateCcw className="w-3 h-3" /> Bring back {sound.removedCount} deleted sound
          {sound.removedCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
