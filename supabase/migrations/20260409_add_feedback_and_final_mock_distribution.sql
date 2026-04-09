-- Feedback table and final mock distribution settings.

CREATE TABLE IF NOT EXISTS public.feedback_comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL CHECK (char_length(trim(comment)) > 0),
  whatsapp TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_user_id
  ON public.feedback_comments(user_id);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_created_at
  ON public.feedback_comments(created_at DESC);

CREATE TABLE IF NOT EXISTS public.final_mock_distribution (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program TEXT NOT NULL DEFAULT 'Medicine',
  subject TEXT NOT NULL,
  source_pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact' CHECK (match_type IN ('exact', 'prefix')),
  weight_percent NUMERIC(5,2) NOT NULL CHECK (weight_percent > 0 AND weight_percent <= 100),
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program, source_pattern, match_type)
);

CREATE INDEX IF NOT EXISTS idx_final_mock_distribution_program_active
  ON public.final_mock_distribution(program, active, display_order);

-- Program: Medicine (2025 graduation exam distribution)
INSERT INTO public.final_mock_distribution
  (program, subject, source_pattern, match_type, weight_percent, display_order, active)
VALUES
  ('Medicine', 'Pneumology', 'data/Graduation Exam Tests/Pneumology_Calaras.docx', 'exact', 7.00, 10, TRUE),
  ('Medicine', 'Cardiology', 'data/Graduation Exam Tests/Cardiology_Grejdieru.docx', 'exact', 10.00, 20, TRUE),
  ('Medicine', 'Gastroenterology', 'data/Graduation Exam Tests/Gastro_Berliba.docx', 'exact', 10.00, 30, TRUE),
  ('Medicine', 'Rheumatology', 'data/Graduation Exam Tests/Reumatology_Nistor.docx', 'exact', 6.00, 40, TRUE),
  ('Medicine', 'Nephrology', 'data/Graduation Exam Tests/Nephrology_Nistor.docx', 'exact', 2.00, 50, TRUE),
  ('Medicine', 'Pediatrics', 'data/Pediatrics/', 'prefix', 25.00, 60, TRUE),
  ('Medicine', 'Surgery Year IV', 'data/Graduation Exam Tests/Surgery_4th year_Vozian.docx', 'exact', 8.00, 70, TRUE),
  ('Medicine', 'Surgery Year VI', 'data/Graduation Exam Tests/Surgery_5th year_Timis.docx', 'exact', 8.00, 80, TRUE),
  ('Medicine', 'Pediatric Surgery', 'data/Graduation Exam Tests/Surgery_Ped_Jalba.docx', 'exact', 4.00, 90, TRUE),
  ('Medicine', 'Surgery Year III', 'data/Graduation Exam Tests/Surgery_3rd year_Vescu.docx', 'exact', 5.00, 100, TRUE),
  ('Medicine', 'Obstetrics and Gynecology', 'data/Graduation Exam Tests/Obstetrics_Ginecol_Catrinici.docx', 'exact', 15.00, 110, TRUE)
ON CONFLICT (program, source_pattern, match_type) DO UPDATE
SET
  subject = EXCLUDED.subject,
  weight_percent = EXCLUDED.weight_percent,
  display_order = EXCLUDED.display_order,
  active = EXCLUDED.active;
