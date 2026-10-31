-- Unified canonical coursework scoring.
--
-- Historical submission_type values are preserved for audit. Canonical item
-- identity and confirmed reconciliation identity are the only scoring keys.
-- Attendance remains a separate Health Card component and never contributes to
-- the coursework leaderboard rank.

BEGIN;

ALTER TABLE public.student_coursework_reconciliations
  DROP CONSTRAINT IF EXISTS student_coursework_reconciliation_no_points_check;

CREATE INDEX IF NOT EXISTS student_coursework_reconciliations_scoring_idx
  ON public.student_coursework_reconciliations
    (student_id, batch, coursework_item_id, status, counts_for_progress);

-- Promote eligible confirmed canonical evidence to the explicit point-bearing
-- flag. The functions below intentionally do not rely on this flag alone.
UPDATE public.student_coursework_reconciliations r
SET counts_for_points = true,
    updated_at = now()
FROM public.students s,
     public.coursework_items c
WHERE r.student_id = s.id
  AND c.id = r.coursework_item_id
  AND r.status = 'confirmed'
  AND r.counts_for_progress
  AND r.confidence IN ('confirmed', 'high_confidence')
  AND c.catalog_status = 'canonical'
  AND lower(btrim(c.item_type)) = lower(btrim(r.item_type))
  AND (c.batch IS NULL OR c.batch = s.batch OR c.batch = r.batch);

CREATE OR REPLACE FUNCTION public.cf_enforce_canonical_submission_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item_type text;
BEGIN
  IF NEW.coursework_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(btrim(COALESCE(canonical.item_type, source.item_type)))
  INTO v_item_type
  FROM public.coursework_items source
  LEFT JOIN public.coursework_items canonical
    ON canonical.id = source.canonical_coursework_item_id
  WHERE source.id = NEW.coursework_item_id
    AND (
      source.catalog_status = 'canonical'
      OR source.canonical_coursework_item_id IS NOT NULL
    )
    AND lower(btrim(COALESCE(canonical.item_type, source.item_type))) IN ('assignment', 'project');

  IF v_item_type IS NOT NULL THEN
    NEW.submission_type := v_item_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submissions_canonical_type_guard ON public.submissions;
CREATE TRIGGER submissions_canonical_type_guard
BEFORE INSERT OR UPDATE OF coursework_item_id, submission_type
ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.cf_enforce_canonical_submission_type();

