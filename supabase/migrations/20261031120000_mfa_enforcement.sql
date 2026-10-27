-- Two-factor sign-in, enforced by the database (Supabase's recommended
-- pattern): a user who has turned on an authenticator app can only reach
-- their data from a session that passed the 6-digit code (aal2). A session
-- made with the password alone (aal1) sees nothing. Users without two-factor
-- are unaffected.
--
-- These are RESTRICTIVE policies: they're added on top of the existing
-- "own rows" policies (both must pass). The service role (render worker,
-- webhooks) bypasses row security as before.
--
-- Safe to run more than once.

-- True when this session is allowed: it passed two-factor, or the user has
-- no verified authenticator. SECURITY DEFINER so it can read auth.mfa_factors.
CREATE OR REPLACE FUNCTION public.mfa_satisfied()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    OR NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = auth.uid() AND f.status = 'verified'
    );
$$;

REVOKE ALL ON FUNCTION public.mfa_satisfied() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mfa_satisfied() TO authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'projects', 'clips', 'render_jobs', 'transcripts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = t AND policyname = 'mfa required'
       ) THEN
      EXECUTE format(
        'CREATE POLICY "mfa required" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
           USING (public.mfa_satisfied()) WITH CHECK (public.mfa_satisfied())',
        t
      );
    END IF;
  END LOOP;

  -- Uploaded files, thumbnails and exports.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mfa required (app buckets)'
  ) THEN
    CREATE POLICY "mfa required (app buckets)" ON storage.objects
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (bucket_id NOT IN ('raw-clips', 'renders') OR public.mfa_satisfied())
      WITH CHECK (bucket_id NOT IN ('raw-clips', 'renders') OR public.mfa_satisfied());
  END IF;
END $$;
