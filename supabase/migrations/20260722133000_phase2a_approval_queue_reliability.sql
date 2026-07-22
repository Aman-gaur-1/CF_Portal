-- Phase 2A: trainer approval workflow, queue reliability, and audit metadata.
-- Additive and idempotent; preserves existing ai_status and feedback workflow.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_workflow_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ai_failure_reason text,
  ADD COLUMN IF NOT EXISTS ai_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_last_duration_ms integer,
  ADD COLUMN IF NOT EXISTS ai_auto_approval_blocked_reason text;

ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_ai_workflow_state_check;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_ai_workflow_state_check
  CHECK (ai_workflow_state IN ('pending', 'queued', 'processing', 'draft_ready', 'failed', 'approved', 'published'));

CREATE INDEX IF NOT EXISTS submissions_ai_workflow_state_idx
  ON public.submissions (ai_workflow_state, submitted_at DESC);

CREATE INDEX IF NOT EXISTS submissions_ai_failure_reason_idx
  ON public.submissions (ai_failure_reason)
  WHERE ai_failure_reason IS NOT NULL;

ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS activity_log_action_created_at_idx
  ON public.activity_log (action, created_at DESC);

CREATE OR REPLACE FUNCTION public.cf_publish_submission_feedback(
  p_submission_id bigint,
  p_feedback text,
  p_feedback_by text,
  p_approval_method text,
  p_feedback_at timestamptz DEFAULT now(),
  p_submission_type text DEFAULT NULL,
  p_phase text DEFAULT NULL,
  p_require_ai_ready boolean DEFAULT false,
  p_require_due boolean DEFAULT false,
  p_allow_update_published boolean DEFAULT false
)
RETURNS SETOF public.submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_submission_id IS NULL OR length(trim(coalesce(p_feedback, ''))) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.submissions
  SET
    feedback = p_feedback,
    feedback_by = p_feedback_by,
    feedback_at = p_feedback_at,
    approval_method = CASE
      WHEN submissions.approval_at IS NULL THEN p_approval_method
      ELSE submissions.approval_method
    END,
    approval_at = COALESCE(submissions.approval_at, p_feedback_at),
    approved_by = COALESCE(submissions.approved_by, p_feedback_by),
    approved_at = COALESCE(submissions.approved_at, p_feedback_at),
    ai_workflow_state = 'published',
    ai_auto_approval_blocked_reason = NULL,
    auto_approval_due_at = NULL,
    review_active_by = NULL,
    review_active_at = NULL,
    submission_type = COALESCE(NULLIF(trim(coalesce(p_submission_type, '')), ''), submissions.submission_type),
    phase = COALESCE(NULLIF(trim(coalesce(p_phase, '')), ''), submissions.phase),
    ai_status = CASE
      WHEN length(trim(coalesce(submissions.ai_feedback, ''))) > 0 THEN 'ready'
      ELSE submissions.ai_status
    END,
    ai_error = CASE
      WHEN length(trim(coalesce(submissions.ai_feedback, ''))) > 0 THEN NULL
      ELSE submissions.ai_error
    END
  WHERE submissions.id = p_submission_id
    AND (
      p_allow_update_published = true
      OR (
        submissions.feedback_at IS NULL
        AND length(trim(coalesce(submissions.feedback, ''))) = 0
      )
    )
    AND (
      p_require_ai_ready = false
      OR (
        submissions.ai_status = 'ready'
        AND length(trim(coalesce(submissions.ai_feedback, ''))) > 0
      )
    )
    AND (
      p_require_due = false
      OR (
        submissions.auto_approval_due_at IS NOT NULL
        AND submissions.auto_approval_due_at <= now()
      )
    )
  RETURNING submissions.*;
END;
$$;

REVOKE ALL ON FUNCTION public.cf_publish_submission_feedback(bigint, text, text, text, timestamptz, text, text, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_publish_submission_feedback(bigint, text, text, text, timestamptz, text, text, boolean, boolean, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
