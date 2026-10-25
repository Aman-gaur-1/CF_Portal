-- Student lifecycle management.
-- Additive only: preserves submissions, attendance, memberships, and credentials.
-- Deactivation is the default lifecycle action; permanent deletion is restricted
-- to students with no meaningful history by a service-role transaction.

BEGIN;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by text;

UPDATE public.students
SET status_changed_at = COALESCE(status_changed_at, created_at),
    status_changed_by = COALESCE(status_changed_by, 'migration')
WHERE status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_status_check'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS students_status_batch_idx
  ON public.students (status, batch, created_at DESC);

-- Current ranks exclude inactive students, while the row is retained with a
-- NULL rank so staff Health Card views can still show historical metrics.
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
  WITH params AS (
    SELECT DATE '2026-10-01' AS epoch,
      GREATEST(COALESCE(p_as_of_date, (now() AT TIME ZONE 'Asia/Kolkata')::date), DATE '2026-10-01') AS as_of_date,
      NULLIF(btrim(p_batch), '') AS batch_name
  ),
  point_scale AS (
    SELECT
      coalesce(max(points) FILTER (WHERE activity_type = 'assignment'), 0)::numeric AS assignment_points,
      coalesce(max(points) FILTER (WHERE activity_type = 'project'), 0)::numeric AS project_points,
      coalesce(max(points) FILTER (WHERE activity_type = 'attendance'), 0)::numeric AS attendance_points
    FROM public.point_rules r CROSS JOIN params p
    WHERE r.active
      AND r.effective_from <= p.as_of_date
      AND (r.effective_to IS NULL OR p.as_of_date < r.effective_to)
  ),
  batch_students AS (
    SELECT s.id, s.name, s.batch, s.created_at, s.status
    FROM public.students s CROSS JOIN params p
    WHERE s.batch = p.batch_name
  ),
  memberships AS (
    SELECT bs.id AS student_id, bs.batch,
      GREATEST(p.epoch, COALESCE((
        SELECT m.starts_on FROM public.student_batch_memberships m
        WHERE m.student_id = bs.id AND m.batch = bs.batch
          AND m.starts_on <= p.as_of_date
          AND (m.ends_on IS NULL OR m.ends_on > p.as_of_date)
        ORDER BY m.starts_on DESC, m.created_at DESC LIMIT 1
      ), (bs.created_at AT TIME ZONE 'Asia/Kolkata')::date, p.epoch)) AS eligible_from,
      (SELECT m.ends_on FROM public.student_batch_memberships m
       WHERE m.student_id = bs.id AND m.batch = bs.batch
         AND m.starts_on <= p.as_of_date
         AND (m.ends_on IS NULL OR m.ends_on > p.as_of_date)
       ORDER BY m.starts_on DESC, m.created_at DESC LIMIT 1) AS eligible_to
    FROM batch_students bs CROSS JOIN params p
  ),
  active_assignments AS (
    SELECT a.batch, a.coursework_item_id AS item_id, c.item_type, c.phase, c.due_at, a.activated_at
    FROM public.batch_coursework_assignments a
    JOIN public.coursework_items c ON c.id = a.coursework_item_id
    CROSS JOIN params p
    WHERE a.batch = p.batch_name
      AND a.active
      AND c.active
      AND (a.activated_at AT TIME ZONE 'Asia/Kolkata')::date <= p.as_of_date
      AND lower(btrim(c.item_type)) IN ('assignment', 'project')
  ),
  expected AS (
    SELECT count(*) FILTER (WHERE item_type = 'assignment')::bigint AS assignment_expected,
      count(*) FILTER (WHERE item_type = 'project')::bigint AS project_expected
    FROM active_assignments
  ),
  eligible_submissions AS (
    SELECT s.id, s.student_id, s.batch, s.coursework_item_id, s.submitted_at,
      CASE lower(btrim(coalesce(s.submission_type, '')))
        WHEN 'assignment' THEN 'assignment' WHEN '100' THEN 'assignment'
        WHEN 'project' THEN 'project' WHEN '200' THEN 'project' ELSE NULL END AS submission_type
    FROM public.submissions s
    JOIN memberships m ON m.student_id = s.student_id AND m.batch = s.batch
    CROSS JOIN params p
    WHERE s.submitted_at IS NOT NULL
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.epoch AND p.as_of_date
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= m.eligible_from
      AND (m.eligible_to IS NULL OR (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date < m.eligible_to)
  ),
  canonical_linked_candidates AS (
    SELECT es.id, es.student_id, es.batch, es.submitted_at, c.id AS item_id, lower(btrim(c.item_type)) AS item_type
    FROM eligible_submissions es
    JOIN public.coursework_items c ON c.id = es.coursework_item_id
      AND (c.batch IS NULL OR c.batch = es.batch)
      AND lower(btrim(c.item_type)) = es.submission_type
    WHERE c.active OR (c.deactivated_at IS NOT NULL AND es.submitted_at < c.deactivated_at)
  ),
  canonical_awards AS (
    SELECT id, student_id, batch, submitted_at, item_id, item_type
    FROM (
      SELECT clc.*, row_number() OVER (PARTITION BY clc.student_id, clc.item_id ORDER BY clc.submitted_at, clc.id) AS item_row
      FROM canonical_linked_candidates clc
    ) ranked WHERE item_row = 1
  ),
  coursework_totals AS (
    SELECT bs.id AS student_id,
      count(ca.item_id) FILTER (WHERE ca.item_type = 'assignment' AND aa.item_id IS NOT NULL)::bigint AS assignment_completed,
      count(ca.item_id) FILTER (WHERE ca.item_type = 'project' AND aa.item_id IS NOT NULL)::bigint AS project_completed,
      max(ca.submitted_at) AS last_coursework_at
    FROM batch_students bs
    LEFT JOIN canonical_awards ca ON ca.student_id = bs.id AND ca.batch = bs.batch
    LEFT JOIN active_assignments aa ON aa.item_id = ca.item_id AND aa.batch = bs.batch
    GROUP BY bs.id
  ),
  eligible_session_dates AS (
    SELECT DISTINCT m.student_id, s.session_date
    FROM memberships m
    JOIN public.attendance_sessions s ON s.batch = m.batch
      AND s.source <> 'legacy_backfill'
      AND s.session_date >= m.eligible_from
      AND (m.eligible_to IS NULL OR s.session_date < m.eligible_to)
    CROSS JOIN params p
    WHERE s.session_date BETWEEN p.epoch AND p.as_of_date
  ),
  daily_attendance AS (
    SELECT esd.student_id, esd.session_date,
      max(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) AS approved,
      max(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      max(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      max(coalesce(a.reviewed_at, a.updated_at, a.marked_at)) AS latest_at
    FROM eligible_session_dates esd
    LEFT JOIN public.student_attendance a ON a.student_id = esd.student_id
      AND a.batch = (SELECT batch_name FROM params)
      AND a.attendance_date = esd.session_date
      AND a.session_id IS NOT NULL
    GROUP BY esd.student_id, esd.session_date
  ),
  attendance_totals AS (
    SELECT bs.id AS student_id,
      count(da.session_date)::bigint AS tracked_days,
      count(da.session_date) FILTER (WHERE da.approved = 1)::bigint AS approved_days,
      count(da.session_date) FILTER (WHERE da.approved = 0 AND da.pending = 1)::bigint AS pending_days,
      count(da.session_date) FILTER (WHERE da.approved = 0 AND da.pending = 0 AND da.rejected = 1)::bigint AS rejected_days,
      max(da.latest_at) FILTER (WHERE da.approved = 1) AS last_attendance_at
    FROM batch_students bs
    LEFT JOIN daily_attendance da ON da.student_id = bs.id
    GROUP BY bs.id
  ),
  base_metrics AS (
    SELECT bs.id AS student_id, bs.name AS student_name, bs.batch, bs.status,
      e.assignment_expected, coalesce(ct.assignment_completed, 0)::bigint AS assignment_completed,
      e.project_expected, coalesce(ct.project_completed, 0)::bigint AS project_completed,
      coalesce(at.tracked_days, 0)::bigint AS eligible_working_days,
      coalesce(at.approved_days, 0)::bigint AS approved_attendance_days,
      coalesce(at.pending_days, 0)::bigint AS pending_attendance_days,
      coalesce(at.rejected_days, 0)::bigint AS rejected_attendance_days,
      round((coalesce(ct.assignment_completed, 0)::numeric / nullif(e.assignment_expected, 0)) * 100, 2) AS assignment_completion_percentage,
      round((coalesce(ct.project_completed, 0)::numeric / nullif(e.project_expected, 0)) * 100, 2) AS project_completion_percentage,
      round((coalesce(at.approved_days, 0)::numeric / nullif(at.tracked_days, 0)) * 100, 2) AS attendance_percentage,
      coalesce(ct.assignment_completed, 0)::numeric * ps.assignment_points AS assignment_points,
      coalesce(ct.project_completed, 0)::numeric * ps.project_points AS project_points,
      coalesce(at.approved_days, 0)::numeric * ps.attendance_points AS attendance_points,
      (coalesce(ct.assignment_completed, 0)::numeric * ps.assignment_points
        + coalesce(ct.project_completed, 0)::numeric * ps.project_points)::numeric AS total_points,
      CASE WHEN ct.last_coursework_at IS NULL THEN at.last_attendance_at
        WHEN at.last_attendance_at IS NULL THEN ct.last_coursework_at
        ELSE GREATEST(ct.last_coursework_at, at.last_attendance_at) END AS final_score_at
    FROM batch_students bs CROSS JOIN expected e CROSS JOIN point_scale ps
    LEFT JOIN coursework_totals ct ON ct.student_id = bs.id
    LEFT JOIN attendance_totals at ON at.student_id = bs.id
  ),
  ranked AS (
    SELECT bm.*,
      CASE WHEN bm.status = 'active' THEN row_number() OVER (
        PARTITION BY bm.status
        ORDER BY bm.total_points DESC, coalesce(bm.assignment_completed + bm.project_completed, 0) DESC,
          bm.final_score_at ASC NULLS LAST, bm.student_id ASC
      )::bigint ELSE NULL::bigint END AS batch_rank
    FROM base_metrics bm
  )
  SELECT student_id, student_name, batch, assignment_expected, assignment_completed,
    project_expected, project_completed, eligible_working_days, approved_attendance_days,
    pending_attendance_days, rejected_attendance_days, assignment_completion_percentage,
    project_completion_percentage, attendance_percentage, assignment_points, project_points,
    attendance_points, total_points, final_score_at, batch_rank
  FROM ranked ORDER BY batch_rank NULLS LAST, student_id;
$$;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date) TO service_role;

-- Service-role-only transactional delete. Memberships and identity aliases are
-- safe setup rows; submissions, attendance, queries, and attendance links are
-- meaningful history and block deletion.
CREATE OR REPLACE FUNCTION public.cf_delete_zero_history_student(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_submissions bigint := 0;
  v_attendance bigint := 0;
  v_queries bigint := 0;
  v_linked_attendance bigint := 0;
  v_suggested_attendance bigint := 0;
  v_users bigint := 0;
  v_memberships bigint := 0;
  v_aliases bigint := 0;
  v_roster_imports bigint := 0;
BEGIN
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  IF to_regclass('public.submissions') IS NOT NULL THEN
    SELECT count(*) INTO v_submissions FROM public.submissions WHERE student_id = p_student_id;
  END IF;
  IF to_regclass('public.student_attendance') IS NOT NULL THEN
    SELECT count(*) INTO v_attendance FROM public.student_attendance WHERE student_id = p_student_id;
  END IF;
  IF to_regclass('public.assignment_queries') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.assignment_queries WHERE student_id = $1' INTO v_queries USING p_student_id;
  END IF;
  IF to_regclass('public.unlinked_attendance') IS NOT NULL THEN
    SELECT count(*) INTO v_linked_attendance FROM public.unlinked_attendance WHERE linked_student_id = p_student_id;
    SELECT count(*) INTO v_suggested_attendance FROM public.unlinked_attendance WHERE suggested_student_id = p_student_id;
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.users WHERE student_id = $1::text' INTO v_users USING p_student_id;
  END IF;
  IF to_regclass('public.student_batch_memberships') IS NOT NULL THEN
    SELECT count(*) INTO v_memberships FROM public.student_batch_memberships WHERE student_id = p_student_id;
  END IF;
  IF to_regclass('public.student_identity_aliases') IS NOT NULL THEN
    SELECT count(*) INTO v_aliases FROM public.student_identity_aliases WHERE student_id = p_student_id;
  END IF;
  IF to_regclass('public.student_roster_imports') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.student_roster_imports WHERE jsonb_typeof(row_results) = ''array'' AND jsonb_array_length(row_results) = 1 AND row_results->0->>''studentId'' = $1' INTO v_roster_imports USING p_student_id::text;
  END IF;

  IF v_submissions + v_attendance + v_queries + v_linked_attendance + v_suggested_attendance + v_users > 0 THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'reason', 'history',
      'dependencies', jsonb_build_object(
        'submissions', v_submissions,
        'attendance', v_attendance,
        'queries', v_queries,
        'linkedAttendance', v_linked_attendance,
        'suggestedAttendance', v_suggested_attendance,
        'users', v_users,
        'memberships', v_memberships,
        'aliases', v_aliases,
        'rosterImports', v_roster_imports
      )
    );
  END IF;

  IF to_regclass('public.student_batch_memberships') IS NOT NULL THEN
    DELETE FROM public.student_batch_memberships WHERE student_id = p_student_id;
  END IF;
  IF to_regclass('public.student_identity_aliases') IS NOT NULL THEN
    DELETE FROM public.student_identity_aliases WHERE student_id = p_student_id;
  END IF;
  IF to_regclass('public.student_roster_imports') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.student_roster_imports WHERE jsonb_typeof(row_results) = ''array'' AND jsonb_array_length(row_results) = 1 AND row_results->0->>''studentId'' = $1' USING p_student_id::text;
  END IF;
  DELETE FROM public.students WHERE id = p_student_id;

  RETURN jsonb_build_object('deleted', true, 'studentId', p_student_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cf_delete_zero_history_student(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_delete_zero_history_student(uuid) TO service_role;

COMMIT;
