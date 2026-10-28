-- API keys: let a user's own scripts use their workspace through /api/v1.
-- Only a SHA-256 hash of each key is stored; the key itself is shown once,
-- when it's made. Keys are made and revoked through the app's server.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- The start of the key (e.g. "smk_ab12cd34"), to tell keys apart.
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'full')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys (user_id, created_at);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own API keys" ON public.api_keys;
CREATE POLICY "Users read their own API keys"
  ON public.api_keys FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users make their own API keys" ON public.api_keys;
CREATE POLICY "Users make their own API keys"
  ON public.api_keys FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users revoke their own API keys" ON public.api_keys;
CREATE POLICY "Users revoke their own API keys"
  ON public.api_keys FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

-- With two-factor on, managing keys needs the second step too (like the
-- other tables; see 20261031120000_mfa_enforcement.sql).
DO $$
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'api_keys' AND policyname = 'mfa required'
     ) THEN
    CREATE POLICY "mfa required" ON public.api_keys AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied());
  END IF;
END $$;
