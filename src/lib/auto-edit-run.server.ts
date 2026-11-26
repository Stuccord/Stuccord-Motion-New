// The automatic edit, run on the server (docs/auto-edit-plan.md, "On the
// server"), so it carries on when the browser tab is closed or the
// connection drops. The render worker drives it (/auto-edit in
// render-worker/server.js): it calls /api/public/auto-edit-step again and
// again for two parts at the same time, the main steps and the music, until
// each says it's done. Every call does the next piece of work and says how
// long to wait before the next one. The progress is kept on the project
// (projects.auto_edit, src/lib/auto-edit-state.ts), so a run that stopped
// (the worker or the app restarted) carries on where it was when it's
// started again; the make page shows it.
//
// The steps and what they keep are the ones the make page ran before:
// transcribe (worker) → cut the pauses → plan the graphics (Claude) → the
// first story pictures (Higgsfield) → bring them to life (Higgsfield clips),
// with the music (ElevenLabs) made alongside → place the B-roll → render.
// The person who started the run is the one whose allowances are used.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { isImageFilename } from "@/lib/media-kind";
import { parseMotionPlan, withSpeakerLook, type MotionPlan } from "@/lib/motion-plan";
import {
  AUTO_PICTURES,
  clipJobs,
  finishAutoPlan,
  needsAutoPictures,
  pictureJobs,
  prepareAutoPlan,
  withClip,
  withPicture,
} from "@/lib/auto-edit";
import {
  parseAutoEdit,
  type AutoClip,
  type AutoEdit,
  type AutoStep,
  type AutoStepId,
} from "@/lib/auto-edit-state";
import {
  cutPausesFor,
  hmacHex,
  placeBrollFor,
  planGraphicsFor,
  projectWords,
  savePlanFor,
  transcribeFor,
  workerEndpoint,
} from "@/lib/motion-plan.functions";
import { makeSceneImageFor } from "@/lib/story-images.functions";
import { checkClipFor, startClipFor } from "@/lib/story-clips.functions";
import { makeAiMusicFor } from "@/lib/music.functions";
import { describeSpeakerFor } from "@/lib/speaker-look.functions";
import { startCloudRender } from "@/lib/projects.functions";
import { workerSecret } from "@/lib/worker-secret";
import { friendlyText } from "@/lib/service-problems";
import { failLostRender, isRenderLost, RENDER_LOST_TEXT } from "@/lib/render-lost.server";
import { motionAccent } from "@/motion/theme";

type Db = SupabaseClient<Database>;
type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type AutoLane = "main" | "music";
/** What the worker does next: call again after `wait_ms`, or stop (this part is over). */
export type TickResult = { wait_ms: number } | { done: true };

/** Longest one clip attempt is waited for before the picture stays still. */
const CLIP_WAIT_MS = 12 * 60 * 1000;
/** A transcribe run that hasn't reported back in this long has stopped. */
const TRANSCRIBE_STALE_MS = 20 * 60 * 1000;
/** How many times a render is tried while the worker is busy with another export (every 20 s). */
const RENDER_BUSY_TRIES = 30;
const RUNNING_JOB = ["queued", "transcribing", "planning", "rendering"];
const MAIN_TYPES = new Set(["auto", "aroll"]);

const DONE: TickResult = { done: true };
const next = (ms = 0): TickResult => ({ wait_ms: ms });
/** An error's words for the customer (a friendly line for problems on the app's side), or the fallback. */
/** What the cut took out, in words: "pauses, 3 fillers, 1 retake". */
function cutWhat(fillers = 0, takes = 0): string {
  const parts = ["pauses"];
  if (fillers) parts.push(`${fillers} filler${fillers === 1 ? "" : "s"}`);
  if (takes) parts.push(`${takes} retake${takes === 1 ? "" : "s"}`);
  return parts.join(", ");
}

const message = (e: unknown, fallback: string) =>
  friendlyText((e instanceof Error && e.message.trim()) || fallback);
const settled = (s: AutoStep | undefined) => s?.state === "done" || s?.state === "skipped";

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Merges news into the stored progress (only if this run is still the
 * current one) and marks the run as alive. False when it isn't current.
 */
