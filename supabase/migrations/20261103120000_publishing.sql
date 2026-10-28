-- Publishing: connect YouTube (TikTok and Instagram later) and post finished
-- exports now or at a set time, with view counts pulled back daily.
--
-- social_accounts holds each connected channel. Its sign-in tokens are
-- encrypted by the app (AES-256-GCM, PUBLISHING_TOKEN_KEY) before they are
-- stored, and signed-in users can't read those columns at all: accounts are
-- added and refreshed by the app's server only.
--
-- social_posts is one post of one export to one account. The render worker's
-- once-a-minute tick sends due posts to the worker, which uploads them.

CREATE TABLE IF NOT EXISTS public.social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram')),
  -- The platform's own id for the channel or account.
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  -- needs_reconnect: the platform stopped accepting the sign-in.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reconnect')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_id)
);

CREATE TABLE IF NOT EXISTS public.social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Kept (as null) when the project or account is deleted, so the history stays.
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  account_id UUID REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram')),
  -- The account's name when posted, shown after it's disconnected.
  account_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 100),
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 5000),
  privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'unlisted', 'private')),
  made_for_kids BOOLEAN NOT NULL DEFAULT false,
  -- The export in the renders bucket, and the cover in raw-clips (optional).
  video_path TEXT NOT NULL,
  cover_path TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'uploading', 'published', 'failed', 'canceled')),
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  external_id TEXT,
  external_url TEXT,
  published_at TIMESTAMPTZ,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  stats_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_user ON public.social_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_user ON public.social_posts (user_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON public.social_posts (scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_social_posts_stats ON public.social_posts (stats_updated_at)
  WHERE status = 'published';

DROP TRIGGER IF EXISTS social_accounts_updated_at ON public.social_accounts;
CREATE TRIGGER social_accounts_updated_at BEFORE UPDATE ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS social_posts_updated_at ON public.social_posts;
CREATE TRIGGER social_posts_updated_at BEFORE UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

-- Accounts: users see and disconnect their own; the tokens stay hidden.
DROP POLICY IF EXISTS "Users read their own social accounts" ON public.social_accounts;
CREATE POLICY "Users read their own social accounts"
  ON public.social_accounts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users disconnect their own social accounts" ON public.social_accounts;
CREATE POLICY "Users disconnect their own social accounts"
  ON public.social_accounts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.social_accounts FROM authenticated, anon;
GRANT SELECT (id, user_id, platform, external_id, name, avatar_url, token_expires_at, scopes,
              status, created_at, updated_at)
  ON public.social_accounts TO authenticated;
GRANT DELETE ON public.social_accounts TO authenticated;
GRANT ALL ON public.social_accounts TO service_role;

-- Posts: users make, see and cancel their own. Uploads and results are
-- written by the app's server.
DROP POLICY IF EXISTS "Users read their own posts" ON public.social_posts;
CREATE POLICY "Users read their own posts"
  ON public.social_posts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Files must be in the user's own folders, and the account their own.
DROP POLICY IF EXISTS "Users make their own posts" ON public.social_posts;
CREATE POLICY "Users make their own posts"
  ON public.social_posts FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND status = 'scheduled' AND attempts = 0
    AND external_id IS NULL AND published_at IS NULL
    AND video_path LIKE auth.uid()::text || '/%'
    AND (cover_path IS NULL OR cover_path LIKE auth.uid()::text || '/%')
    AND (account_id IS NULL OR EXISTS (
      SELECT 1 FROM public.social_accounts a WHERE a.id = account_id AND a.user_id = auth.uid()))
  );

-- Only posts that haven't gone out can be changed (rescheduled, canceled,
-- or a failed one tried again).
DROP POLICY IF EXISTS "Users change their own posts" ON public.social_posts;
CREATE POLICY "Users change their own posts"
  ON public.social_posts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status IN ('scheduled', 'failed'))
  WITH CHECK (
    auth.uid() = user_id AND status IN ('scheduled', 'canceled')
    AND external_id IS NULL AND published_at IS NULL
    AND video_path LIKE auth.uid()::text || '/%'
    AND (cover_path IS NULL OR cover_path LIKE auth.uid()::text || '/%')
    AND (account_id IS NULL OR EXISTS (
      SELECT 1 FROM public.social_accounts a WHERE a.id = account_id AND a.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Users delete their own posts" ON public.social_posts;
CREATE POLICY "Users delete their own posts"
  ON public.social_posts FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND status IN ('canceled', 'failed'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;
GRANT ALL ON public.social_posts TO service_role;

-- With two-factor on, both tables need the second step too (see
-- 20261031120000_mfa_enforcement.sql).
DO $$
DECLARE t TEXT;
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['social_accounts', 'social_posts'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = 'mfa required'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "mfa required" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
             USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied())', t);
      END IF;
    END LOOP;
  END IF;
END $$;
