-- Motion Explainer, stage 8: a cartoon of the speaker.
--
-- Each project can have one cartoon character of whoever speaks in it: a 3D
-- animated version made by the AI image model from a frame of the footage
-- or an uploaded photo, after the person making it confirms they are that
-- person or have their permission. The character is then used in story
-- scenes with the speaker and in cartoon graphics.
--
-- motion_character holds { image, photo, from, consent_by, consent_at,
-- made_at }: the cartoon's and the photo's paths in the private
-- motion-images bucket (the project's folder), whether the photo came from
-- the footage or an upload, and who confirmed consent and when. Only the
-- server writes it, after checking edit rights.
--
-- Additive and safe to run more than once.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS motion_character JSONB;
