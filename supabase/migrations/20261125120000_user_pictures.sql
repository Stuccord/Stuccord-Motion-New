-- The creator's own pictures for a video (screenshots, photos), added on the
-- New project page with an optional note each. They live in the project's
-- folder of motion-images; the graphics planner (Claude) looks at them and
-- shows each one where the speaker talks about it.
-- user_pictures: [{ path, note }]. Only the server writes it.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS user_pictures jsonb;