async function patch(
  db: Db,
  projectId: string,
  run: string,
  top: Partial<AutoEdit>,
  steps: Partial<Record<AutoStepId, AutoStep>> = {},
): Promise<boolean> {
  const { data, error } = await db.rpc("auto_edit_patch", {
    p_project: projectId,
    p_run: run,
    p_top: top as unknown as Json,
    p_steps: steps as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/** One step of the run: does the next piece of work for `lane` and says what to do next. */
export async function autoEditTick(
  projectId: string,
  run: string,
  lane: AutoLane,
): Promise<TickResult> {
  const db = await admin();
  // Still the current run? (Also tells the page it's alive.)
  if (!(await patch(db, projectId, run, {}))) return DONE;
  const { data: project, error } = await db
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const a = parseAutoEdit(project?.auto_edit);
  if (!project || !a || a.run !== run || a.status !== "running") return DONE;
  const ctx = new Run(db, project, a);
  return lane === "music" ? ctx.musicLane() : ctx.mainLane();
}

class Run {
  private readonly userId: string;
  private readonly id: string;

  constructor(
    private readonly db: Db,
    private readonly project: ProjectRow,
    private readonly a: AutoEdit,
  ) {
    this.userId = a.started_by;
    this.id = project.id;
  }

  private step(id: AutoStepId) {
    return this.a.steps[id];
  }

  private async mark(id: AutoStepId, state: AutoStep["state"], note?: string) {
    const s: AutoStep = note === undefined ? { state } : { state, note };
    this.a.steps[id] = s;
    await patch(this.db, this.id, this.a.run, {}, { [id]: s });
  }

  private async fail(id: AutoStepId, error: string): Promise<TickResult> {
    const failed: AutoStep = { state: "failed", note: this.step(id)?.note };
    this.a.steps[id] = failed;
    await patch(this.db, this.id, this.a.run, { status: "failed", error }, { [id]: failed });
    return DONE;
  }

  private plan(): MotionPlan | null {
    return parseMotionPlan(this.project.motion_plan);
  }

  private async freshPlan(): Promise<MotionPlan | null> {
    const { data, error } = await this.db
      .from("projects")
      .select("motion_plan")
      .eq("id", this.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return parseMotionPlan(data?.motion_plan);
  }

  private save(plan: MotionPlan) {
    return savePlanFor(this.db, this.userId, { project_id: this.id, plan });
  }

  // ---------- the main steps ----------

  async mainLane(): Promise<TickResult> {
    if (!settled(this.step("transcribe"))) return this.transcribe();
    if (!settled(this.step("cut"))) return this.cut();
    if (!settled(this.step("plan"))) return this.planGraphics();
    if (!settled(this.step("pictures"))) return this.pictures();
    if (!settled(this.step("animate"))) return this.animate();
    // The music is made alongside (the other part); the render waits for it.
    if (!settled(this.step("music"))) return next(3000);
    return this.render();
  }

  /** 1. The worker transcribes; this waits until every main clip has words. */
  private async transcribe(): Promise<TickResult> {
    const { missing } = await projectWords(this.db, this.project, this.userId);
    if (!missing.length) {
      await this.mark("transcribe", "done");
      return next();
    }
    const started = Date.parse(this.project.transcribe_started_at ?? "");
    const running =
      this.project.transcribe_status === "running" && Date.now() - started < TRANSCRIBE_STALE_MS;
    if (running) {
      if (this.step("transcribe")?.state !== "active") await this.mark("transcribe", "active");
      return next(4000);
    }
    // It ended without words for every clip after this run started it.
    if (
      this.step("transcribe")?.state === "active" &&
      this.project.transcribe_status === "failed"
    ) {
      return this.fail("transcribe", this.project.transcribe_error || "Transcribing failed.");
    }
    try {
      await transcribeFor(this.db, this.userId, { project_id: this.id });
    } catch (e) {
      const text = message(e, "Couldn't start transcribing.");
      // The worker is busy with an export: try again shortly.
      if (/busy/i.test(text)) {
        await this.mark("transcribe", "active", "Waiting for the worker…");
        return next(15_000);
      }
      return this.fail("transcribe", text);
    }
    await this.mark("transcribe", "active");
    return next(4000);
  }

  /** 2. Cut the pauses (before planning: the plan is anchored to the cut clips). */
  private async cut(): Promise<TickResult> {
    if (this.plan()) {
      await this.mark("cut", "done");
      return next();
    }
    await this.mark("cut", "active");
    try {
      const c = await cutPausesFor(this.db, this.userId, { project_id: this.id });
      await this.mark(
        "cut",
        c.cutMs > 0 ? "done" : "skipped",
        c.cutMs > 0
          ? `${(c.cutMs / 1000).toFixed(1)} s cut (${cutWhat(c.fillers, c.takes)}). Change it in the editor (Auto-cut).`
          : "No long pauses, fillers or retakes to cut.",
      );
    } catch (e) {
      await this.mark(
        "cut",
        "skipped",
        `${message(e, "Couldn't cut the pauses.")} The pauses stay in.`,
      );
    }
    return next();
  }

  /** 3. Plan the graphics (Claude), unless there's a plan already; captions only when it can't. */
  private async planGraphics(): Promise<TickResult> {
    const existing = this.plan();
    if (existing && !this.a.redo) {
      await this.mark("plan", "done", `${existing.elements.length} graphics planned.`);
      return next();
    }
    await this.mark("plan", "active");
    try {
      const r = await planGraphicsFor(this.db, this.userId, { project_id: this.id });
      const n = r.plan.elements.length;
      const pics = r.pictures;
      const picNote = !pics.of
        ? ""
        : pics.placed === pics.of
          ? ` Your ${pics.of === 1 ? "picture is" : `${pics.of} pictures are`} in.`
          : pics.placed === 0
            ? ` Nothing said matched your ${pics.of === 1 ? "picture" : `${pics.of} pictures`}, so ${pics.of === 1 ? "it isn't" : "they aren't"} in (add ${pics.of === 1 ? "it" : "them"} in the editor).`
            : ` ${pics.placed} of your ${pics.of} pictures are in; nothing said matched the rest (add them in the editor).`;
      this.a.steps.plan = {
        state: "done",
        note: `${n} graphic${n === 1 ? "" : "s"} planned.${picNote}`,
      };
      // Planned: a restart of this run doesn't plan again.
      await patch(this.db, this.id, this.a.run, { redo: false }, { plan: this.a.steps.plan });
    } catch (e) {
      await this.mark(
        "plan",
        "skipped",
        `${message(e, "Planning failed.")} The video is made with captions only.`,
      );
    }
    return next();
  }

  /** 4. The first story pictures (Higgsfield), saved on the plan as the automatic edit keeps it. */
  private async pictures(): Promise<TickResult> {
    const start = this.plan();
    if (!start) {
      await this.mark("pictures", "skipped", "No graphics to make pictures for.");
      return next();
    }
    if (!needsAutoPictures(start)) {
      const made = start.elements.some(
        (e) => (e.type === "story" || e.type === "metaphor") && e.scenes?.some((sc) => sc.image),
      );
      if (made) await this.mark("pictures", "done", "Already made.");
      else await this.mark("pictures", "skipped", "No pictures needed in this video.");
      return next();
    }
    await this.mark("pictures", "active");
    let plan = prepareAutoPlan(start);
    const jobs = pictureJobs(plan);
    const accent = motionAccent(plan.colour, null).hex;
    // So a person in the story looks like the speaker (once per video).
    if (jobs.some((j) => j.style === "cinematic") && plan.speaker_look === undefined) {
      const look = await this.readSpeakerLook();
      if (look) plan = { ...plan, speaker_look: look };
    }
    let made = 0;
    let problem = null as string | null;
    // Two waves at the same time: every picture that needs no reference,
    // then a story's later scenes matched to its first scene's picture.
    const makeOne = async (job: (typeof jobs)[number]) => {
      const story = plan.elements.find((e) => e.id === job.elementId);
      const reference =
        job.matchIndex !== null ? (story?.scenes?.[job.matchIndex]?.image?.path ?? null) : null;
      try {
        const r = await makeSceneImageFor(this.db, this.userId, {
          project_id: this.id,
          prompt:
            job.style === "cinematic" && job.speaker
              ? withSpeakerLook(job.prompt, plan.speaker_look)
              : job.prompt,
          reference_path: reference,
          accent,
          style: job.style,
          with_speaker: false,
          look: plan.look ?? null,
        });
        plan = withPicture(plan, job.elementId, job.index, r.path);
        made++;
      } catch (e) {
        problem ??= message(e, "Couldn't make a picture.");
      }
    };
    await Promise.all(jobs.filter((j) => j.matchIndex === null).map(makeOne));
    if (!problem) await Promise.all(jobs.filter((j) => j.matchIndex !== null).map(makeOne));
    await this.save(finishAutoPlan(plan));
    if (problem) {
      await this.mark(
        "pictures",
        made ? "done" : "skipped",
        `${problem} The video is made without them.`,
      );
    } else {
      await this.mark(
        "pictures",
        jobs.length ? "done" : "skipped",
        jobs.length
          ? `${made} made (up to ${AUTO_PICTURES} a video).`
          : "No pictures needed in this video.",
      );
    }
    return next();
  }

  /**
   * What the speaker looks like, read by Claude from one frame of the main
   * footage (the worker grabs it), so story pictures show someone like them.
   * Null when it can't be read.
   */
  private async readSpeakerLook(): Promise<string | null> {
    try {
      const { data: clips } = await this.db
        .from("clips")
        .select("role, storage_path, filename, trim_in_ms, duration_ms, ordinal")
        .eq("project_id", this.id)
        .order("ordinal", { ascending: true });
      const main = (clips ?? []).find(
        (c) => MAIN_TYPES.has(c.role) && !isImageFilename(c.filename ?? ""),
      );
      if (!main) return null;
      const { data: s } = await this.db.storage
        .from("raw-clips")
        .createSignedUrl(main.storage_path, 60 * 15);
      if (!s?.signedUrl) return null;
      // A moment in, where the speaker is settled and talking.
      const at = (main.trim_in_ms ?? 0) + Math.min(1500, (main.duration_ms ?? 3000) / 2);
      const frame = await grabFrameOnWorker(s.signedUrl, at, 768);
      if (!frame) return null;
      const { look } = await describeSpeakerFor(this.db, this.userId, {
        project_id: this.id,
        frame,
      });
      return look;
    } catch (e) {
      console.warn("[auto-edit] Couldn't read the speaker's look:", message(e, "unknown"));
      return null;
    }
  }

  /**
   * 5. The story pictures brought to life: each becomes a 5-second clip
   * (Higgsfield), all at the same time; each call checks them once. A clip
   * Higgsfield fails on its side is started once more; one that still can't
   * be made, or takes too long, leaves its picture still.
   */
  private async animate(): Promise<TickResult> {
    let clips = this.a.clips;
    if (!clips) {
      const plan = this.plan();
      const jobs = plan ? clipJobs(plan) : [];
      if (!jobs.length) {
        const any = plan?.elements.some((e) => e.scenes?.some((sc) => sc.image?.clip));
        await this.mark(
          "animate",
          any ? "done" : "skipped",
          any ? "Already done." : "No pictures to animate.",
        );
        return next();
      }
      clips = await Promise.all(
        jobs.map(async (job): Promise<AutoClip> => {
          const c: AutoClip = {
            ...job,
            request_id: null,
            ticket: null,
            until: 0,
            attempt: 0,
            state: "running",
          };
          return this.startClip(c);
        }),
      );
      this.a.clips = clips;
      await patch(
        this.db,
        this.id,
        this.a.run,
        { clips },
        {
          animate: {
            state: "active",
            note: `Animating ${clips.length} picture${clips.length === 1 ? "" : "s"}…`,
          },
        },
      );
      return next(6000);
    }

    // Check the ones still being made.
    let changed = false;
    for (const c of clips) {
      if (c.state !== "running") continue;
      if (Date.now() > c.until) {
        Object.assign(c, {
          state: "failed",
          error: "The clip took too long, so this picture stays still.",
        });
        changed = true;
        continue;
      }
      let r;
      try {
        r = await checkClipFor(this.db, this.userId, {
          project_id: this.id,
          request_id: c.request_id ?? "",
          image_path: c.imagePath,
          ticket: c.ticket ?? "",
        });
      } catch (e) {
        // A dropped connection: check again next time.
        if (/fetch|network|timed? ?out/i.test(message(e, ""))) continue;
        Object.assign(c, { state: "failed", error: message(e, "Couldn't animate a picture.") });
        changed = true;
        continue;
      }
      if (r.state === "running") continue;
      changed = true;
      if (r.state === "failed") {
        if (r.retry && c.attempt < 2) await this.startClip(c);
        else {
          Object.assign(c, {
            state: "failed",
            error: c.attempt > 1 ? `${r.error} It was tried twice.` : r.error,
          });
        }
        continue;
      }
      const plan = await this.freshPlan();
      if (plan) await this.save(withClip(plan, c.elementId, c.index, c.imagePath, r.path));
      c.state = "done";
    }
    if (changed) await patch(this.db, this.id, this.a.run, { clips });
    if (clips.some((c) => c.state === "running")) return next(6000);

    const made = clips.filter((c) => c.state === "done").length;
    const problem = clips.find((c) => c.state === "failed")?.error;
    if (problem) {
      await this.mark(
        "animate",
        made ? "done" : "skipped",
        made
          ? `${made} of ${clips.length} animated. ${problem}`
          : `${problem} The pictures stay still.`,
      );
    } else {
      await this.mark(
        "animate",
        "done",
        `${made} picture${made === 1 ? "" : "s"} brought to life.`,
      );
    }
    return next();
  }

  /** Starts (or starts again) one clip; a refusal leaves its picture still. */
  private async startClip(c: AutoClip): Promise<AutoClip> {
    c.attempt += 1;
    try {
      const started = await startClipFor(this.db, this.userId, {
        project_id: this.id,
        image_path: c.imagePath,
        prompt: c.prompt,
      });
      Object.assign(c, {
        request_id: started.request_id,
        ticket: started.ticket,
        until: Date.now() + CLIP_WAIT_MS,
        state: "running",
      });
    } catch (e) {
      Object.assign(c, { state: "failed", error: message(e, "Couldn't animate a picture.") });
    }
    return c;
  }

  /** 6. Place the B-roll (off the full-screen graphics), then render and wait for it. */
  private async render(): Promise<TickResult> {
    let jobId = this.a.render_job ?? null;
    if (!jobId) {
      const notes = [...(this.a.notes ?? [])];
      if (this.step("render")?.state !== "active") {
        try {
          const b = await placeBrollFor(this.db, this.userId, { project_id: this.id });
          if (b.of > b.placed) {
            notes.push(`${b.of - b.placed} B-roll clip(s) didn't fit; place them in the editor.`);
          }
        } catch (e) {
          notes.push(`${message(e, "Couldn't place the B-roll.")} It plays from the start.`);
        }
      }
      const { data: latest } = await this.db
        .from("render_jobs")
        .select("id, status")
        .eq("project_id", this.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (latest?.[0] && RUNNING_JOB.includes(latest[0].status)) {
        jobId = latest[0].id; // One already being made (started before this run).
      } else {
        try {
          const job = await startCloudRender(this.db, this.userId, {
            project_id: this.id,
            captions: this.project.captions_enabled ?? true,
            // A built-in bed even if the graphics couldn't be made (captions only).
            music: {
              enabled: this.project.music_enabled ?? true,
              volume: this.project.music_volume ?? 60,
              bed: true,
            },
          });
          jobId = job.id;
        } catch (e) {
          const text = message(e, "The render couldn't start.");
          const tries = (this.a.render_tries ?? 0) + 1;
          // The worker is busy with another export: wait for it.
          if (/temporarily unavailable|busy/i.test(text) && tries < RENDER_BUSY_TRIES) {
            await patch(
              this.db,
              this.id,
              this.a.run,
              { notes, render_tries: tries },
              {
                render: { state: "active", note: "Waiting for the renderer…" },
              },
            );
            return next(20_000);
          }
          return this.fail("render", text);
        }
      }
      this.a.render_job = jobId;
      await patch(
        this.db,
        this.id,
        this.a.run,
        { notes, render_job: jobId },
        {
          render: { state: "active" },
        },
      );
      return next(4000);
    }

    const { data: job, error } = await this.db
      .from("render_jobs")
      .select("status, error, updated_at")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return this.fail("render", "The render went missing. Try again.");
    // The worker restarted partway (it went quiet): made again once by
    // itself; a second loss needs a person (render-lost.server.ts).
    if (isRenderLost(job) && (await failLostRender(this.db, jobId))) {
      const lost = (this.a.render_lost ?? 0) + 1;
      if (lost > 1) return this.fail("render", RENDER_LOST_TEXT);
      this.a.render_job = null;
      this.a.render_lost = lost;
      await patch(
        this.db,
        this.id,
        this.a.run,
        { render_job: null, render_lost: lost },
        {
          render: {
            state: "active",
            note: "The renderer restarted, so the video is being made again…",
          },
        },
      );
      return next(1000);
    }
    if (job.status === "failed") return this.fail("render", job.error || "The render failed.");
    if (RUNNING_JOB.includes(job.status)) return next(4000);
    await patch(
      this.db,
      this.id,
      this.a.run,
      { status: "done", error: null },
      {
        render: { state: "done" },
      },
    );
    return DONE;
  }

  // ---------- the music, alongside ----------

  /** The music (ElevenLabs, matched to the look and length), once the plan is settled. */
  async musicLane(): Promise<TickResult> {
    if (settled(this.step("music"))) return DONE;
    if (!settled(this.step("plan"))) return next(3000);
    await this.mark("music", "active");
    try {
      const m = await makeAiMusicFor(this.db, this.userId, {
        project_id: this.id,
        look: this.plan()?.look ?? null,
        skip_if_music: true,
      });
      if (m.made) await this.mark("music", "done", "Made for this video.");
      else {
        // Already on the music track: made by an earlier run, or the user's own song.
        const { data: music } = await this.db
          .from("clips")
          .select("filename")
          .eq("project_id", this.id)
          .eq("role", "music");
        const ai = (music ?? []).some((c) => c.filename === "Music (AI).mp3");
        await this.mark(
          "music",
          ai ? "done" : "skipped",
          ai ? "Made for this video." : "Your own music is used.",
        );
      }
    } catch (e) {
      await this.mark(
        "music",
        "skipped",
        `${message(e, "Couldn't make the music.")} The built-in music plays instead.`,
      );
    }
    return DONE;
  }
}

/** One frame of a video (the worker's /frame, ffmpeg) as a JPEG in base64; null when it can't. */
async function grabFrameOnWorker(url: string, atMs: number, width: number): Promise<string | null> {
  const secret = workerSecret();
  if (!secret) return null;
  const body = JSON.stringify({ url, at_ms: Math.max(0, Math.round(atMs)), width });
  const res = await fetch(workerEndpoint("frame").toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stuccord-signature": await hmacHex(secret, body),
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length > 100 ? bytes.toString("base64") : null;
}

// ---------- starting ----------

/**
 * Starts the automatic edit for a project (or starts it again, carrying on
 * where it was), and asks the worker to drive it. `redo`: plan the graphics
 * again even though there's a plan (the make page's "Redo the graphics").
 */
export async function startAutoEditRun(
  userId: string,
  projectId: string,
  opts: { redo?: boolean; stepUrl: string },
): Promise<AutoEdit> {
  const db = await admin();
  const { data: project, error } = await db
    .from("projects")
    .select("auto_edit")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const old = parseAutoEdit(project?.auto_edit);
  const now = new Date().toISOString();
  const run = crypto.randomUUID();
  let state: AutoEdit;
  if (old && old.status !== "done" && !opts.redo) {
    // Carry on: what's done stays done (pictures, clips being made, the
    // export already started); a failed step is tried again.
    const steps = { ...old.steps };
    for (const id of Object.keys(steps) as AutoStepId[]) {
      if (steps[id]?.state === "failed") steps[id] = { state: "waiting" };
    }
    const renderFailed = old.steps.render?.state === "failed";
    state = {
      ...old,
      run,
      started_by: userId,
      updated_at: now,
      status: "running",
      error: null,
      steps,
      render_job: renderFailed ? null : (old.render_job ?? null),
      render_tries: 0,
      render_lost: 0,
    };
  } else {
    state = {
      run,
      started_by: userId,
      started_at: now,
      updated_at: now,
      status: "running",
      redo: opts.redo ?? false,
      error: null,
      steps: {},
      notes: [],
    };
  }
  const { error: uErr } = await db
    .from("projects")
    .update({ auto_edit: state as unknown as Json })
    .eq("id", projectId);
  if (uErr) throw new Error(uErr.message);

  // The worker drives it from here.
  const failStart = async (why: string) => {
    state = { ...state, status: "failed", error: friendlyText(why) };
    await db
      .from("projects")
      .update({ auto_edit: state as unknown as Json })
      .eq("id", projectId);
    return state;
  };
  const secret = workerSecret();
  if (!secret)
    return failStart("The automatic edit isn't set up yet (RENDER_WORKER_SECRET is missing).");
  const body = JSON.stringify({ project_id: projectId, run, step_url: opts.stepUrl });
  let res: Response;
  try {
    res = await fetch(workerEndpoint("auto-edit").toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stuccord-signature": await hmacHex(secret, body),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return failStart("Couldn't reach the render worker. Try again in a moment.");
  }
  if (res.status === 404)
    return failStart("The render worker needs updating before it can make videos by itself.");
  if (res.status === 401) {
    const { WORKER_SECRET_MISMATCH } = await import("@/lib/worker-secret");
    return failStart(WORKER_SECRET_MISMATCH);
  }
  if (res.status !== 202) return failStart(`The render worker refused (HTTP ${res.status}).`);
  return state;
}

/** The app's address for the worker's step calls (/api/public/auto-edit-step). */
export function autoEditStepUrl(): string {
  const raw = (process.env.PUBLIC_APP_URL || process.env.PUBLIC_URL || "").trim();
  if (!raw) throw new Error("PUBLIC_APP_URL is not configured");
  const url = new URL(raw);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/public/auto-edit-step`;
  return url.toString();
}
