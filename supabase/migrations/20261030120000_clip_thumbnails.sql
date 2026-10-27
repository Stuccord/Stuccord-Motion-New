-- A small picture of each clip (a frame from the video, or the image itself),
-- for the Projects, Home and Assets pages.
--
-- The picture is a JPEG in the raw-clips bucket at
-- <user id>/thumbs/<clip id>.jpg, inside the user's own folder, so the
-- existing storage policies already cover it. NULL: not made yet (the app
-- makes it the next time the clip is shown).
--
-- Additive and safe to run more than once.

ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
