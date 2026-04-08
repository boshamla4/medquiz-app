-- Add question metadata columns for advanced filtering.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS source_file TEXT,
  ADD COLUMN IF NOT EXISTS source_collection TEXT,
  ADD COLUMN IF NOT EXISTS question_order INTEGER;

-- Topic has been superseded by source_file + module filters.
ALTER TABLE public.questions
  DROP COLUMN IF EXISTS topic;

-- Optional indexes for common filters.
CREATE INDEX IF NOT EXISTS idx_questions_source_file ON public.questions(source_file);
CREATE INDEX IF NOT EXISTS idx_questions_question_order ON public.questions(question_order);
CREATE INDEX IF NOT EXISTS idx_questions_type ON public.questions(type);
