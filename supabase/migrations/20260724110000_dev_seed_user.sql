-- Dev seed: insert a stable dev user into auth.users so that the foreign key
-- constraint on projects.user_id, clips.user_id, and render_jobs.user_id
-- is satisfied when the server-side dev bypass uses mockUserId.
--
-- This user is ONLY for local development. It has no password or login.
-- The service_role key bypasses RLS, so no auth.uid() check applies.
DO $$
BEGIN
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'dev-user@stuccord.local',
    '',
    now(),
    '{"full_name": "Stuccord Dev User"}'::jsonb,
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Also ensure the profile row exists so foreign key on profiles is satisfied
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Stuccord Dev User',
    null
  )
  ON CONFLICT (id) DO NOTHING;
END $$;
