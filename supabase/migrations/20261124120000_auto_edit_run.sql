-- The automatic edit runs on the server (src/lib/auto-edit-run.server.ts):
-- the render worker drives it and the app does each step, so it carries on
-- after the browser tab is closed. Its progress is kept on the project, in
-- auto_edit: { run, started_by, status, updated_at, error, steps: {...}, ... }.
-- People can read it with the project; only the server writes it.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS auto_edit jsonb;

-- Two parts of a run (the main steps and the music) report at the same time:
-- this merges one part's news into the stored progress in one statement, so
-- neither overwrites the other, and only for the run that's current (an older
-- run that's still going finds it isn't, and stops). True when it was saved.
CREATE OR REPLACE FUNCTION public.auto_edit_patch(
  p_project uuid,
  p_run text,
  p_top jsonb,
  p_steps jsonb
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH done AS (
    UPDATE public.projects
    SET auto_edit = (coalesce(auto_edit, '{}'::jsonb) || coalesce(p_top, '{}'::jsonb))
      || jsonb_build_object(
        'steps',
        coalesce(auto_edit -> 'steps', '{}'::jsonb) || coalesce(p_steps, '{}'::jsonb),
        'updated_at',
        to_jsonb(now())
      )
    WHERE id = p_project AND auto_edit ->> 'run' = p_run
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM done);
$$;

REVOKE ALL ON FUNCTION public.auto_edit_patch(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_edit_patch(uuid, text, jsonb, jsonb) TO service_role;
