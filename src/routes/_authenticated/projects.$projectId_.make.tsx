// Auto edit (docs/auto-edit-plan.md): right after upload, the app makes the
// video by itself and shows the result; the editor is there for changes.
// The steps run here, in order, and each one checks whether it's already
// done, so coming back carries on where it was: transcribe (worker), plan
// the graphics (Claude), make the first story pictures (Higgsfield), render
// (worker). If the graphics can't be planned, the video is still made with
// captions.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  AudioLines,
  Scissors,
  CheckCircle2,
  Circle,
  Download,
  Film,
  ImageIcon,
  Loader2,
  MinusCircle,
  PenTool,
  RefreshCw,
  Wand2,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isUnlimited } from "@/lib/plans";
import { getProject, getRenderSignedUrl, submitRender } from "@/lib/projects.functions";
import {
  getMotionPlan,
  cutPausesForAutoEdit,
  placeBrollForAutoEdit,
  planMotionGraphics,
  saveMotionPlan,
  transcribeForPlan,
  type MotionPlanState,
} from "@/lib/motion-plan.functions";
import { makeSceneImage } from "@/lib/story-images.functions";
import type { MotionLook, MotionPlan } from "@/lib/motion-plan";
import {
  AUTO_PICTURES,
  finishAutoPlan,
  needsAutoPictures,
  pictureJobs,
  prepareAutoPlan,
  withPicture,
} from "@/lib/auto-edit";
import { motionAccent } from "@/motion/theme";

export const Route = createFileRoute("/_authenticated/projects/$projectId_/make")({
  head: () => ({ meta: [{ title: "Making your video — Stuccord Motion" }] }),
  component: MakePage,
});

type StepId = "transcribe" | "cut" | "plan" | "pictures" | "render";
type StepState = "waiting" | "active" | "done" | "skipped" | "failed";

const STEPS: { id: StepId; label: string; icon: typeof Film }[] = [
  { id: "transcribe", label: "Transcribing what you say", icon: AudioLines },
  { id: "cut", label: "Cutting the pauses", icon: Scissors },
  { id: "plan", label: "Planning the graphics (Claude)", icon: Wand2 },
  { id: "pictures", label: "Making the pictures (Higgsfield)", icon: ImageIcon },
  { id: "render", label: "Rendering your video", icon: Film },
];

const LOOKS: { id: MotionLook; label: string }[] = [
  { id: "glass", label: "Motion Explainer" },
  { id: "minimal", label: "Minimal" },
  { id: "film", label: "Cinematic" },
  { id: "saas", label: "SaaS" },
  { id: "paper", label: "Paper" },
  { id: "docu", label: "Documentary" },
  { id: "cine3d", label: "3D Cinematic" },
];

const RUNNING_JOB = ["queued", "transcribing", "planning", "rendering"];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** An error's words, or the fallback when it has none (an empty message must still show). */
const message = (e: unknown, fallback: string) =>
  (e instanceof Error && e.message.trim()) || fallback;

