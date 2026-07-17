-- Corrective hardening for Phase 2 auto approval.
-- Safe to run even if the original Phase 2 migration already ran.

CREATE TABLE IF NOT EXISTS public.cf_cron_locks (
  lock_name text PRIMARY KEY,
  lock_owner text NOT NULL,
  locked_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cf_cron_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cf_cron_locks_deny_anon ON public.cf_cron_locks;
CREATE POLICY cf_cron_locks_deny_anon
  ON public.cf_cron_locks
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.cf_cron_locks FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cf_cron_locks TO service_role;

DROP FUNCTION IF EXISTS public.cf_try_advisory_lock(bigint);
DROP FUNCTION IF EXISTS public.cf_advisory_unlock(bigint);

CREATE OR REPLACE FUNCTION public.cf_acquire_cron_lock(
  p_lock_name text,
  p_lock_owner text,
  p_lease_seconds integer DEFAULT 240
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked boolean := false;
  v_row_count integer := 0;
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 240), 900));
BEGIN
  IF length(trim(coalesce(p_lock_name, ''))) = 0 OR length(trim(coalesce(p_lock_owner, ''))) = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.cf_cron_locks
  SET
    lock_owner = p_lock_owner,
    locked_until = now() + make_interval(secs => v_lease_seconds),
    updated_at = now()
  WHERE lock_name = p_lock_name
    AND locked_until <= now();

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count > 0 THEN
    RETURN true;
  END IF;

  INSERT INTO public.cf_cron_locks (lock_name, lock_owner, locked_until, updated_at)
  VALUES (p_lock_name, p_lock_owner, now() + make_interval(secs => v_lease_seconds), now())
  ON CONFLICT (lock_name) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_locked := v_row_count > 0;
  RETURN v_locked;
END;
$$;

CREATE OR REPLACE FUNCTION public.cf_release_cron_lock(
  p_lock_name text,
  p_lock_owner text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released boolean := false;
  v_row_count integer := 0;
BEGIN
  UPDATE public.cf_cron_locks
  SET
    locked_until = now(),
    updated_at = now()
  WHERE lock_name = p_lock_name
    AND lock_owner = p_lock_owner;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_released := v_row_count > 0;
  RETURN v_released;
END;
$$;

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
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_acquire_cron_lock(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cf_release_cron_lock(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cf_publish_submission_feedback(bigint, text, text, text, timestamptz, text, text, boolean, boolean, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cf_acquire_cron_lock(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cf_release_cron_lock(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cf_publish_submission_feedback(bigint, text, text, text, timestamptz, text, text, boolean, boolean, boolean) TO service_role;
