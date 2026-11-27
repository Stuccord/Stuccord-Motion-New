-- The editor's Noise removal setting, saved per project: how hard the
-- export cleans the voice (render-worker/noise.js). 'auto' picks the
-- strength from how noisy the room is; 'light' and 'strong' go one step
-- gentler or harder; 'off' leaves the voice as recorded (only the low-cut).
--
-- Additive and safe to run more than once.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS noise_removal TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_noise_removal_mode'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_noise_removal_mode
      CHECK (noise_removal IN ('auto', 'off', 'light', 'strong'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