function MakePage() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const fetchProject = useServerFn(getProject);
  const fetchPlan = useServerFn(getMotionPlan);
  const transcribeFn = useServerFn(transcribeForPlan);
  const planFn = useServerFn(planMotionGraphics);
  const cutFn = useServerFn(cutPausesForAutoEdit);
  const brollFn = useServerFn(placeBrollForAutoEdit);
  const saveFn = useServerFn(saveMotionPlan);
  const makeFn = useServerFn(makeSceneImage);
  const renderFn = useServerFn(submitRender);
  const signFn = useServerFn(getRenderSignedUrl);

  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<Record<StepId, StepState>>({
    transcribe: "waiting",
    cut: "waiting",
    plan: "waiting",
    pictures: "waiting",
    render: "waiting",
  });
  const [notes, setNotes] = useState<Partial<Record<StepId, string>>>({});
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // The export finished but the graphics couldn't be drawn (the worker's reason).
  const [graphicsError, setGraphicsError] = useState<string | null>(null);
  const [planState, setPlanState] = useState<MotionPlanState | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const mark = (id: StepId, state: StepState, note?: string) => {
    setSteps((s) => ({ ...s, [id]: state }));
    if (note !== undefined) setNotes((n) => ({ ...n, [id]: note }));
  };

  /** Waits for the render job to finish, then shows the video. */
  const waitForRender = useCallback(async () => {
    mark("render", "active");
    for (;;) {
      const r = await fetchProject({ data: { id: projectId } });
      const job = r.latestJob as {
        status: string;
        progress?: number | null;
        stage_message?: string | null;
        error?: string | null;
        edit_plan?: { graphics_error?: unknown } | null;
      } | null;
      if (
        r.project.status === "ready" &&
        r.project.output_path &&
        !RUNNING_JOB.includes(job?.status ?? "")
      ) {
        const { url } = await signFn({ data: { path: r.project.output_path } });
        setProgress(null);
        const ge = job?.edit_plan?.graphics_error;
        setGraphicsError(typeof ge === "string" ? ge : null);
        setVideoUrl(url);
        mark("render", "done");
        void qc.invalidateQueries({ queryKey: ["projects"] });
        return;
      }
      if (job?.status === "failed") {
        throw new Error(job.error || "The render failed.");
      }
      setProgress({
        pct: job?.progress ?? 0,
        text: job?.stage_message ?? "Waiting for the renderer…",
      });
      await sleep(4000);
    }
  }, [fetchProject, projectId, qc, signFn]);

  /** Starts a render with the project's captions and music settings, then waits for it. */
  const render = useCallback(async () => {
    // Active from the start, so a refused render shows as this step failing.
    mark("render", "active");
    const r = await fetchProject({ data: { id: projectId } });
    const p = r.project as {
      captions_enabled?: boolean | null;
      music_enabled?: boolean | null;
      music_volume?: number | null;
    };
    setVideoUrl(null);
    await renderFn({
      data: {
        project_id: projectId,
        captions: p.captions_enabled ?? true,
        // A built-in bed even if the graphics couldn't be made (captions only).
        music: { enabled: p.music_enabled ?? true, volume: p.music_volume ?? 60, bed: true },
      },
    });
    void qc.invalidateQueries({ queryKey: ["usage-stats"] });
    await waitForRender();
  }, [fetchProject, projectId, qc, renderFn, waitForRender]);

  /** Makes the first story pictures and saves the plan as the automatic edit keeps it. */
  const pictures = useCallback(
    async (start: MotionPlan) => {
      if (!needsAutoPictures(start)) {
        const made = start.elements.some(
          (e) => (e.type === "story" || e.type === "metaphor") && e.scenes?.some((sc) => sc.image),
        );
        if (made) mark("pictures", "done", "Already made.");
        else mark("pictures", "skipped", "No pictures needed in this video.");
        return start;
      }
      mark("pictures", "active");
      let plan = prepareAutoPlan(start);
      const jobs = pictureJobs(plan);
      const accent = motionAccent(plan.colour, null).hex;
      let made = 0;
      let problem: string | null = null;
      for (const job of jobs) {
        const story = plan.elements.find((e) => e.id === job.elementId);
        const reference =
          job.matchIndex !== null ? (story?.scenes?.[job.matchIndex]?.image?.path ?? null) : null;
        try {
          const r = await makeFn({
            data: {
              project_id: projectId,
              prompt: job.prompt,
              reference_path: reference,
              accent,
              style: job.style,
              with_speaker: false,
            },
          });
          plan = withPicture(plan, job.elementId, job.index, r.path);
          made++;
        } catch (e) {
          problem = message(e, "Couldn't make a picture.");
          break;
        }
      }
      plan = finishAutoPlan(plan);
      await saveFn({ data: { project_id: projectId, plan } });
      if (problem) {
        mark("pictures", made ? "done" : "skipped", `${problem} The video is made without them.`);
      } else {
        mark(
          "pictures",
          jobs.length ? "done" : "skipped",
          jobs.length
            ? `${made} made (up to ${AUTO_PICTURES} a video).`
            : "No pictures needed in this video.",
        );
      }
      return plan;
    },
    [makeFn, projectId, saveFn],
  );

  /** Plans the graphics with Claude; null (and a note) when it can't, so the video gets captions only. */
  const planGraphics = useCallback(async (): Promise<MotionPlan | null> => {
    mark("plan", "active");
    try {
      const r = await planFn({ data: { project_id: projectId } });
      const n = r.plan.elements.length;
      mark("plan", "done", `${n} graphic${n === 1 ? "" : "s"} planned.`);
      return r.plan;
    } catch (e) {
      mark(
        "plan",
        "skipped",
        `${message(e, "Planning failed.")} The video is made with captions only.`,
      );
      return null;
    }
  }, [planFn, projectId]);

  /** The whole automatic edit, carrying on from wherever it got to. */
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      const r = await fetchProject({ data: { id: projectId } });
      setTitle(r.project.title);
      const job = r.latestJob as { status: string } | null;
      // Already made (or being rendered): just show it.
      if (r.project.status === "ready" || RUNNING_JOB.includes(job?.status ?? "")) {
        for (const id of ["transcribe", "cut", "plan", "pictures"] as StepId[]) mark(id, "done");
        setPlanState(await fetchPlan({ data: { project_id: projectId } }));
        await waitForRender();
        return;
      }

      // 1. Transcribe (the worker), and wait until every clip has words.
      mark("transcribe", "active");
      let st = await fetchPlan({ data: { project_id: projectId } });
      if (st.untranscribed > 0 && st.transcribe.status !== "running") {
        await transcribeFn({ data: { project_id: projectId } });
      }
      while (st.untranscribed > 0) {
        await sleep(4000);
        st = await fetchPlan({ data: { project_id: projectId } });
        if (st.untranscribed > 0 && st.transcribe.status === "failed") {
          throw new Error(st.transcribe.error || "Transcribing failed.");
        }
      }
      mark("transcribe", "done");

      // 2. Cut the pauses (before planning: the plan is anchored to the cut clips).
      if (st.plan) mark("cut", "done");
      else {
        mark("cut", "active");
        try {
          const c = await cutFn({ data: { project_id: projectId } });
          mark(
            "cut",
            c.cutMs > 0 ? "done" : "skipped",
            c.cutMs > 0
              ? `${(c.cutMs / 1000).toFixed(1)} s of pauses cut. Change it in the editor (Auto-cut).`
              : "No long pauses to cut.",
          );
        } catch (e) {
          mark("cut", "skipped", `${message(e, "Couldn't cut the pauses.")} The pauses stay in.`);
        }
      }

      // 3. Plan the graphics (Claude), unless there's a plan already.
      let plan = st.plan;
      if (plan) mark("plan", "done", `${plan.elements.length} graphics planned.`);
      else plan = await planGraphics();

      // 4. The pictures (Higgsfield).
      if (plan) plan = await pictures(plan);
      else mark("pictures", "skipped", "No graphics to make pictures for.");
      setPlanState(await fetchPlan({ data: { project_id: projectId } }));

      // 5. Place the B-roll (off the full-screen graphics), then render.
      try {
        const b = await brollFn({ data: { project_id: projectId } });
        if (b.of > b.placed) {
          toast.message(`${b.of - b.placed} B-roll clip(s) didn't fit; place them in the editor.`);
        }
      } catch (e) {
        toast.error(`${message(e, "Couldn't place the B-roll.")} It plays from the start.`);
      }
      await render();
    } catch (e) {
      const text = message(
        e,
        "This step failed and the server gave no reason. Try again, or open the editor.",
      );
      setError(text);
      setSteps((s) => {
        const active = (Object.keys(s) as StepId[]).find((k) => s[k] === "active");
        return active ? { ...s, [active]: "failed" } : s;
      });
    } finally {
      running.current = false;
    }
  }, [
    fetchPlan,
    fetchProject,
    pictures,
    planGraphics,
    projectId,
    render,
    transcribeFn,
    cutFn,
    brollFn,
    waitForRender,
  ]);

  useEffect(() => {
    void run();
  }, [run]);

  /** A quick fix: runs `change`, then renders again. */
  const fix = async (change: () => Promise<void>) => {
    if (busy || running.current) return;
    setBusy(true);
    setError(null);
    running.current = true;
    try {
      await change();
      await render();
    } catch (e) {
      setError(message(e, "Something went wrong."));
      mark("render", "failed");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  /** Renders the same edit again (after an app update, or if a render came out wrong). */
  const renderAgain = () => fix(async () => {});

  const changeLook = (look: MotionLook) =>
    fix(async () => {
      const st = await fetchPlan({ data: { project_id: projectId } });
      if (!st.plan) throw new Error("This video has no graphics to restyle.");
      const restyled = { ...st.plan, look };
      // 3D Cinematic shows its metaphors as AI object pictures: make any missing.
      // Only the metaphors' pictures: graphics added in the editor stay as they are.
      let made: MotionPlan = restyled;
      if (look === "cine3d") {
        const jobs = pictureJobs(restyled).filter((j) => j.style === "object");
        const accent = motionAccent(restyled.colour, null).hex;
        for (const job of jobs) {
          try {
            const r = await makeFn({
              data: {
                project_id: projectId,
                prompt: job.prompt,
                reference_path: null,
                accent,
                style: "object",
                with_speaker: false,
              },
            });
            made = withPicture(made, job.elementId, job.index, r.path);
          } catch (e) {
            toast.error(message(e, "Couldn't make a picture."));
            break;
          }
        }
      }
      await saveFn({ data: { project_id: projectId, plan: made } });
      setPlanState(await fetchPlan({ data: { project_id: projectId } }));
    });

  const redoGraphics = () =>
    fix(async () => {
      mark("render", "waiting");
      const plan = await planGraphics();
      if (plan) await pictures(plan);
      setPlanState(await fetchPlan({ data: { project_id: projectId } }));
    });

  const done = steps.render === "done" && !!videoUrl;
  const look = planState?.plan?.look ?? null;
  const plansLeft = planState ? planState.allowance.cap - planState.allowance.used : null;

  return (
    <AppShell
      title={done ? "Your video is ready" : "Making your video"}
      subtitle={
        done
          ? title
          : "The AI is editing your footage. This takes a few minutes — keep this page open."
      }
    >
      <div className="max-w-5xl space-y-6">
        {done ? (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-2xl overflow-hidden bg-black border border-border shadow-[0_30px_80px_-30px_color-mix(in_oklab,var(--color-primary)_45%,transparent)]">
              <video
                src={videoUrl ?? undefined}
                controls
                playsInline
                className="w-full max-h-[70vh] bg-black"
                data-auto-result
              />
            </div>
            <div className="space-y-4">
              {graphicsError && (
                <div
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300"
                  data-graphics-error
                >
                  <div className="font-semibold">Made without graphics</div>
                  The video was rendered, but the graphics couldn&apos;t be drawn this time (
                  {graphicsError}). Change the look or redo the graphics to try again.
                </div>
              )}
              <a href={videoUrl ?? undefined} download className="block">
                <Button size="lg" className="w-full rounded-full" disabled={busy}>
                  <Download /> Download
                </Button>
              </a>
              <Link to="/projects/$projectId" params={{ projectId }} className="block">
                <Button size="lg" variant="outline" className="w-full rounded-full" disabled={busy}>
                  <PenTool /> Open in editor
                </Button>
              </Link>

              {planState?.plan && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                  <div className="caps-label text-[11px] text-muted-foreground">Change the look</div>
                  <div className="flex flex-wrap gap-1.5">
                    {LOOKS.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => changeLook(l.id)}
                        disabled={busy || l.id === look}
                        className={cn(
                          "px-2.5 h-7 rounded-md text-xs border transition-colors disabled:opacity-60",
                          l.id === look
                            ? "bg-primary text-primary-foreground border-primary disabled:opacity-100"
                            : "border-border bg-surface hover:border-white/20",
                        )}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Re-renders the video (uses an export).
                  </p>
                  {(look === "docu" || look === "cine3d") &&
                    !planState.plan.elements.some((e) => e.type === "metaphor") && (
                      <p className="text-[11px] text-amber-200/90">
                        This look's drawn or 3D metaphor scenes are planned with the graphics:
                        press Redo the graphics below to add them.
                      </p>
                    )}
                </div>
              )}

              <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                <div className="caps-label text-[11px] text-muted-foreground">Not quite right?</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={renderAgain}
                  disabled={busy}
                  data-render-again
                >
                  <Film /> Render again
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  The same edit, rendered fresh (uses an export).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={redoGraphics}
                  disabled={busy || plansLeft === 0}
                >
                  <RefreshCw /> Redo the graphics
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Claude plans them again and the video is re-rendered
                  {plansLeft !== null && planState && !isUnlimited(planState.allowance.cap)
                    ? ` (${plansLeft} AI plan${plansLeft === 1 ? "" : "s"} left this month)`
                    : ""}
                  .
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {(!done || busy) && (
          <ol className="max-w-3xl rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {STEPS.map((s) => (
              <StepRow
                key={s.id}
                label={s.label}
                icon={s.icon}
                state={steps[s.id]}
                note={notes[s.id]}
                progress={s.id === "render" && steps.render === "active" ? progress : null}
              />
            ))}
          </ol>
        )}

        {done && !busy && (
          <ul className="text-xs text-muted-foreground space-y-1">
            {STEPS.map((s) =>
              notes[s.id] ? (
                <li key={s.id}>
                  <span className="font-medium text-foreground/80">{s.label}:</span> {notes[s.id]}
                </li>
              ) : null,
            )}
          </ul>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 space-y-3">
            <div>{error}</div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void run()} disabled={busy}>
                <RefreshCw /> Try again
              </Button>
              <Link to="/projects/$projectId" params={{ projectId }}>
                <Button size="sm" variant="outline">
                  Open in editor
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StepRow({
  label,
  icon: Icon,
  state,
  note,
  progress,
}: {
  label: string;
  icon: typeof Film;
  state: StepState;
  note?: string;
  progress: { pct: number; text: string } | null;
}) {
  const Mark =
    state === "done"
      ? CheckCircle2
      : state === "active"
        ? Loader2
        : state === "failed"
          ? XCircle
          : state === "skipped"
            ? MinusCircle
            : Circle;
  return (
    <li
      className={cn(
        "flex items-start gap-3 p-4 transition-colors",
        state === "active" && "bg-primary/[0.08]",
      )}
      data-step-state={state}
    >
      <Mark
        className={cn(
          "w-5 h-5 shrink-0 mt-0.5",
          state === "done" && "text-emerald-400",
          state === "active" && "text-primary-glow animate-spin",
          state === "failed" && "text-red-400",
          (state === "skipped" || state === "waiting") && "text-muted-foreground/40",
        )}
      />
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "flex items-center gap-2 text-sm",
            state === "waiting" && "text-muted-foreground/70",
          )}
        >
          <Icon className="w-4 h-4 shrink-0" /> {label}
        </div>
        {note && <div className="text-xs text-muted-foreground mt-1">{note}</div>}
        {progress && (
          <div className="mt-2">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
              <span className="truncate">{progress.text}</span>
              <span className="tabular-nums">{progress.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary-glow transition-all duration-700"
                style={{ width: `${Math.max(4, progress.pct)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
