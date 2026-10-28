-- Voiceover: a clip role for recorded or AI voiceovers (the VO track), and a
-- log of AI voice use so the free plan's monthly limit can be checked.

ALTER TYPE public.clip_role ADD VALUE IF NOT EXISTS 'voiceover';

-- One row per AI voiceover made. Written by the app's server (service role)
-- only; users can read their own rows (for "used this month").
CREATE TABLE IF NOT EXISTS public.tts_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  characters INTEGER NOT NULL CHECK (characters > 0),
  voice_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tts_usage_user_created
  ON public.tts_usage (user_id, created_at);

ALTER TABLE public.tts_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own AI voice use" ON public.tts_usage;
CREATE POLICY "Users read their own AI voice use"
  ON public.tts_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.tts_usage TO authenticated;
GRANT ALL ON public.tts_usage TO service_role;

-- With two-factor on, reading it needs the second step too (like the other
-- tables; see 20261031120000_mfa_enforcement.sql).
DO $$
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'tts_usage' AND policyname = 'mfa required'
     ) THEN
    CREATE POLICY "mfa required" ON public.tts_usage AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied());
  END IF;
END $$;