CREATE OR REPLACE FUNCTION public.cf_health_card_leaderboard_scored_base(
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
  WITH params AS (
    SELECT
      COALESCE(p_as_of_date, (now() AT TIME ZONE 'Asia/Kolkata')::date) AS as_of_date,
      NULLIF(btrim(p_batch), '') AS batch_name
  ),
  batch_students AS (
    SELECT s.id, s.name, s.batch, s.created_at, s.status
    FROM public.students s
    CROSS JOIN params p
    WHERE s.batch = p.batch_name
  ),
  active_students AS (
    SELECT * FROM batch_students WHERE status = 'active'
  ),
  memberships AS (
    SELECT
      bs.id AS student_id,
      bs.batch,
      COALESCE(
        (
          SELECT m.starts_on
          FROM public.student_batch_memberships m
          WHERE m.student_id = bs.id
            AND m.batch = bs.batch
            AND m.starts_on <= p.as_of_date
            AND (m.ends_on IS NULL OR m.ends_on > p.as_of_date)
          ORDER BY m.starts_on DESC, m.created_at DESC
          LIMIT 1
        ),
        (bs.created_at AT TIME ZONE 'Asia/Kolkata')::date
      ) AS eligible_from,
      (
        SELECT m.ends_on
        FROM public.student_batch_memberships m
        WHERE m.student_id = bs.id
          AND m.batch = bs.batch
          AND m.starts_on <= p.as_of_date
          AND (m.ends_on IS NULL OR m.ends_on > p.as_of_date)
        ORDER BY m.starts_on DESC, m.created_at DESC
        LIMIT 1
      ) AS eligible_to
    FROM active_students bs
    CROSS JOIN params p
  ),
  point_scale AS (
    SELECT
      5::numeric AS assignment_points,
      10::numeric AS project_points,
      COALESCE(
        MAX(r.points) FILTER (WHERE r.activity_type = 'attendance'),
        1
      )::numeric AS attendance_points
    FROM public.point_rules r
    CROSS JOIN params p
    WHERE r.active
      AND r.effective_from <= p.as_of_date
      AND (r.effective_to IS NULL OR p.as_of_date < r.effective_to)
  ),
  active_assignments AS (
    SELECT
      a.batch,
      a.coursework_item_id AS item_id,
      lower(btrim(c.item_type)) AS item_type,
      a.activated_at
    FROM public.batch_coursework_assignments a
    JOIN public.coursework_items c ON c.id = a.coursework_item_id
    CROSS JOIN params p
    WHERE a.batch = p.batch_name
      AND a.active
      AND c.catalog_status = 'canonical'
      AND c.active
      AND (a.activated_at AT TIME ZONE 'Asia/Kolkata')::date <= p.as_of_date
      AND lower(btrim(c.item_type)) IN ('assignment', 'project')
  ),
  expected AS (
    SELECT
      COUNT(*) FILTER (WHERE item_type = 'assignment')::bigint AS assignment_expected,
      COUNT(*) FILTER (WHERE item_type = 'project')::bigint AS project_expected
    FROM active_assignments
  ),
  canonical_catalog AS (
    SELECT
      c.id AS item_id,
      lower(btrim(c.item_type)) AS item_type,
      c.batch,
      c.active,
      c.deactivated_at
    FROM public.coursework_items c
    WHERE c.catalog_status = 'canonical'
      AND lower(btrim(c.item_type)) IN ('assignment', 'project')
  ),
  direct_completion_candidates AS (
    SELECT
      s.student_id,
      s.batch,
      cc.item_id,
      cc.item_type,
      s.submitted_at AS completed_at
    FROM public.submissions s
    JOIN active_students bs
      ON bs.id = s.student_id
     AND bs.batch = s.batch
    JOIN public.coursework_items source_item
      ON source_item.id = s.coursework_item_id
    JOIN canonical_catalog cc
      ON cc.item_id = CASE
        WHEN source_item.catalog_status = 'canonical' THEN source_item.id
        ELSE source_item.canonical_coursework_item_id
      END
    WHERE s.coursework_item_id IS NOT NULL
      AND (source_item.batch IS NULL OR source_item.batch = s.batch)
      AND (cc.batch IS NULL OR cc.batch = s.batch)
      AND (
        source_item.active
        OR source_item.deactivated_at IS NOT NULL
        OR cc.active
      )
  ),
  reconciled_completion_candidates AS (
    SELECT
      r.student_id,
      bs.batch,
      cc.item_id,
      cc.item_type,
      COALESCE(r.confirmed_at, r.updated_at, r.created_at) AS completed_at
    FROM public.student_coursework_reconciliations r
    JOIN active_students bs
      ON bs.id = r.student_id
    JOIN canonical_catalog cc ON cc.item_id = r.coursework_item_id
    WHERE r.status = 'confirmed'
      AND r.counts_for_progress
      AND r.confidence IN ('confirmed', 'high_confidence')
      AND lower(btrim(r.item_type)) = cc.item_type
      AND (cc.batch IS NULL OR cc.batch = r.batch)
  ),
  recognized_completion_candidates AS (
    SELECT * FROM direct_completion_candidates
    UNION ALL
    SELECT * FROM reconciled_completion_candidates
  ),
  recognized_completions AS (
    SELECT DISTINCT ON (student_id, item_id)
      student_id,
      batch,
      item_id,
      item_type,
      completed_at
    FROM recognized_completion_candidates
    ORDER BY student_id, item_id, completed_at NULLS LAST
  ),
  coursework_totals AS (
    SELECT
      bs.id AS student_id,
      COUNT(rc.item_id) FILTER (WHERE rc.item_type = 'assignment')::bigint AS assignment_completed,
      COUNT(rc.item_id) FILTER (WHERE rc.item_type = 'project')::bigint AS project_completed,
      COALESCE(SUM(CASE rc.item_type WHEN 'assignment' THEN 5 WHEN 'project' THEN 10 ELSE 0 END), 0)::numeric AS coursework_points,
      MAX(rc.completed_at) AS last_coursework_at
    FROM active_students bs
    LEFT JOIN recognized_completions rc
      ON rc.student_id = bs.id
     AND rc.batch = bs.batch
    GROUP BY bs.id
  ),
  eligible_session_dates AS (
    SELECT DISTINCT m.student_id, s.session_date
    FROM memberships m
    JOIN public.attendance_sessions s
      ON s.batch = m.batch
     AND s.source <> 'legacy_backfill'
     AND s.session_date >= m.eligible_from
     AND (m.eligible_to IS NULL OR s.session_date < m.eligible_to)
    CROSS JOIN params p
    WHERE s.session_date <= p.as_of_date
  ),
  daily_attendance AS (
    SELECT
      esd.student_id,
      esd.session_date,
      MAX(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) AS approved,
      MAX(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      MAX(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      MAX(COALESCE(a.reviewed_at, a.updated_at, a.marked_at)) AS latest_at
    FROM eligible_session_dates esd
    LEFT JOIN public.student_attendance a
      ON a.student_id = esd.student_id
     AND a.batch = (SELECT batch_name FROM params)
     AND a.attendance_date = esd.session_date
     AND a.session_id IS NOT NULL
    GROUP BY esd.student_id, esd.session_date
  ),
  attendance_totals AS (
    SELECT
      bs.id AS student_id,
      COUNT(da.session_date)::bigint AS tracked_days,
      COUNT(da.session_date) FILTER (WHERE da.approved = 1)::bigint AS approved_days,
      COUNT(da.session_date) FILTER (WHERE da.approved = 0 AND da.pending = 1)::bigint AS pending_days,
      COUNT(da.session_date) FILTER (WHERE da.approved = 0 AND da.pending = 0 AND da.rejected = 1)::bigint AS rejected_days,
      MAX(da.latest_at) FILTER (WHERE da.approved = 1) AS last_attendance_at
    FROM active_students bs
    LEFT JOIN daily_attendance da ON da.student_id = bs.id
    GROUP BY bs.id
  ),
  base_metrics AS (
    SELECT
      bs.id AS student_id,
      bs.name AS student_name,
      bs.batch,
      e.assignment_expected,
      COALESCE(ct.assignment_completed, 0)::bigint AS assignment_completed,
      e.project_expected,
      COALESCE(ct.project_completed, 0)::bigint AS project_completed,
      COALESCE(at.tracked_days, 0)::bigint AS eligible_working_days,
      COALESCE(at.approved_days, 0)::bigint AS approved_attendance_days,
      COALESCE(at.pending_days, 0)::bigint AS pending_attendance_days,
      COALESCE(at.rejected_days, 0)::bigint AS rejected_attendance_days,
      ROUND((COALESCE(ct.assignment_completed, 0)::numeric / NULLIF(e.assignment_expected, 0)) * 100, 2) AS assignment_completion_percentage,
      ROUND((COALESCE(ct.project_completed, 0)::numeric / NULLIF(e.project_expected, 0)) * 100, 2) AS project_completion_percentage,
      ROUND((COALESCE(at.approved_days, 0)::numeric / NULLIF(at.tracked_days, 0)) * 100, 2) AS attendance_percentage,
      COALESCE(ct.assignment_completed, 0)::numeric * ps.assignment_points AS assignment_points,
      COALESCE(ct.project_completed, 0)::numeric * ps.project_points AS project_points,
      COALESCE(at.approved_days, 0)::numeric * ps.attendance_points AS attendance_points,
      COALESCE(ct.coursework_points, 0)::numeric AS total_points,
      CASE
        WHEN ct.last_coursework_at IS NULL THEN at.last_attendance_at
        WHEN at.last_attendance_at IS NULL THEN ct.last_coursework_at
        ELSE GREATEST(ct.last_coursework_at, at.last_attendance_at)
      END AS final_score_at
    FROM active_students bs
    CROSS JOIN expected e
    CROSS JOIN point_scale ps
    LEFT JOIN coursework_totals ct ON ct.student_id = bs.id
    LEFT JOIN attendance_totals at ON at.student_id = bs.id
  ),
  ranked AS (
    SELECT
      bm.*,
      ROW_NUMBER() OVER (
        ORDER BY bm.total_points DESC,
          (bm.assignment_completed + bm.project_completed) DESC,
          bm.final_score_at ASC NULLS LAST,
          bm.student_id ASC
      )::bigint AS batch_rank
    FROM base_metrics bm
  )
  SELECT
    student_id,
    student_name,
    batch,
    assignment_expected,
    assignment_completed,
    project_expected,
    project_completed,
    eligible_working_days,
    approved_attendance_days,
    pending_attendance_days,
    rejected_attendance_days,
    assignment_completion_percentage,
    project_completion_percentage,
    attendance_percentage,
    assignment_points,
    project_points,
    attendance_points,
    total_points,
    final_score_at,
    batch_rank
  FROM ranked;
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
    SELECT * FROM public.cf_health_card_leaderboard_scored_base(p_batch, p_as_of_date)
  ),
  positive_ranked AS (
    SELECT student_id, DENSE_RANK() OVER (ORDER BY total_points DESC)::bigint AS dense_rank
    FROM source_rows
    WHERE total_points > 0
  )
  SELECT
    s.student_id,
    s.student_name,
    s.batch,
    s.assignment_expected,
    s.assignment_completed,
    s.project_expected,
    s.project_completed,
    s.eligible_working_days,
    s.approved_attendance_days,
    s.pending_attendance_days,
    s.rejected_attendance_days,
    s.assignment_completion_percentage,
    s.project_completion_percentage,
    s.attendance_percentage,
    s.assignment_points,
    s.project_points,
    s.attendance_points,
    s.total_points,
    s.final_score_at,
    CASE WHEN s.total_points > 0 THEN r.dense_rank ELSE NULL::bigint END AS batch_rank
  FROM source_rows s
  LEFT JOIN positive_ranked r ON r.student_id = s.student_id
  ORDER BY batch_rank NULLS LAST, s.student_id;
$$;

CREATE OR REPLACE FUNCTION public.cf_get_student_health_card_scored_base(
  p_student_id uuid,
  p_as_of_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_as_of date := COALESCE(p_as_of_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_current jsonb;
  v_current_leaderboard jsonb;
  v_top10 jsonb;
BEGIN
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'studentId', l.student_id,
    'name', l.student_name,
    'batch', l.batch,
    'rank', l.batch_rank,
    'courseworkPoints', l.total_points,
    'totalPoints', l.total_points + l.attendance_points,
    'assignmentCompletionPercentage', l.assignment_completion_percentage,
    'projectCompletionPercentage', l.project_completion_percentage,
    'attendancePercentage', l.attendance_percentage,
    'assignmentPoints', l.assignment_points,
    'projectPoints', l.project_points,
    'attendancePoints', l.attendance_points,
    'assignmentExpected', l.assignment_expected,
    'assignmentCompleted', l.assignment_completed,
    'assignmentPending', GREATEST(l.assignment_expected - l.assignment_completed, 0),
    'projectExpected', l.project_expected,
    'projectCompleted', l.project_completed,
    'projectPending', GREATEST(l.project_expected - l.project_completed, 0),
    'eligibleWorkingDays', l.eligible_working_days,
    'approvedAttendanceDays', l.approved_attendance_days,
    'pendingAttendanceDays', l.pending_attendance_days,
    'rejectedAttendanceDays', l.rejected_attendance_days,
    'finalScoreAt', l.final_score_at
  ) INTO v_current
  FROM public.cf_health_card_leaderboard(v_student.batch, v_as_of) l
  WHERE l.student_id = v_student.id;

  SELECT jsonb_build_object(
    'rank', l.batch_rank,
    'studentId', l.student_id,
    'name', l.student_name,
    'totalPoints', l.total_points,
    'courseworkPoints', l.total_points,
    'assignmentCompletionPercentage', l.assignment_completion_percentage,
    'attendancePercentage', l.attendance_percentage
  ) INTO v_current_leaderboard
  FROM public.cf_health_card_leaderboard(v_student.batch, v_as_of) l
  WHERE l.student_id = v_student.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'rank', l.batch_rank,
    'studentId', l.student_id,
    'name', l.student_name,
    'totalPoints', l.total_points,
    'courseworkPoints', l.total_points,
    'assignmentCompletionPercentage', l.assignment_completion_percentage,
    'attendancePercentage', l.attendance_percentage
  ) ORDER BY l.batch_rank), '[]'::jsonb)
  INTO v_top10
  FROM public.cf_health_card_leaderboard(v_student.batch, v_as_of) l
  WHERE l.batch_rank <= 10;

  RETURN jsonb_build_object(
    'timezone', 'Asia/Kolkata',
    'student', jsonb_build_object('id', v_student.id, 'name', v_student.name, 'batch', v_student.batch),
    'metrics', COALESCE(v_current, jsonb_build_object(
      'studentId', v_student.id,
      'name', v_student.name,
      'batch', v_student.batch,
      'rank', NULL,
      'courseworkPoints', 0,
      'totalPoints', 0,
      'assignmentCompletionPercentage', NULL,
      'projectCompletionPercentage', NULL,
      'attendancePercentage', NULL,
      'assignmentPoints', 0,
      'projectPoints', 0,
      'attendancePoints', 0,
      'assignmentExpected', 0,
      'assignmentCompleted', 0,
      'assignmentPending', 0,
      'projectExpected', 0,
      'projectCompleted', 0,
      'projectPending', 0,
      'eligibleWorkingDays', 0,
      'approvedAttendanceDays', 0,
      'pendingAttendanceDays', 0,
      'rejectedAttendanceDays', 0,
      'finalScoreAt', NULL
    )),
    'leaderboard', jsonb_build_object('top10', v_top10, 'current', v_current_leaderboard)
  );
