-- Compatibility wrapper for session-aware attendance percentages.
-- Legacy calendar-day attendance remains unchanged when a batch has no
-- explicit (non-legacy_backfill) attendance sessions.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.cf_health_card_leaderboard(text,date)') IS NOT NULL
     AND to_regprocedure('public.cf_health_card_leaderboard_legacy(text,date)') IS NULL THEN
    ALTER FUNCTION public.cf_health_card_leaderboard(text, date)
      RENAME TO cf_health_card_leaderboard_legacy;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cf_health_card_leaderboard(
  p_batch text,
  p_as_of_date date DEFAULT NULL
)
RETURNS TABLE (
  student_id uuid,
  student_name text,
  batch text,
  assignment_expected bigint,
  assignment_completed bigint,
  project_expected bigint,
  project_completed bigint,
  eligible_working_days bigint,
  approved_attendance_days bigint,
  pending_attendance_days bigint,
  rejected_attendance_days bigint,
  assignment_completion_percentage numeric,
  project_completion_percentage numeric,
  attendance_percentage numeric,
  assignment_points numeric,
  project_points numeric,
  attendance_points numeric,
  total_points numeric,
  final_score_at timestamptz,
  batch_rank bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT *
    FROM public.cf_health_card_leaderboard_legacy(p_batch, p_as_of_date)
  ),
  params AS (
    SELECT GREATEST(
      COALESCE(p_as_of_date, (now() AT TIME ZONE 'Asia/Kolkata')::date),
      DATE '2026-10-01'
    ) AS as_of_date
  ),
  explicit_session_mode AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.attendance_sessions s
      CROSS JOIN params p
      WHERE s.batch = NULLIF(btrim(p_batch), '')
        AND s.source <> 'legacy_backfill'
        AND s.session_date >= DATE '2026-10-01'
        AND s.session_date <= p.as_of_date
    ) AS has_explicit_sessions
  ),
  eligible_explicit_sessions AS (
    SELECT DISTINCT
      b.student_id,
      s.id AS session_id
    FROM base b
    CROSS JOIN params p
    JOIN public.attendance_sessions s
      ON s.batch = b.batch
     AND s.source <> 'legacy_backfill'
     AND s.session_date >= DATE '2026-10-01'
     AND s.session_date <= p.as_of_date
    WHERE EXISTS (
      SELECT 1
      FROM public.student_batch_memberships m
      WHERE m.student_id = b.student_id
        AND m.batch = s.batch
        AND s.session_date >= m.starts_on
        AND (m.ends_on IS NULL OR s.session_date < m.ends_on)
    )
  ),
  explicit_sessions AS (
    SELECT
      student_id,
      count(DISTINCT session_id)::bigint AS eligible_sessions
    FROM eligible_explicit_sessions
    GROUP BY student_id
  ),
  explicit_attendance AS (
    SELECT
      es.student_id,
      count(DISTINCT a.session_id) FILTER (WHERE a.status = 'approved')::bigint AS approved_sessions,
      count(DISTINCT a.session_id) FILTER (WHERE a.status = 'pending')::bigint AS pending_sessions,
      count(DISTINCT a.session_id) FILTER (WHERE a.status = 'rejected')::bigint AS rejected_sessions
    FROM eligible_explicit_sessions es
    JOIN base b
      ON b.student_id = es.student_id
    JOIN public.student_attendance a
      ON a.student_id = es.student_id
     AND a.session_id = es.session_id
     AND a.batch = b.batch
    GROUP BY es.student_id
  )
  SELECT
    b.student_id,
    b.student_name,
    b.batch,
    b.assignment_expected,
    b.assignment_completed,
    b.project_expected,
    b.project_completed,
    CASE
      WHEN esm.has_explicit_sessions THEN COALESCE(es.eligible_sessions, 0)
      ELSE b.eligible_working_days
    END,
    CASE
      WHEN esm.has_explicit_sessions THEN COALESCE(ea.approved_sessions, 0)
      ELSE b.approved_attendance_days
    END,
    CASE
      WHEN esm.has_explicit_sessions THEN COALESCE(ea.pending_sessions, 0)
      ELSE b.pending_attendance_days
    END,
    CASE
      WHEN esm.has_explicit_sessions THEN COALESCE(ea.rejected_sessions, 0)
      ELSE b.rejected_attendance_days
    END,
    b.assignment_completion_percentage,
    b.project_completion_percentage,
    CASE
      WHEN NOT esm.has_explicit_sessions THEN b.attendance_percentage
      ELSE round((COALESCE(ea.approved_sessions, 0)::numeric / NULLIF(COALESCE(es.eligible_sessions, 0), 0)::numeric) * 100, 2)
    END,
    b.assignment_points,
    b.project_points,
    b.attendance_points,
    b.total_points,
    b.final_score_at,
    b.batch_rank
  FROM base b
  CROSS JOIN explicit_session_mode esm
  LEFT JOIN explicit_sessions es ON es.student_id = b.student_id
  LEFT JOIN explicit_attendance ea ON ea.student_id = b.student_id
  ORDER BY b.batch_rank, b.student_id;
$$;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard_legacy(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard_legacy(text, date) TO service_role;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date) TO service_role;

REVOKE ALL ON FUNCTION public.cf_get_student_health_card(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_get_student_health_card(uuid, date) TO service_role;

COMMIT;
