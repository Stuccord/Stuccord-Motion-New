// Auto edit (docs/auto-edit-plan.md): right after upload, the app makes the
// video by itself and shows the result; the editor is there for changes.
// The steps run on the server (src/lib/auto-edit-run.server.ts), so closing
// this page doesn't stop them: this page starts the run, shows its progress
// (kept on the project), and carries it on if it stopped. Quick fixes that
// only re-render (change the look, render again) run from here.

import { METAPHOR_LOOKS, OBJECT_PICTURE_LOOKS } from "@/motion/looks";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  AudioLines,
  Clapperboard,
  Scissors,
  CheckCircle2,
  Circle,
  Download,
  Film,
  ImageIcon,
  Loader2,
  MinusCircle,
  Music2,
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
import { getMotionPlan, saveMotionPlan, type MotionPlanState } from "@/lib/motion-plan.functions";
import { makeSceneImage } from "@/lib/story-images.functions";
import { startAutoEdit } from "@/lib/auto-edit.functions";
import { type MotionLook, type MotionPlan } from "@/lib/motion-plan";
import { pictureJobs, withPicture } from "@/lib/auto-edit";
import {
  AUTO_STEP_IDS,
  isAutoEditLive,
  parseAutoEdit,
  type AutoEdit,
  type AutoStepId,
  type AutoStepState,
} from "@/lib/auto-edit-state";
import { motionAccent } from "@/motion/theme";

export const Route = createFileRoute("/_authenticated/projects/$projectId_/make")({
  head: () => ({ meta: [{ title: "Making your video — Stuccord Motion" }] }),
  component: MakePage,
});

type StepId = AutoStepId;
type StepState = AutoStepState;

const STEPS: { id: StepId; label: string; icon: typeof Film }[] = [
  { id: "transcribe", label: "Transcribing what you say", icon: AudioLines },
  { id: "cut", label: "Cutting the pauses", icon: Scissors },
  { id: "plan", label: "Planning the graphics (Claude)", icon: Wand2 },
  { id: "pictures", label: "Making the pictures (Higgsfield)", icon: ImageIcon },
  { id: "animate", label: "Bringing the pictures to life (Higgsfield)", icon: Clapperboard },
  { id: "music", label: "Making the music (ElevenLabs)", icon: Music2 },
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
  { id: "bulletin", label: "Bulletin" },
  { id: "impact", label: "Impact" },
  { id: "noir", label: "Noir" },
  { id: "monument", label: "Monument" },
  { id: "talk", label: "Studio Talk" },
  { id: "notebook", label: "Notebook" },
  { id: "hud", label: "Spec HUD" },
  { id: "studio", label: "Studio 3D" },
];

const RUNNING_JOB = ["queued", "transcribing", "planning", "rendering"];
/** How often the page reads the server's progress. */
const POLL_MS = 3000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** An error's words, or the fallback when it has none (an empty message must still show). */
const message = (e: unknown, fallback: string) =>
  (e instanceof Error && e.message.trim()) || fallback;

const allSteps = (state: StepState) =>
  Object.fromEntries(AUTO_STEP_IDS.map((id) => [id, state])) as Record<StepId, StepState>;

type LatestJob = {
  status: string;
  progress?: number | null;
  stage_message?: string | null;
  error?: string | null;
  edit_plan?: { graphics_error?: unknown } | null;
} | null;

