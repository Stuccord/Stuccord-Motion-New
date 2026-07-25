ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS trim_in_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trim_out_ms integer,
  ADD COLUMN IF NOT EXISTS parent_clip_id uuid REFERENCES public.clips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS clips_parent_clip_id_idx ON public.clips(parent_clip_id);