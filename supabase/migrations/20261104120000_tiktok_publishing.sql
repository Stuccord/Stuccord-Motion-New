-- TikTok publishing: each post can carry platform options (for TikTok: post
-- to the profile or to drafts, who can see it, comments/Duet/Stitch, and
-- the commercial-content disclosure), and the platform's id for the upload
-- itself (TikTok's publish_id), used to find the post once TikTok has
-- finished processing it.

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_social_posts_resolve ON public.social_posts (published_at)
  WHERE status = 'published' AND external_id IS NULL AND external_ref IS NOT NULL;

-- Users still can't set the platform's ids on their own posts.
DROP POLICY IF EXISTS "Users make their own posts" ON public.social_posts;
CREATE POLICY "Users make their own posts"
  ON public.social_posts FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND status = 'scheduled' AND attempts = 0
    AND external_id IS NULL AND external_ref IS NULL AND published_at IS NULL
    AND video_path LIKE auth.uid()::text || '/%'
    AND (cover_path IS NULL OR cover_path LIKE auth.uid()::text || '/%')
    AND (account_id IS NULL OR EXISTS (
      SELECT 1 FROM public.social_accounts a WHERE a.id = account_id AND a.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Users change their own posts" ON public.social_posts;
CREATE POLICY "Users change their own posts"
  ON public.social_posts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status IN ('scheduled', 'failed'))
  WITH CHECK (
    auth.uid() = user_id AND status IN ('scheduled', 'canceled')
    AND external_id IS NULL AND external_ref IS NULL AND published_at IS NULL
    AND video_path LIKE auth.uid()::text || '/%'
    AND (cover_path IS NULL OR cover_path LIKE auth.uid()::text || '/%')
    AND (account_id IS NULL OR EXISTS (
      SELECT 1 FROM public.social_accounts a WHERE a.id = account_id AND a.user_id = auth.uid()))
  );
