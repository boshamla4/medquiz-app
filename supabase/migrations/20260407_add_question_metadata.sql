-- Add question metadata columns for advanced filtering.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS source_file TEXT,
  ADD COLUMN IF NOT EXISTS source_collection TEXT,
  ADD COLUMN IF NOT EXISTS topic TEXT;

-- Optional indexes for common filters.
CREATE INDEX IF NOT EXISTS idx_questions_source_file ON public.questions(source_file);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON public.questions(topic);
CREATE INDEX IF NOT EXISTS idx_questions_type ON public.questions(type);
