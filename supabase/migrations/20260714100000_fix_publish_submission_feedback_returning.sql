-- Fix cf_publish_submission_feedback so RETURN QUERY receives rows from UPDATE.
-- Signature intentionally unchanged for Supabase RPC compatibility.

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
