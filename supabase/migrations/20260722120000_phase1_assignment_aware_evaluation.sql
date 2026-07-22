-- Phase 1 assignment-aware evaluation.
-- Keeps submissions.phase backward-compatible while making the required phase
-- set explicit and storing lightweight detection metadata for new submissions.

CREATE TABLE IF NOT EXISTS public.assignment_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '',
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

WITH required_assignment_phases (name, slug, description, color, icon, display_order, is_active) AS (
  VALUES
    ('Python', 'python', 'Python programming assignments.', '#3b82f6', 'Code', 10, true),
    ('SQL', 'sql', 'SQL query and database assignments.', '#14b8a6', 'Database', 20, true),
    ('Data Analytics', 'data-analytics', 'NumPy, Pandas, Matplotlib, and Seaborn assignments.', '#f59e0b', 'Chart', 30, true),
    ('Power BI', 'power-bi', 'Power BI, DAX, data model, and dashboard assignments.', '#eab308', 'BarChart', 40, true)
)
INSERT INTO public.assignment_phases (name, slug, description, color, icon, display_order, is_active)
SELECT required.name, required.slug, required.description, required.color, required.icon, required.display_order, required.is_active
FROM required_assignment_phases required
WHERE NOT EXISTS (
  SELECT 1
  FROM public.assignment_phases existing
  WHERE existing.name = required.name
     OR existing.slug = required.slug
);

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS detected_assignment_language text,
  ADD COLUMN IF NOT EXISTS detected_assignment_phase text,
  ADD COLUMN IF NOT EXISTS detected_assignment_type text,
  ADD COLUMN IF NOT EXISTS final_evaluation_phase text,
  ADD COLUMN IF NOT EXISTS phase_detection_warning boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS submissions_detected_assignment_phase_idx
  ON public.submissions (detected_assignment_phase);

CREATE INDEX IF NOT EXISTS submissions_final_evaluation_phase_idx
  ON public.submissions (final_evaluation_phase);

COMMENT ON COLUMN public.submissions.detected_assignment_language IS
  'Heuristic language detected from student-submitted text or file metadata at submission/evaluation time.';

COMMENT ON COLUMN public.submissions.detected_assignment_phase IS
  'Canonical assignment phase inferred from the detected language.';

COMMENT ON COLUMN public.submissions.detected_assignment_type IS
  'Heuristic assignment category inferred from topic, file type, and parsed content.';

COMMENT ON COLUMN public.submissions.final_evaluation_phase IS
  'Assignment phase actually used by the AI evaluator after confidence-based override logic.';

COMMENT ON COLUMN public.submissions.phase_detection_warning IS
  'True when detected assignment phase differs from the student-selected phase.';
