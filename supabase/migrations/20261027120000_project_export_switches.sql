-- The editor's export switches, saved per project so they survive a reload:
-- burn captions, mix music and SFX, and the music volume (0-100).
-- The defaults match what the editor used before they were saved.
--
-- Additive and safe to run more than once.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS captions_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS music_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS music_volume SMALLINT NOT NULL DEFAULT 60;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_music_volume_range'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_music_volume_range CHECK (music_volume BETWEEN 0 AND 100);
  END IF;
END $$;
