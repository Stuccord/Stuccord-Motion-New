-- Teams, stage B: team projects and their files.
--
-- A project with team_id belongs to that team: every member can open it,
-- owners, admins and editors can change it, and viewers can only watch and
-- download. It can be deleted by the team's owner and admins, and by whoever
-- made it. Personal projects (team_id null) work as before.
--
-- A team's files live under teams/<team id>/ in the raw-clips and renders
-- buckets, so the work stays with the team when someone leaves.
--
-- Projects move between a person and a team only through the app's server,
-- which moves the files too (see moveProject in src/lib/projects.functions.ts).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_projects_team ON public.projects (team_id, created_at DESC)
  WHERE team_id IS NOT NULL;

-- Only the server may move a project or change who made it.
CREATE OR REPLACE FUNCTION public.projects_guard_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Projects are moved through the app';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS projects_guard_owner ON public.projects;
CREATE TRIGGER projects_guard_owner BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_guard_owner();

-- What the signed-in user can do with a project: 'edit', 'view' or null.
CREATE OR REPLACE FUNCTION public.project_access(p UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- (Roles are tested with IS NULL first: "CASE role WHEN NULL" never matches.)
  SELECT CASE
    WHEN pr.team_id IS NULL THEN CASE WHEN pr.user_id = auth.uid() THEN 'edit' END
    WHEN r.role IS NULL THEN NULL
    WHEN r.role = 'viewer' THEN 'view'
    ELSE 'edit'
  END
  FROM public.projects pr
  CROSS JOIN LATERAL (SELECT public.team_role(pr.team_id) AS role) r
  WHERE pr.id = p;
$$;

REVOKE ALL ON FUNCTION public.project_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_access(UUID) TO authenticated;

-- What the signed-in user can do with a stored file, from its folder:
-- their own folder, or teams/<team id>/ for a team they're in.
CREATE OR REPLACE FUNCTION public.folder_access(path TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN split_part(path, '/', 1) = auth.uid()::text THEN 'edit'
    WHEN t.role IS NULL THEN NULL
    WHEN t.role = 'viewer' THEN 'view'
    ELSE 'edit'
  END
  FROM (
    SELECT CASE
      WHEN split_part(path, '/', 1) = 'teams'
           AND split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.team_role(split_part(path, '/', 2)::uuid)
    END AS role
  ) t;
$$;

REVOKE ALL ON FUNCTION public.folder_access(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.folder_access(TEXT) TO authenticated;

-- ---------- projects ----------
DROP POLICY IF EXISTS "own projects all" ON public.projects;
DROP POLICY IF EXISTS "Projects: read" ON public.projects;
DROP POLICY IF EXISTS "Projects: make" ON public.projects;
DROP POLICY IF EXISTS "Projects: change" ON public.projects;
DROP POLICY IF EXISTS "Projects: delete" ON public.projects;

CREATE POLICY "Projects: read" ON public.projects FOR SELECT TO authenticated
  USING (
    (team_id IS NULL AND user_id = auth.uid())
    OR (team_id IS NOT NULL AND public.team_role(team_id) IS NOT NULL)
  );

CREATE POLICY "Projects: make" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (team_id IS NULL OR public.team_role(team_id) IN ('owner', 'admin', 'editor'))
  );

CREATE POLICY "Projects: change" ON public.projects FOR UPDATE TO authenticated
  USING (
    (team_id IS NULL AND user_id = auth.uid())
    OR (team_id IS NOT NULL AND public.team_role(team_id) IN ('owner', 'admin', 'editor'))
  )
  WITH CHECK (
    (team_id IS NULL AND user_id = auth.uid())
    OR (team_id IS NOT NULL AND public.team_role(team_id) IN ('owner', 'admin', 'editor'))
  );

CREATE POLICY "Projects: delete" ON public.projects FOR DELETE TO authenticated
  USING (
    (team_id IS NULL AND user_id = auth.uid())
    OR (team_id IS NOT NULL AND (
      public.team_role(team_id) IN ('owner', 'admin')
      OR (user_id = auth.uid() AND public.team_role(team_id) = 'editor')
    ))
  );

-- ---------- clips ----------
DROP POLICY IF EXISTS "own clips all" ON public.clips;
DROP POLICY IF EXISTS "Clips: read" ON public.clips;
DROP POLICY IF EXISTS "Clips: make" ON public.clips;
DROP POLICY IF EXISTS "Clips: change" ON public.clips;
DROP POLICY IF EXISTS "Clips: delete" ON public.clips;

CREATE POLICY "Clips: read" ON public.clips FOR SELECT TO authenticated
  USING (public.project_access(project_id) IS NOT NULL);
CREATE POLICY "Clips: make" ON public.clips FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.project_access(project_id) = 'edit');
CREATE POLICY "Clips: change" ON public.clips FOR UPDATE TO authenticated
  USING (public.project_access(project_id) = 'edit')
  WITH CHECK (public.project_access(project_id) = 'edit');
CREATE POLICY "Clips: delete" ON public.clips FOR DELETE TO authenticated
  USING (public.project_access(project_id) = 'edit');

-- ---------- render jobs (exports) ----------
DROP POLICY IF EXISTS "own jobs read" ON public.render_jobs;
DROP POLICY IF EXISTS "own jobs insert" ON public.render_jobs;
DROP POLICY IF EXISTS "Exports: read" ON public.render_jobs;
DROP POLICY IF EXISTS "Exports: make" ON public.render_jobs;

CREATE POLICY "Exports: read" ON public.render_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.project_access(project_id) IS NOT NULL);
CREATE POLICY "Exports: make" ON public.render_jobs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.project_access(project_id) = 'edit');

