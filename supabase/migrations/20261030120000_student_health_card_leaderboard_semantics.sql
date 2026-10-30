-- Health Card presentation semantics only.
-- Scoring rules, historical submissions, attendance, and reconciliations are
-- intentionally read through the existing production functions unchanged.

DO $$
BEGIN
  IF to_regprocedure('public.cf_health_card_leaderboard(text,date)') IS NOT NULL
     AND to_regprocedure('public.cf_health_card_leaderboard_scored_base(text,date)') IS NULL THEN
    ALTER FUNCTION public.cf_health_card_leaderboard(text, date)
      RENAME TO cf_health_card_leaderboard_scored_base;
  END IF;

  IF to_regprocedure('public.cf_get_student_health_card(uuid,date)') IS NOT NULL
     AND to_regprocedure('public.cf_get_student_health_card_scored_base(uuid,date)') IS NULL THEN
    ALTER FUNCTION public.cf_get_student_health_card(uuid, date)
      RENAME TO cf_get_student_health_card_scored_base;
  END IF;
END;
$$;

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
  WITH source_rows AS (
    SELECT *
    FROM public.cf_health_card_leaderboard_scored_base(p_batch, p_as_of_date)
  ),
  positive_ranked AS (
    SELECT student_id,
      dense_rank() OVER (ORDER BY total_points DESC)::bigint AS dense_rank
    FROM source_rows
    WHERE total_points > 0
  )
  SELECT s.student_id, s.student_name, s.batch,
    s.assignment_expected, s.assignment_completed,
    s.project_expected, s.project_completed,
    s.eligible_working_days, s.approved_attendance_days,
    s.pending_attendance_days, s.rejected_attendance_days,
    s.assignment_completion_percentage, s.project_completion_percentage,
    s.attendance_percentage, s.assignment_points, s.project_points,
    s.attendance_points, s.total_points, s.final_score_at,
    CASE WHEN s.total_points > 0 THEN r.dense_rank ELSE NULL::bigint END AS batch_rank
  FROM source_rows s
  LEFT JOIN positive_ranked r ON r.student_id = s.student_id
  ORDER BY batch_rank NULLS LAST, s.student_id;
$$;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cf_get_student_health_card(
  p_student_id uuid,
  p_as_of_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT public.cf_get_student_health_card_scored_base(p_student_id, p_as_of_date) AS payload
  ),
  rank_summary AS (
    SELECT count(*)::bigint AS ranked_student_count
    FROM public.cf_health_card_leaderboard(
      (SELECT payload->'student'->>'batch' FROM base),
      p_as_of_date
    )
    WHERE total_points > 0
  ),
  flags AS (
    SELECT
      (SELECT (payload->'metrics'->>'rank') IS NOT NULL FROM base) AS is_ranked
  )
  SELECT payload || jsonb_build_object(
    'metrics', coalesce(payload->'metrics', '{}'::jsonb) || jsonb_build_object(
      'isRanked', flags.is_ranked,
      'rankedStudentCount', rank_summary.ranked_student_count,
      'currentCourseworkPoints', coalesce(payload->'metrics'->'courseworkPoints', '0'::jsonb)
    ),
    'leaderboard', coalesce(payload->'leaderboard', '{}'::jsonb) || jsonb_build_object(
      'isRanked', flags.is_ranked,
      'rankedStudentCount', rank_summary.ranked_student_count,
      'current', coalesce(payload->'leaderboard'->'current', '{}'::jsonb) || jsonb_build_object(
        'isRanked', flags.is_ranked,
        'rankedStudentCount', rank_summary.ranked_student_count
      )
    )
  )
  FROM base CROSS JOIN rank_summary CROSS JOIN flags;
$$;

REVOKE ALL ON FUNCTION public.cf_get_student_health_card(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_get_student_health_card(uuid, date)
  TO service_role;
