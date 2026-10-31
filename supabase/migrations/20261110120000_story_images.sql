-- Motion Explainer, stage 7: story scenes' pictures.
--
-- Story graphics show one picture per scene, made by an AI image model
-- (Google Gemini) or uploaded by the user. They're kept in the private
-- motion-images bucket under <project owner id>/<project id>/...; only the
-- server reads and writes it (it checks the person's access to the project,
-- then hands out short-lived links), so the bucket has no policies for
-- signed-in users.
--
-- motion_image_runs records each AI picture made, to count the monthly
-- allowance (per person, and per team for team projects). Only the server
-- writes it.
--
-- Additive and safe to run more than once.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('motion-images', 'motion-images', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.motion_image_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The team whose allowance it used; null for the person's own.
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_motion_image_runs_user ON public.motion_image_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_motion_image_runs_team ON public.motion_image_runs (team_id, created_at DESC);

GRANT SELECT ON public.motion_image_runs TO authenticated;
GRANT ALL ON public.motion_image_runs TO service_role;
ALTER TABLE public.motion_image_runs ENABLE ROW LEVEL SECURITY;

-- People see their own runs, and a team's runs if they're in the team.
DROP POLICY IF EXISTS "Image runs: read" ON public.motion_image_runs;
CREATE POLICY "Image runs: read" ON public.motion_image_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (team_id IS NOT NULL AND public.team_role(team_id) IS NOT NULL));

-- With two-factor on, this needs the second step too.
DO $$
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'motion_image_runs' AND policyname = 'mfa required'
  ) THEN
    CREATE POLICY "mfa required" ON public.motion_image_runs AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied());
  END IF;
END $$;