-- ---------- transcripts (captions), per stored file ----------
DROP POLICY IF EXISTS "own transcripts read" ON public.transcripts;
DROP POLICY IF EXISTS "own transcripts update" ON public.transcripts;
DROP POLICY IF EXISTS "own transcripts delete" ON public.transcripts;
DROP POLICY IF EXISTS "Transcripts: read" ON public.transcripts;
DROP POLICY IF EXISTS "Transcripts: change" ON public.transcripts;
DROP POLICY IF EXISTS "Transcripts: delete" ON public.transcripts;

CREATE POLICY "Transcripts: read" ON public.transcripts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.folder_access(storage_path) IS NOT NULL);
CREATE POLICY "Transcripts: change" ON public.transcripts FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.folder_access(storage_path) = 'edit')
  WITH CHECK (user_id = auth.uid() OR public.folder_access(storage_path) = 'edit');
CREATE POLICY "Transcripts: delete" ON public.transcripts FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.folder_access(storage_path) = 'edit');

-- ---------- storage: team folders (own-folder rules stay as they are) ----------
DROP POLICY IF EXISTS "raw team read" ON storage.objects;
DROP POLICY IF EXISTS "raw team write" ON storage.objects;
DROP POLICY IF EXISTS "raw team update" ON storage.objects;
DROP POLICY IF EXISTS "raw team delete" ON storage.objects;
DROP POLICY IF EXISTS "render team read" ON storage.objects;
DROP POLICY IF EXISTS "render team write" ON storage.objects;
DROP POLICY IF EXISTS "render team update" ON storage.objects;
DROP POLICY IF EXISTS "render team delete" ON storage.objects;

CREATE POLICY "raw team read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'raw-clips' AND (storage.foldername(name))[1] = 'teams'
         AND public.folder_access(name) IS NOT NULL);
CREATE POLICY "raw team write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'raw-clips' AND (storage.foldername(name))[1] = 'teams'
              AND public.folder_access(name) = 'edit');
CREATE POLICY "raw team update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'raw-clips' AND (storage.foldername(name))[1] = 'teams'
         AND public.folder_access(name) = 'edit');
CREATE POLICY "raw team delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'raw-clips' AND (storage.foldername(name))[1] = 'teams'
         AND public.folder_access(name) = 'edit');

CREATE POLICY "render team read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'renders' AND (storage.foldername(name))[1] = 'teams'
         AND public.folder_access(name) IS NOT NULL);
CREATE POLICY "render team write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'renders' AND (storage.foldername(name))[1] = 'teams'
              AND public.folder_access(name) = 'edit');
CREATE POLICY "render team update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'renders' AND (storage.foldername(name))[1] = 'teams'
         AND public.folder_access(name) = 'edit');
CREATE POLICY "render team delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'renders' AND (storage.foldername(name))[1] = 'teams'
         AND public.folder_access(name) = 'edit');
