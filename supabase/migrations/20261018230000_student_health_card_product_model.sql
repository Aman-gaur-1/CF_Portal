-- Student Health Card product model.
--
-- Prepared locally for staging review only. This migration is additive: it
-- does not rewrite submissions, attendance, memberships, or credentials.
-- Do not apply it to production as part of this refactor review.

BEGIN;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS login_id text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS external_student_id text;

CREATE UNIQUE INDEX IF NOT EXISTS students_login_id_unique_idx
  ON public.students (lower(btrim(login_id)))
  WHERE login_id IS NOT NULL AND btrim(login_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS students_batch_external_id_unique_idx
  ON public.students (batch, lower(btrim(external_student_id)))
  WHERE external_student_id IS NOT NULL AND btrim(external_student_id) <> '';

CREATE TABLE IF NOT EXISTS public.batch_coursework_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch text NOT NULL,
  coursework_item_id uuid NOT NULL REFERENCES public.coursework_items(id) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL DEFAULT now(),
  activated_by_role text NOT NULL,
  activated_by_name text NOT NULL,
  due_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_coursework_assignment_role_check CHECK (activated_by_role IN ('admin', 'teacher', 'system')),
  CONSTRAINT batch_coursework_assignment_unique_item UNIQUE (batch, coursework_item_id)
);

CREATE INDEX IF NOT EXISTS batch_coursework_assignments_batch_active_idx
  ON public.batch_coursework_assignments (batch, active, activated_at DESC);

CREATE INDEX IF NOT EXISTS batch_coursework_assignments_item_idx
  ON public.batch_coursework_assignments (coursework_item_id, active);

CREATE TABLE IF NOT EXISTS public.student_roster_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch text NOT NULL,
  original_filename text NOT NULL,
  file_hash text,
  uploaded_by_role text NOT NULL,
  uploaded_by_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  existing_count integer NOT NULL DEFAULT 0,
  possible_duplicate_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  row_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT student_roster_import_role_check CHECK (uploaded_by_role = 'admin'),
  CONSTRAINT student_roster_import_status_check CHECK (status IN ('preview', 'completed', 'failed'))
);

ALTER TABLE public.batch_coursework_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_roster_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batch_coursework_assignments_deny_public ON public.batch_coursework_assignments;
CREATE POLICY batch_coursework_assignments_deny_public ON public.batch_coursework_assignments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS student_roster_imports_deny_public ON public.student_roster_imports;
CREATE POLICY student_roster_imports_deny_public ON public.student_roster_imports
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.batch_coursework_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.student_roster_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_coursework_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_roster_imports TO service_role;

-- Leaderboard points are coursework-only. Attendance is included by the
-- student-facing total but never changes rank or top-10 ordering.
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
    SELECT s.id, s.name, s.batch, s.created_at
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
    SELECT bs.id AS student_id, bs.name AS student_name, bs.batch,
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
    SELECT bm.*, row_number() OVER (
      ORDER BY bm.total_points DESC, coalesce(bm.assignment_completed + bm.project_completed, 0) DESC,
        bm.final_score_at ASC NULLS LAST, bm.student_id ASC
    )::bigint AS batch_rank
    FROM base_metrics bm
  )
  SELECT student_id, student_name, batch, assignment_expected, assignment_completed,
    project_expected, project_completed, eligible_working_days, approved_attendance_days,
    pending_attendance_days, rejected_attendance_days, assignment_completion_percentage,
    project_completion_percentage, attendance_percentage, assignment_points, project_points,
    attendance_points, total_points, final_score_at, batch_rank
  FROM ranked ORDER BY batch_rank, student_id;
$$;

CREATE OR REPLACE FUNCTION public.cf_get_student_health_card(
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
  v_as_of date := GREATEST(COALESCE(p_as_of_date, (now() AT TIME ZONE 'Asia/Kolkata')::date), DATE '2026-10-01');
  v_current jsonb;
  v_current_leaderboard jsonb;
  v_top10 jsonb;
BEGIN
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'studentId', l.student_id, 'name', l.student_name, 'batch', l.batch, 'rank', l.batch_rank,
    'courseworkPoints', l.total_points, 'totalPoints', l.total_points + l.attendance_points,
    'assignmentCompletionPercentage', l.assignment_completion_percentage,
    'projectCompletionPercentage', l.project_completion_percentage, 'attendancePercentage', l.attendance_percentage,
    'assignmentPoints', l.assignment_points, 'projectPoints', l.project_points, 'attendancePoints', l.attendance_points,
    'assignmentExpected', l.assignment_expected, 'assignmentCompleted', l.assignment_completed,
    'assignmentPending', greatest(l.assignment_expected - l.assignment_completed, 0),
    'projectExpected', l.project_expected, 'projectCompleted', l.project_completed,
    'projectPending', greatest(l.project_expected - l.project_completed, 0),
    'eligibleWorkingDays', l.eligible_working_days, 'approvedAttendanceDays', l.approved_attendance_days,
    'pendingAttendanceDays', l.pending_attendance_days, 'rejectedAttendanceDays', l.rejected_attendance_days,
    'finalScoreAt', l.final_score_at
  ) INTO v_current
  FROM public.cf_health_card_leaderboard(v_student.batch, v_as_of) l
  WHERE l.student_id = v_student.id;

  SELECT jsonb_build_object(
    'rank', l.batch_rank, 'studentId', l.student_id, 'name', l.student_name,
    'totalPoints', l.total_points, 'courseworkPoints', l.total_points,
    'assignmentCompletionPercentage', l.assignment_completion_percentage,
    'attendancePercentage', l.attendance_percentage
  ) INTO v_current_leaderboard
  FROM public.cf_health_card_leaderboard(v_student.batch, v_as_of) l
  WHERE l.student_id = v_student.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', l.batch_rank, 'studentId', l.student_id, 'name', l.student_name,
    'totalPoints', l.total_points, 'courseworkPoints', l.total_points,
    'assignmentCompletionPercentage', l.assignment_completion_percentage,
    'attendancePercentage', l.attendance_percentage
  ) ORDER BY l.batch_rank), '[]'::jsonb)
  INTO v_top10
  FROM public.cf_health_card_leaderboard(v_student.batch, v_as_of) l
  WHERE l.batch_rank <= 10;

  RETURN jsonb_build_object(
    'epochStart', '2026-10-01', 'timezone', 'Asia/Kolkata',
    'student', jsonb_build_object('id', v_student.id, 'name', v_student.name, 'batch', v_student.batch),
    'metrics', coalesce(v_current, jsonb_build_object(
      'studentId', v_student.id, 'name', v_student.name, 'batch', v_student.batch,
      'rank', NULL, 'courseworkPoints', 0, 'totalPoints', 0, 'assignmentCompletionPercentage', NULL,
      'projectCompletionPercentage', NULL, 'attendancePercentage', NULL, 'assignmentPoints', 0,
      'projectPoints', 0, 'attendancePoints', 0, 'assignmentExpected', 0, 'assignmentCompleted', 0,
      'assignmentPending', 0, 'projectExpected', 0, 'projectCompleted', 0, 'projectPending', 0,
      'eligibleWorkingDays', 0, 'approvedAttendanceDays', 0, 'pendingAttendanceDays', 0,
      'rejectedAttendanceDays', 0, 'finalScoreAt', NULL
    )),
    'leaderboard', jsonb_build_object('top10', v_top10, 'current', v_current_leaderboard)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cf_get_student_health_card(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.cf_get_student_health_card(uuid, date) TO service_role;

COMMIT;
