-- AI music (ElevenLabs Music): one row per track made, for the monthly
-- allowance (AI_MUSIC_MONTHLY_TRACKS in src/lib/ai-music.ts). Written by the
-- server only; users can read their own.

CREATE TABLE IF NOT EXISTS public.music_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  length_ms INTEGER NOT NULL CHECK (length_ms > 0),
  prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_music_usage_user_created
  ON public.music_usage (user_id, created_at);

ALTER TABLE public.music_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own AI music use" ON public.music_usage;
CREATE POLICY "Users read their own AI music use"
  ON public.music_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.music_usage TO authenticated;
GRANT ALL ON public.music_usage TO service_role;

-- With two-factor on, reading it needs the second step too (like the other
-- tables; see 20261031120000_mfa_enforcement.sql).
DO $$
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'music_usage' AND policyname = 'mfa required'
     ) THEN
    CREATE POLICY "mfa required" ON public.music_usage AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied());
  END IF;
END $$;
