// The automatic edit's progress, as kept on the project (projects.auto_edit)
// while the server runs it (src/lib/auto-edit-run.server.ts) and read by the
// make page. Safe to import in the browser.

export type AutoStepId =
  "transcribe" | "cut" | "plan" | "pictures" | "animate" | "music" | "render";
export type AutoStepState = "waiting" | "active" | "done" | "skipped" | "failed";
export type AutoStep = { state: AutoStepState; note?: string };

/** One story picture being brought to life (the animate step). */
export type AutoClip = {
  elementId: string;
  index: number;
  imagePath: string;
  prompt: string;
  request_id: string | null;
  ticket: string | null;
  /** When this attempt stops waiting (ms since 1970). */
  until: number;
  attempt: number;
  state: "running" | "done" | "failed";
  error?: string;
};

export type AutoEdit = {
  /** This run's id: a newer run replaces it, and the older one stops. */
  run: string;
  /** Who started it: their allowances are used (a team project's are the team's). */
  started_by: string;
  started_at: string;
  /** Set on every step the server takes: a run that's gone quiet has stopped. */
  updated_at: string;
  status: "running" | "done" | "failed";
  /** "Redo the graphics": plan again even though there's a plan. */
  redo?: boolean;
  error?: string | null;
  steps: Partial<Record<AutoStepId, AutoStep>>;
  /** Things that didn't stop the video but are worth saying (B-roll that didn't fit). */
  notes?: string[];
  clips?: AutoClip[];
  /** The export this run started (the render step). */
  render_job?: string | null;
  /** How many times the render waited for a busy worker. */
  render_tries?: number;
  /** How many exports the worker lost in a restart (one is made again by itself). */
  render_lost?: number;
};

export const AUTO_STEP_IDS: AutoStepId[] = [
  "transcribe",
  "cut",
  "plan",
  "pictures",
  "animate",
  "music",
  "render",
];

/**
 * A run whose server hasn't reported for this long has stopped (the worker
 * or the app restarted): the page starts it again, and it carries on from
 * where it was. Longer than any one step takes (planning, the pictures).
 */
export const AUTO_EDIT_STALE_MS = 6 * 60 * 1000;

/** The stored progress, or null when there's none (or it isn't readable). */
export function parseAutoEdit(raw: unknown): AutoEdit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Partial<AutoEdit>;
  if (typeof a.run !== "string" || typeof a.started_by !== "string") return null;
  if (a.status !== "running" && a.status !== "done" && a.status !== "failed") return null;
  return {
    ...a,
    steps: a.steps && typeof a.steps === "object" ? a.steps : {},
    updated_at: typeof a.updated_at === "string" ? a.updated_at : (a.started_at ?? ""),
  } as AutoEdit;
}

/** Running, and the server reported recently. */
export function isAutoEditLive(a: AutoEdit | null, now = Date.now()): boolean {
  if (!a || a.status !== "running") return false;
  const t = Date.parse(a.updated_at);
  return Number.isFinite(t) && now - t < AUTO_EDIT_STALE_MS;
}
