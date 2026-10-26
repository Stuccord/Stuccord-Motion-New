-- Transcripts for captions: one row per uploaded source file (its raw-clips
-- storage path), so split halves and duplicates of a clip share one
-- transcript, and the user's corrections survive trims, splits and reorders.
--
-- words is a JSON array of { "text": string, "start_ms": int, "end_ms": int },
-- with times in milliseconds from the start of the source file.
--
-- Rows are written by the render webhook (service role) after the worker
-- transcribes a file. Users read their own rows, save corrections to them,
-- and delete them along with the source file.
--
-- Additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  language TEXT,
  words JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- true once the user has corrected the words in the editor
  edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transcripts_user_path_key UNIQUE (user_id, storage_path),
  CONSTRAINT transcripts_words_is_array CHECK (jsonb_typeof(words) = 'array')
);

GRANT SELECT, UPDATE, DELETE ON public.transcripts TO authenticated;
GRANT ALL ON public.transcripts TO service_role;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own transcripts read" ON public.transcripts;
CREATE POLICY "own transcripts read" ON public.transcripts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own transcripts update" ON public.transcripts;
CREATE POLICY "own transcripts update" ON public.transcripts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own transcripts delete" ON public.transcripts;
CREATE POLICY "own transcripts delete" ON public.transcripts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_transcripts_updated ON public.transcripts;
CREATE TRIGGER trg_transcripts_updated BEFORE UPDATE ON public.transcripts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
