-- Motion Explainer, stage 1: the AI's graphics plan for a project.
--
-- projects.motion_plan holds the plan (see src/lib/motion-plan.ts): the
-- graphics to show, each anchored to the transcript words that trigger it,
-- so trims and reorders move the graphics with the words.
-- projects.motion_plan_previous keeps the plan it replaced, once, for Undo.
-- projects.transcribe_status / transcribe_error / transcribe_started_at track
-- a "Transcribe" run that happens before export (the worker reports back
-- through /api/public/transcribe-webhook).
--
-- motion_plan_runs records each AI plan made, to count the monthly
-- allowance (per person, and per team for team projects). Only the server
-- writes it.
--
-- Additive and safe to run more than once.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS motion_plan JSONB,
  ADD COLUMN IF NOT EXISTS motion_plan_previous JSONB,
  ADD COLUMN IF NOT EXISTS transcribe_status TEXT,
  ADD COLUMN IF NOT EXISTS transcribe_error TEXT,
  ADD COLUMN IF NOT EXISTS transcribe_started_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_motion_plan_is_object') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_motion_plan_is_object
      CHECK (motion_plan IS NULL OR jsonb_typeof(motion_plan) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_motion_plan_previous_is_object') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_motion_plan_previous_is_object
      CHECK (motion_plan_previous IS NULL OR jsonb_typeof(motion_plan_previous) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_transcribe_status_known') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_transcribe_status_known
      CHECK (transcribe_status IS NULL OR transcribe_status IN ('running', 'done', 'failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.motion_plan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The team whose allowance it used; null for the person's own.
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_motion_plan_runs_user ON public.motion_plan_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_motion_plan_runs_team ON public.motion_plan_runs (team_id, created_at DESC);

GRANT SELECT ON public.motion_plan_runs TO authenticated;
GRANT ALL ON public.motion_plan_runs TO service_role;
ALTER TABLE public.motion_plan_runs ENABLE ROW LEVEL SECURITY;

-- People see their own runs, and a team's runs if they're in the team.
DROP POLICY IF EXISTS "Plan runs: read" ON public.motion_plan_runs;
CREATE POLICY "Plan runs: read" ON public.motion_plan_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (team_id IS NOT NULL AND public.team_role(team_id) IS NOT NULL));

-- With two-factor on, this needs the second step too.
DO $$
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'motion_plan_runs' AND policyname = 'mfa required'
  ) THEN
    CREATE POLICY "mfa required" ON public.motion_plan_runs AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied());
  END IF;
END $$;
