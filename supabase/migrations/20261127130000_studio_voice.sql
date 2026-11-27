-- Studio voice: AI voice isolation (ElevenLabs Voice Isolator) as a Noise
-- removal setting, and one row per recording isolated, for the monthly
-- allowance (STUDIO_VOICE_MONTHLY_SECONDS in src/lib/noise-removal.ts).
-- Each recording is isolated once and reused, so it's counted once.
-- Written by the server only; users can read their own.
--
-- Additive and safe to run more than once.

-- 'studio' joins the Noise removal settings.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS noise_removal TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_noise_removal_mode;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_noise_removal_mode
  CHECK (noise_removal IN ('auto', 'off', 'light', 'strong', 'studio'));

CREATE TABLE IF NOT EXISTS public.voice_isolation_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- The recording (raw-clips path) and how long it is (what's paid for).
  storage_path TEXT NOT NULL,
  seconds INTEGER NOT NULL CHECK (seconds > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_isolation_usage_user_created
  ON public.voice_isolation_usage (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_voice_isolation_usage_path
  ON public.voice_isolation_usage (storage_path);

ALTER TABLE public.voice_isolation_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own voice isolation use" ON public.voice_isolation_usage;
CREATE POLICY "Users read their own voice isolation use"
  ON public.voice_isolation_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.voice_isolation_usage TO authenticated;
GRANT ALL ON public.voice_isolation_usage TO service_role;

-- With two-factor on, reading it needs the second step too (like the other
-- tables; see 20261031120000_mfa_enforcement.sql).
DO $$
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'voice_isolation_usage' AND policyname = 'mfa required'
     ) THEN
    CREATE POLICY "mfa required" ON public.voice_isolation_usage AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
