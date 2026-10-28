-- Teams, stage C: a team brand kit, and a team export allowance.
--
-- teams.brand_kit: the team's caption, hook and logo style (the same shape as
-- a person's brand_kit in their user metadata); team projects always use it.
-- Members can read it; the team's owner and admins change it through the
-- app's server. Its logo is stored under teams/<team id>/brand/.
--
-- render_jobs.team_id: the team whose allowance an export counts against,
-- stamped when the export starts (null: the person's own allowance). It
-- stays put if the project later moves, so a month's count doesn't change.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS brand_kit JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.render_jobs
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_render_jobs_team_month ON public.render_jobs (team_id, created_at)
  WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_render_jobs_user_month ON public.render_jobs (user_id, created_at);

-- An export is stamped with its project's team (so it can't be counted
-- against the wrong allowance).
DROP POLICY IF EXISTS "Exports: make" ON public.render_jobs;
CREATE POLICY "Exports: make" ON public.render_jobs FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.project_access(project_id) = 'edit'
    AND team_id IS NOT DISTINCT FROM (SELECT p.team_id FROM public.projects p WHERE p.id = project_id)
  );
