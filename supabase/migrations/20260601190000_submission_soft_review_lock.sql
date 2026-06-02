-- Lightweight advisory review activity for trainer collision awareness.
-- Locks are soft: they never block reads, edits, or feedback publication.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS review_active_by text,
  ADD COLUMN IF NOT EXISTS review_active_at timestamptz;

COMMENT ON COLUMN public.submissions.review_active_by IS
  'Trainer currently reviewing this submission. Advisory only; stale markers expire in application logic.';
COMMENT ON COLUMN public.submissions.review_active_at IS
  'Last review activity heartbeat. Advisory only; stale markers expire in application logic.';