function MakePage() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const fetchProject = useServerFn(getProject);
  const fetchPlan = useServerFn(getMotionPlan);
  const saveFn = useServerFn(saveMotionPlan);
  const makeFn = useServerFn(makeSceneImage);
  const startFn = useServerFn(startAutoEdit);
  const renderFn = useServerFn(submitRender);
  const signFn = useServerFn(getRenderSignedUrl);

  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<Record<StepId, StepState>>(allSteps("waiting"));
  const [notes, setNotes] = useState<Partial<Record<StepId, string>>>({});
  const [runNotes, setRunNotes] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // The export finished but the graphics couldn't be drawn (the worker's reason).
  const [graphicsError, setGraphicsError] = useState<string | null>(null);
  const [planState, setPlanState] = useState<MotionPlanState | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped to read the progress again after it ended (Try again, Redo).
  const [watch, setWatch] = useState(0);
  // A quick fix is rendering from this page: the server's progress isn't read meanwhile.
  const fixing = useRef(false);
  // When this page started (or carried on) the run, and the start still on its way, if any:
  // two reads at once (React runs effects twice in development) share one start.
  const startedAt = useRef(0);
  const starting = useRef<Promise<AutoEdit> | null>(null);

  const mark = (id: StepId, state: StepState, note?: string) => {
    setSteps((s) => ({ ...s, [id]: state }));
    if (note !== undefined) setNotes((n) => ({ ...n, [id]: note }));
  };

  /** Shows the server's progress. */
  const showRun = (a: AutoEdit) => {
    setSteps(
      Object.fromEntries(
        AUTO_STEP_IDS.map((id) => [id, a.steps[id]?.state ?? "waiting"]),
      ) as Record<StepId, StepState>,
    );
    setNotes(
      Object.fromEntries(
        AUTO_STEP_IDS.flatMap((id) => (a.steps[id]?.note ? [[id, a.steps[id]?.note]] : [])),
      ),
    );
    setRunNotes(a.notes ?? []);
  };

  /** Shows the finished video. */
  const showVideo = useCallback(
    async (outputPath: string, job: LatestJob) => {
      const { url } = await signFn({ data: { path: outputPath } });
      setProgress(null);
      const ge = job?.edit_plan?.graphics_error;
      setGraphicsError(typeof ge === "string" ? ge : null);
      setVideoUrl(url);
      setPlanState(await fetchPlan({ data: { project_id: projectId } }));
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    [fetchPlan, projectId, qc, signFn],
  );

  /**
   * Reads the server's progress once and shows it; starts the run when
   * there's none, or carries it on (once per visit) when it has stopped.
   * "over" when there's nothing more to watch.
   */
  const readOnce = useCallback(async (): Promise<"watching" | "over"> => {
    const r = await fetchProject({ data: { id: projectId } });
    setTitle(r.project.title);
    const job = r.latestJob as LatestJob;
    const auto = parseAutoEdit(r.project.auto_edit);
    const ready =
      r.project.status === "ready" &&
      !!r.project.output_path &&
      !RUNNING_JOB.includes(job?.status ?? "");

    if (auto) showRun(auto);
    if (auto?.steps.render?.state === "active" && job && RUNNING_JOB.includes(job.status)) {
      setProgress({
        pct: job.progress ?? 0,
        text: job.stage_message ?? "Waiting for the renderer…",
      });
    }

    // Made already (a video from before the server ran the edit has no run).
    if ((!auto || auto.status === "done") && ready && r.project.output_path) {
      if (!auto) setSteps(allSteps("done"));
      setError(null);
      await showVideo(r.project.output_path, job);
      return "over";
    }
    if (auto?.status === "failed") {
      setError(
        auto.error ||
          "This step failed and the server gave no reason. Try again, or open the editor.",
      );
      return "over";
    }
    if (auto && isAutoEditLive(auto)) {
      setError(null);
      return "watching";
    }
    // Not started yet, or it stopped (the worker or the app restarted). The
    // page carries it on once; one that stops again after that needs a person.
    if (startedAt.current && !starting.current) {
      if (Date.now() - startedAt.current < 60_000) return "watching";
      setError("Making the video stopped responding. Try again.");
      return "over";
    }
    if (!starting.current) {
      startedAt.current = Date.now();
      starting.current = startFn({ data: { project_id: projectId } });
    }
    let started: AutoEdit;
    try {
      started = await starting.current;
    } finally {
      starting.current = null;
    }
    showRun(started);
    if (started.status === "failed") {
      setError(started.error || "The video couldn't be started.");
      return "over";
    }
    return "watching";
  }, [fetchProject, projectId, showVideo, startFn]);

  useEffect(() => {
    let stop = false;
    void (async () => {
      for (;;) {
        if (stop) return;
        if (!fixing.current) {
          try {
            if ((await readOnce()) === "over") return;
          } catch {
            // A dropped connection: read it again next time.
          }
        }
        await sleep(POLL_MS);
      }
    })();
    return () => {
      stop = true;
    };
  }, [readOnce, watch]);

  /** Starts the run again from where it stopped. */
  const tryAgain = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await startFn({ data: { project_id: projectId } });
      showRun(started);
      if (started.status === "failed") setError(started.error || "The video couldn't be started.");
      else setWatch((w) => w + 1);
    } catch (e) {
      setError(message(e, "Couldn't start it again."));
    } finally {
      setBusy(false);
    }
  };

  /** Waits for the render job to finish, then shows the video (quick fixes). */
  const waitForRender = useCallback(async () => {
    mark("render", "active");
    for (;;) {
      const r = await fetchProject({ data: { id: projectId } });
      const job = r.latestJob as LatestJob;
      if (
        r.project.status === "ready" &&
        r.project.output_path &&
        !RUNNING_JOB.includes(job?.status ?? "")
      ) {
        await showVideo(r.project.output_path, job);
        mark("render", "done");
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
  }, [fetchProject, projectId, showVideo]);

  /** Starts a render with the project's captions and music settings, then waits for it. */
  const render = useCallback(async () => {
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
        music: { enabled: p.music_enabled ?? true, volume: p.music_volume ?? 60, bed: true },
      },
    });
    void qc.invalidateQueries({ queryKey: ["usage-stats"] });
    await waitForRender();
  }, [fetchProject, projectId, qc, renderFn, waitForRender]);

  /** A quick fix: runs `change`, then renders again. */
  const fix = async (change: () => Promise<void>) => {
    if (busy || fixing.current) return;
    setBusy(true);
    setError(null);
    fixing.current = true;
    try {
      await change();
      await render();
    } catch (e) {
      setError(message(e, "Something went wrong."));
      mark("render", "failed");
    } finally {
      fixing.current = false;
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
      // 3D Cinematic and Monument show their metaphors as AI object pictures:
      // make any missing. Only the metaphors' pictures: graphics added in the
      // editor stay as they are.
      let made: MotionPlan = restyled;
      if (OBJECT_PICTURE_LOOKS.has(look)) {
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
                look,
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

  /** Claude plans the graphics again, and the server makes the video again (pictures, clips, render). */
  const redoGraphics = async () => {
    if (busy || fixing.current) return;
    setBusy(true);
    setError(null);
    try {
      const started = await startFn({ data: { project_id: projectId, redo: true } });
      setVideoUrl(null);
      showRun(started);
      if (started.status === "failed") setError(started.error || "The video couldn't be started.");
      else setWatch((w) => w + 1);
    } catch (e) {
      setError(message(e, "Couldn't redo the graphics."));
    } finally {
      setBusy(false);
    }
  };

  const done = steps.render === "done" && !!videoUrl;
  const look = planState?.plan?.look ?? null;
  const plansLeft = planState ? planState.allowance.cap - planState.allowance.used : null;

  return (
    <AppShell
      title={done ? "Your video is ready" : "Making your video"}
      subtitle={
        done
          ? title
          : "The AI is editing your footage. This takes a few minutes; you can close this page and it carries on."
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
                  <div className="caps-label text-[11px] text-muted-foreground">
                    Change the look
                  </div>
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
                  {look &&
                    METAPHOR_LOOKS.has(look) &&
                    !planState.plan.elements.some((e) => e.type === "metaphor") && (
                      <p className="text-[11px] text-amber-200/90">
                        This look's drawn or 3D metaphor scenes are planned with the graphics: press
                        Redo the graphics below to add them.
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

        {runNotes.length > 0 && (
          <ul className="text-xs text-amber-200/90 space-y-1" data-run-notes>
            {runNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 space-y-3">
            <div>{error}</div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void tryAgain()} disabled={busy}>
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
          state === "active" && "text-foreground/70 animate-spin",
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
