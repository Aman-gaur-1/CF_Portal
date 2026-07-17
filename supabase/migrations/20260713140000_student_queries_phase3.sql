-- Student Query & Trainer Resolution System - Phase 3 foundation.
-- Additive only. Existing submissions, AI generation, publishing, auto approval,
-- and workflow behavior remain unchanged.

CREATE TABLE IF NOT EXISTS public.assignment_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id bigint NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  query_text text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  trainer_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'student',
  updated_by text,
  resolved_at timestamptz,
  resolved_by text
);

CREATE INDEX IF NOT EXISTS assignment_queries_submission_idx
  ON public.assignment_queries (submission_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assignment_queries_student_idx
  ON public.assignment_queries (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assignment_queries_status_idx
  ON public.assignment_queries (status, created_at DESC);

CREATE INDEX IF NOT EXISTS assignment_queries_open_idx
  ON public.assignment_queries (created_at DESC)
  WHERE status = 'open';

ALTER TABLE public.assignment_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignment_queries_deny_anon ON public.assignment_queries;
CREATE POLICY assignment_queries_deny_anon
  ON public.assignment_queries
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.assignment_queries FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_queries TO service_role;
