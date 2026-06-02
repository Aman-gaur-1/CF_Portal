-- Phase 0 + 1: curriculum RAG store and submission AI evaluation columns
-- Safe to run on existing projects (IF NOT EXISTS / additive only)

-- ---------------------------------------------------------------------------
-- curriculum_chunks: phase/topic-filtered RAG source (no pgvector in this phase)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.curriculum_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text NOT NULL DEFAULT 'Python',
  topic text,
  title text NOT NULL DEFAULT 'Section',
  content text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_phase
  ON public.curriculum_chunks (phase);

CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_phase_topic
  ON public.curriculum_chunks (phase, topic);

CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_sort
  ON public.curriculum_chunks (phase, sort_order);

COMMENT ON TABLE public.curriculum_chunks IS
  'RAG curriculum chunks; topic NULL means general/phase-wide content.';

-- ---------------------------------------------------------------------------
-- submissions: AI pipeline state (human-in-the-loop unchanged)
-- ai_feedback = draft, feedback = trainer-approved
-- ---------------------------------------------------------------------------
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS ai_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ai_evaluation jsonb,
  ADD COLUMN IF NOT EXISTS submission_text text,
  ADD COLUMN IF NOT EXISTS ai_error text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_rag_version text;

COMMENT ON COLUMN public.submissions.ai_status IS
  'pending | processing | ready | failed';
COMMENT ON COLUMN public.submissions.ai_evaluation IS
  'Structured evaluation JSON from the AI pipeline';
COMMENT ON COLUMN public.submissions.submission_text IS
  'Cached extract of code/file content for evaluation';

-- Optional seed: one general Python chunk if table is empty (edit content in dashboard)
INSERT INTO public.curriculum_chunks (phase, topic, title, content, sort_order, updated_by)
SELECT
  'Python',
  NULL,
  'General curriculum',
  'Add your Python curriculum content here. Topics: variables, data types, loops, functions, OOP, file handling, exceptions, modules, pandas, numpy. Update via the trainer Reference Document panel.',
  0,
  'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.curriculum_chunks LIMIT 1);
