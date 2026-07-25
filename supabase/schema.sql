-- ==========================================
-- STUCCORD MOTION STUDIO - COMPLETE SUPABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- (https://supabase.com/dashboard/project/ayelmiaagypuracepbzl/sql/new)
-- ==========================================

-- 1. Storage Buckets Setup
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('raw-clips', 'raw-clips', false),
  ('renders', 'renders', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Custom Types & Enums
DO $$ BEGIN
  CREATE TYPE public.project_status AS ENUM ('draft','queued','processing','ready','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.aspect_ratio AS ENUM ('9:16','16:9','1:1');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.clip_role AS ENUM ('auto','aroll','broll','music','sfx');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('queued','transcribing','planning','rendering','completed','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Projects Table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled project',
  script TEXT,
  brief TEXT,
  style_preset TEXT NOT NULL DEFAULT 'gadzhi',
  aspect_ratio public.aspect_ratio NOT NULL DEFAULT '9:16',
  status public.project_status NOT NULL DEFAULT 'draft',
  thumbnail_url TEXT,
  output_path TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Clips Table
CREATE TABLE IF NOT EXISTS public.clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes BIGINT,
  role public.clip_role NOT NULL DEFAULT 'auto',
  ordinal INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  trim_in_ms INTEGER NOT NULL DEFAULT 0,
  trim_out_ms INTEGER,
  parent_clip_id UUID REFERENCES public.clips(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Render Jobs Table
CREATE TABLE IF NOT EXISTS public.render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.job_status NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  stage_message TEXT,
  edit_plan JSONB,
  output_path TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_projects_user ON public.projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_project ON public.clips(project_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_clips_parent ON public.clips(parent_clip_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON public.render_jobs(project_id, created_at DESC);

-- 8. Functions & Triggers
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated ON public.projects;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated ON public.render_jobs;
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.render_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 9. Permissions & Row Level Security (RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "own profile upsert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own projects all" ON public.projects FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clips TO authenticated;
GRANT ALL ON public.clips TO service_role;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own clips all" ON public.clips FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_jobs TO authenticated;
GRANT ALL ON public.render_jobs TO service_role;
ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own jobs read" ON public.render_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "own jobs insert" ON public.render_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 10. Storage Policies (raw-clips & renders)
DO $$ BEGIN
  CREATE POLICY "raw own read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'raw-clips' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "raw own write" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'raw-clips' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "raw own update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'raw-clips' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "raw own delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'raw-clips' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "render own read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "render own write" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "render own update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1])
    WITH CHECK (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "render own delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 11. Enable Realtime Publications
ALTER PUBLICATION supabase_realtime ADD TABLE public.render_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
