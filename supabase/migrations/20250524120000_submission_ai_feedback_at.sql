-- Add ai_feedback_at if missing (orchestrator + stale reclaim use this column)
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS ai_feedback_at timestamptz;

COMMENT ON COLUMN public.submissions.ai_feedback_at IS
  'When the current ai_feedback draft was last generated or saved';