END;
$$;

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
    SELECT COUNT(*)::bigint AS ranked_student_count
    FROM public.cf_health_card_leaderboard(
      (SELECT payload->'student'->>'batch' FROM base),
      p_as_of_date
    )
    WHERE total_points > 0
  ),
  flags AS (
    SELECT (SELECT (payload->'metrics'->>'rank') IS NOT NULL FROM base) AS is_ranked
  )
  SELECT payload || jsonb_build_object(
    'metrics', COALESCE(payload->'metrics', '{}'::jsonb) || jsonb_build_object(
      'isRanked', flags.is_ranked,
      'rankedStudentCount', rank_summary.ranked_student_count,
      'courseworkPoints', COALESCE(payload->'metrics'->'courseworkPoints', '0'::jsonb),
      'currentCourseworkPoints', COALESCE(payload->'metrics'->'courseworkPoints', '0'::jsonb)
    ),
    'leaderboard', COALESCE(payload->'leaderboard', '{}'::jsonb) || jsonb_build_object(
      'isRanked', flags.is_ranked,
      'rankedStudentCount', rank_summary.ranked_student_count,
      'current', COALESCE(payload->'leaderboard'->'current', '{}'::jsonb) || jsonb_build_object(
        'isRanked', flags.is_ranked,
        'rankedStudentCount', rank_summary.ranked_student_count
      )
    )
  )
  FROM base CROSS JOIN rank_summary CROSS JOIN flags;
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
  IF p_submission_id IS NULL OR length(trim(COALESCE(p_feedback, ''))) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.submissions
  SET feedback = p_feedback,
      feedback_by = p_feedback_by,
      feedback_at = p_feedback_at,
      approval_method = CASE WHEN submissions.approval_at IS NULL THEN p_approval_method ELSE submissions.approval_method END,
      approval_at = COALESCE(submissions.approval_at, p_feedback_at),
      approved_by = COALESCE(submissions.approved_by, p_feedback_by),
      approved_at = COALESCE(submissions.approved_at, p_feedback_at),
      ai_workflow_state = 'published',
      ai_auto_approval_blocked_reason = NULL,
      auto_approval_due_at = NULL,
      review_active_by = NULL,
      review_active_at = NULL,
      -- Client-supplied p_submission_type is intentionally ignored. The
      -- canonical-type trigger enforces linked coursework on every write.
      phase = COALESCE(NULLIF(trim(COALESCE(p_phase, '')), ''), submissions.phase),
      ai_status = CASE WHEN length(trim(COALESCE(submissions.ai_feedback, ''))) > 0 THEN 'ready' ELSE submissions.ai_status END,
      ai_error = CASE WHEN length(trim(COALESCE(submissions.ai_feedback, ''))) > 0 THEN NULL ELSE submissions.ai_error END
  WHERE submissions.id = p_submission_id
    AND (
      p_allow_update_published = true
      OR (submissions.feedback_at IS NULL AND length(trim(COALESCE(submissions.feedback, ''))) = 0)
    )
    AND (
      p_require_ai_ready = false
      OR (submissions.ai_status = 'ready' AND length(trim(COALESCE(submissions.ai_feedback, ''))) > 0)
    )
    AND (
      p_require_due = false
      OR (submissions.auto_approval_due_at IS NOT NULL AND submissions.auto_approval_due_at <= now())
    )
  RETURNING submissions.*;
END;
$$;

REVOKE ALL ON FUNCTION public.cf_enforce_canonical_submission_type() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_enforce_canonical_submission_type() TO service_role;
REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard_scored_base(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard_scored_base(text, date) TO service_role;
REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date) TO service_role;
REVOKE ALL ON FUNCTION public.cf_get_student_health_card_scored_base(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_get_student_health_card_scored_base(uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.cf_get_student_health_card(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_get_student_health_card(uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.cf_publish_submission_feedback(bigint, text, text, text, timestamptz, text, text, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_publish_submission_feedback(bigint, text, text, text, timestamptz, text, text, boolean, boolean, boolean) TO service_role;

COMMIT;
