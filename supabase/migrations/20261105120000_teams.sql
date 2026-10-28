-- Teams, stage A: teams, their members and roles, and invite links.
-- (Team projects and files, the brand kit, exports and social accounts come
-- in later stages.)
--
-- Roles: owner (one per team; everything, including deleting the team),
-- admin (manages members and invites), editor (makes, edits, exports and
-- posts), viewer (opens, watches and downloads).
--
-- Members and invites are changed by the app's server only (it checks the
-- caller's role and the plan's seat limit); signed-in users can read their
-- own teams. Invite links store only a SHA-256 hash of the link's secret.

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- The team's plan (see src/lib/plans.ts). Everyone is on 'free' until paid
  -- plans exist.
  plan TEXT NOT NULL DEFAULT 'free',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- Exactly one owner per team.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_one_owner
  ON public.team_members (team_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members (user_id);

CREATE TABLE IF NOT EXISTS public.team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uses INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team ON public.team_invites (team_id, created_at);

DROP TRIGGER IF EXISTS teams_updated_at ON public.teams;
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The signed-in user's role in a team (null when not a member). Used by the
-- policies here and, in later stages, by projects, clips and storage.
CREATE OR REPLACE FUNCTION public.team_role(team UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.role FROM public.team_members m
  WHERE m.team_id = team AND m.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.team_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_role(UUID) TO authenticated;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their teams" ON public.teams;
CREATE POLICY "Members read their teams"
  ON public.teams FOR SELECT TO authenticated
  USING (public.team_role(id) IS NOT NULL);

DROP POLICY IF EXISTS "Members read their team's members" ON public.team_members;
CREATE POLICY "Members read their team's members"
  ON public.team_members FOR SELECT TO authenticated
  USING (public.team_role(team_id) IS NOT NULL);

DROP POLICY IF EXISTS "Admins read their team's invites" ON public.team_invites;
CREATE POLICY "Admins read their team's invites"
  ON public.team_invites FOR SELECT TO authenticated
  USING (public.team_role(team_id) IN ('owner', 'admin'));

-- Reads only for signed-in users; every change goes through the server.
REVOKE ALL ON public.teams, public.team_members, public.team_invites FROM anon, authenticated;
GRANT SELECT ON public.teams, public.team_members TO authenticated;
GRANT SELECT (id, team_id, role, created_by, uses, created_at, expires_at, revoked_at)
  ON public.team_invites TO authenticated;
GRANT ALL ON public.teams, public.team_members, public.team_invites TO service_role;

-- With two-factor on, team data needs the second step too.
DO $$
DECLARE t TEXT;
BEGIN
  IF to_regprocedure('public.mfa_satisfied()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['teams', 'team_members', 'team_invites'] LOOP
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
