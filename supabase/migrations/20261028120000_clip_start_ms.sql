-- Free placement on the timeline: where a clip starts (ms from 0:00).
--
-- NULL means "right after the clip before it on its track", which is how
-- every clip was laid out before, so existing projects are unchanged.
-- Music loops from its start until the next song (or the end of the video);
-- an SFX with no start keeps playing on every cut.
--
-- Additive and safe to run more than once.

ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS start_ms INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clips_start_ms_not_negative'
  ) THEN
    ALTER TABLE public.clips
      ADD CONSTRAINT clips_start_ms_not_negative CHECK (start_ms IS NULL OR start_ms >= 0);
  END IF;
END $$;
