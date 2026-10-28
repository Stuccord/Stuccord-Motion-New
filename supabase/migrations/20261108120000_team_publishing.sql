-- Teams, stage D: team social accounts and posting team projects.
--
-- A social account with team_id belongs to that team: its owner and admins
-- connect and disconnect it, everyone in the team can see it, and Editors and
-- up post team projects to it. user_id is whoever connected it. Its tokens
-- are encrypted for the team (see src/lib/publishing/crypto.server.ts), so
-- they stay usable when that person leaves.
--
-- A post with team_id is a team project posted to a team account: everyone
-- in the team sees it; whoever made it, and the team's owner and admins,
-- can move, cancel, retry or remove it. Team projects only go to the team's
-- accounts and personal projects only to the person's own.

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE;

-- One row per account per owner: a person's own, or a team's (the same
-- channel can be connected to both).
ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_user_id_platform_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_personal_unique
  ON public.social_accounts (user_id, platform, external_id) WHERE team_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_team_unique
  ON public.social_accounts (team_id, platform, external_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_team ON public.social_posts (team_id, scheduled_at DESC)
  WHERE team_id IS NOT NULL;

GRANT SELECT (team_id) ON public.social_accounts TO authenticated;

-- ---------- accounts ----------
DROP POLICY IF EXISTS "Users read their own social accounts" ON public.social_accounts;
DROP POLICY IF EXISTS "Users disconnect their own social accounts" ON public.social_accounts;
DROP POLICY IF EXISTS "Accounts: read" ON public.social_accounts;
DROP POLICY IF EXISTS "Accounts: disconnect" ON public.social_accounts;

CREATE POLICY "Accounts: read" ON public.social_accounts FOR SELECT TO authenticated
  USING (
    (team_id IS NULL AND user_id = auth.uid())
    OR (team_id IS NOT NULL AND public.team_role(team_id) IS NOT NULL)
  );
CREATE POLICY "Accounts: disconnect" ON public.social_accounts FOR DELETE TO authenticated
  USING (
    (team_id IS NULL AND user_id = auth.uid())
    OR (team_id IS NOT NULL AND public.team_role(team_id) IN ('owner', 'admin'))
  );

-- ---------- posts ----------
DROP POLICY IF EXISTS "Users read their own posts" ON public.social_posts;
DROP POLICY IF EXISTS "Users make their own posts" ON public.social_posts;
DROP POLICY IF EXISTS "Users change their own posts" ON public.social_posts;
DROP POLICY IF EXISTS "Users delete their own posts" ON public.social_posts;
DROP POLICY IF EXISTS "Posts: read" ON public.social_posts;
DROP POLICY IF EXISTS "Posts: make" ON public.social_posts;
DROP POLICY IF EXISTS "Posts: change" ON public.social_posts;
DROP POLICY IF EXISTS "Posts: remove" ON public.social_posts;

-- Where a post's files and account must be: the person's own (personal
-- post), or the team's (team post).
CREATE OR REPLACE FUNCTION public.post_is_in_place(
  p_team UUID, p_user UUID, p_account UUID, p_video TEXT, p_cover TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_team IS NULL THEN
      p_video LIKE p_user::text || '/%'
      AND (p_cover IS NULL OR p_cover LIKE p_user::text || '/%')
      AND (p_account IS NULL OR EXISTS (
        SELECT 1 FROM public.social_accounts a
        WHERE a.id = p_account AND a.user_id = p_user AND a.team_id IS NULL))
    ELSE
      p_video LIKE 'teams/' || p_team::text || '/%'
      AND (p_cover IS NULL OR p_cover LIKE 'teams/' || p_team::text || '/%')
      AND (p_account IS NULL OR EXISTS (
        SELECT 1 FROM public.social_accounts a
        WHERE a.id = p_account AND a.team_id = p_team))
  END;
$$;

REVOKE ALL ON FUNCTION public.post_is_in_place(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_is_in_place(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE POLICY "Posts: read" ON public.social_posts FOR SELECT TO authenticated
  USING (
    (team_id IS NULL AND user_id = auth.uid())
    OR (team_id IS NOT NULL AND public.team_role(team_id) IS NOT NULL)
  );

CREATE POLICY "Posts: make" ON public.social_posts FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND status = 'scheduled' AND attempts = 0
    AND external_id IS NULL AND external_ref IS NULL AND published_at IS NULL
    AND (team_id IS NULL OR public.team_role(team_id) IN ('owner', 'admin', 'editor'))
    AND public.post_is_in_place(team_id, user_id, account_id, video_path, cover_path)
  );

-- Posts that haven't gone out: whoever made one, or the team's owner and
-- admins (for a team post), can move, cancel or retry it.
CREATE POLICY "Posts: change" ON public.social_posts FOR UPDATE TO authenticated
  USING (
    status IN ('scheduled', 'failed')
    AND (
      (team_id IS NULL AND user_id = auth.uid())
      OR (team_id IS NOT NULL AND (
        public.team_role(team_id) IN ('owner', 'admin')
        OR (user_id = auth.uid() AND public.team_role(team_id) = 'editor')
      ))
    )
  )
  WITH CHECK (
    status IN ('scheduled', 'canceled')
    AND external_id IS NULL AND external_ref IS NULL AND published_at IS NULL
    AND public.post_is_in_place(team_id, user_id, account_id, video_path, cover_path)
  );

CREATE POLICY "Posts: remove" ON public.social_posts FOR DELETE TO authenticated
  USING (
    status IN ('canceled', 'failed')
    AND (
      (team_id IS NULL AND user_id = auth.uid())
      OR (team_id IS NOT NULL AND (
        public.team_role(team_id) IN ('owner', 'admin')
        OR (user_id = auth.uid() AND public.team_role(team_id) = 'editor')
      ))
    )
  );

-- Nobody moves a post between a person and a team, or changes who made it.
CREATE OR REPLACE FUNCTION public.social_posts_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Posts stay where they were made';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS social_posts_guard ON public.social_posts;
CREATE TRIGGER social_posts_guard BEFORE UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.social_posts_guard();
