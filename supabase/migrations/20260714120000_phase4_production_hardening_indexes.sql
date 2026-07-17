-- Phase 4 production hardening indexes.
-- Additive only. These support existing dashboard, trainer scope, query, and AI queue reads.

CREATE INDEX IF NOT EXISTS submissions_batch_submitted_idx
  ON public.submissions (batch, submitted_at DESC);

CREATE INDEX IF NOT EXISTS submissions_student_submitted_idx
  ON public.submissions (student_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS submissions_review_queue_idx
  ON public.submissions (batch, submitted_at DESC)
  WHERE feedback IS NULL AND feedback_at IS NULL;

CREATE INDEX IF NOT EXISTS submissions_ai_queue_idx
  ON public.submissions (ai_status, submitted_at DESC)
  WHERE feedback IS NULL AND feedback_at IS NULL AND ai_feedback IS NULL;

CREATE INDEX IF NOT EXISTS batches_created_by_name_idx
  ON public.batches (created_by, name);
