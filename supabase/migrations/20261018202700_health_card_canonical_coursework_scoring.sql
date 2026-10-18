-- Corrective Health Card scoring migration.
--
-- This migration is additive and does not rewrite coursework or attendance
-- data. It removes the legacy/raw-submission award fallback from the
-- session-aware leaderboard path. Only valid, batch-compatible,
-- type-compatible coursework_item_id links can earn Health Card coursework
-- points.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'coursework_items'
      AND column_name = 'deactivated_at'
  ) THEN
    RAISE EXCEPTION
      'coursework_items.deactivated_at is required; apply the archive-semantics migration first';
  END IF;
END
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
  WITH params AS (
    SELECT
      DATE '2026-10-01' AS epoch,
      GREATEST(
        COALESCE(p_as_of_date, (now() AT TIME ZONE 'Asia/Kolkata')::date),
        DATE '2026-10-01'
      ) AS as_of_date,
      NULLIF(btrim(p_batch), '') AS batch_name
  ),
  batch_students AS (
    SELECT s.id, s.name, s.batch, s.created_at
    FROM public.students s
    CROSS JOIN params p
    WHERE s.batch = p.batch_name
  ),
  memberships AS (
    SELECT
      bs.id AS student_id,
      bs.batch,
      GREATEST(
        p.epoch,
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
          (bs.created_at AT TIME ZONE 'Asia/Kolkata')::date,
          p.epoch
        )
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
    FROM batch_students bs
    CROSS JOIN params p
  ),
  all_catalog AS (
    SELECT
      c.id,
      c.batch,
      lower(btrim(c.item_type)) AS item_type,
      c.active,
      c.deactivated_at
    FROM public.coursework_items c
    CROSS JOIN params p
    WHERE (c.batch IS NULL OR c.batch = p.batch_name)
      AND lower(btrim(c.item_type)) IN ('assignment', 'project')
  ),
  active_catalog AS (
    SELECT *
    FROM all_catalog
    WHERE active
  ),
  expected AS (
    SELECT
      count(*) FILTER (WHERE item_type = 'assignment') AS assignment_expected,
      count(*) FILTER (WHERE item_type = 'project') AS project_expected
    FROM active_catalog
  ),
  calendar_totals AS (
    SELECT
      m.student_id,
      count(d.id) AS eligible_working_days
    FROM memberships m
    CROSS JOIN params p
    LEFT JOIN public.batch_calendar_days d
      ON d.batch = p.batch_name
     AND d.is_working_day
     AND d.calendar_date >= m.eligible_from
     AND d.calendar_date <= p.as_of_date
     AND (m.eligible_to IS NULL OR d.calendar_date < m.eligible_to)
    GROUP BY m.student_id
  ),
  eligible_submissions AS (
    SELECT
      s.id,
      s.student_id,
      s.batch,
      s.coursework_item_id,
      s.submitted_at,
      (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date AS activity_date,
      CASE lower(btrim(coalesce(s.submission_type, '')))
        WHEN 'assignment' THEN 'assignment'
        WHEN '100' THEN 'assignment'
        WHEN 'project' THEN 'project'
        WHEN '200' THEN 'project'
        ELSE NULL
      END AS submission_type
    FROM public.submissions s
    JOIN memberships m
      ON m.student_id = s.student_id
     AND m.batch = s.batch
    CROSS JOIN params p
    WHERE s.submitted_at IS NOT NULL
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= p.epoch
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= p.as_of_date
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= m.eligible_from
      AND (
        m.eligible_to IS NULL
        OR (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date < m.eligible_to
      )
  ),
  canonical_linked_candidates AS (
    SELECT
      es.id,
      es.student_id,
      es.submitted_at,
      c.id AS item_id,
      c.item_type
    FROM eligible_submissions es
    JOIN all_catalog c
      ON c.id = es.coursework_item_id
     AND (c.batch IS NULL OR c.batch = es.batch)
     AND c.item_type = es.submission_type
    WHERE c.active
       OR (
         c.deactivated_at IS NOT NULL
         AND es.submitted_at < c.deactivated_at
       )
  ),
  canonical_awards AS (
    SELECT id, student_id, submitted_at, item_id, item_type
    FROM (
      SELECT
        clc.*,
        row_number() OVER (
          PARTITION BY clc.student_id, clc.item_id
          ORDER BY clc.submitted_at ASC, clc.id ASC
        ) AS item_row
      FROM canonical_linked_candidates clc
    ) deduped
    WHERE item_row = 1
  ),
  coursework_totals AS (
    SELECT
      bs.id AS student_id,
      coalesce(
        count(ca.item_id) FILTER (WHERE ca.item_type = 'assignment'),
        0
      )::bigint AS assignment_completed,
      coalesce(
        count(ca.item_id) FILTER (WHERE ca.item_type = 'project'),
        0
      )::bigint AS project_completed,
      coalesce(
        sum(
          CASE ca.item_type
            WHEN 'assignment' THEN 5
            WHEN 'project' THEN 10
            ELSE 0
          END
        ),
        0
      )::numeric AS coursework_points,
      max(ca.submitted_at) AS last_coursework_at
    FROM batch_students bs
    LEFT JOIN canonical_awards ca ON ca.student_id = bs.id
    GROUP BY bs.id
  ),
  legacy_attendance_rows AS (
    SELECT
      a.id,
      a.student_id,
      a.status,
      a.reviewed_at,
      a.attendance_date,
      EXISTS (
        SELECT 1
        FROM public.batch_calendar_days d
        CROSS JOIN params p
        WHERE d.batch = p.batch_name
          AND d.calendar_date = a.attendance_date
          AND d.is_working_day
      ) AS working_day,
      coalesce(
        (
          SELECT r.points
          FROM public.point_rules r
          WHERE r.activity_type = 'attendance'
            AND r.active
            AND r.effective_from <= a.attendance_date
            AND (r.effective_to IS NULL OR a.attendance_date < r.effective_to)
          ORDER BY r.effective_from DESC
          LIMIT 1
        ),
        0
      )::numeric AS attendance_rule_points
    FROM public.student_attendance a
    JOIN memberships m ON m.student_id = a.student_id
    CROSS JOIN params p
    WHERE a.batch = p.batch_name
      AND a.attendance_date >= p.epoch
      AND a.attendance_date <= p.as_of_date
      AND a.attendance_date >= m.eligible_from
      AND (m.eligible_to IS NULL OR a.attendance_date < m.eligible_to)
  ),
  legacy_attendance_totals AS (
    SELECT
      bs.id AS student_id,
      coalesce(count(*) FILTER (WHERE lar.status = 'approved' AND lar.working_day), 0)::bigint AS approved_attendance_days,
      coalesce(count(*) FILTER (WHERE lar.status = 'pending' AND lar.working_day), 0)::bigint AS pending_attendance_days,
      coalesce(count(*) FILTER (WHERE lar.status = 'rejected' AND lar.working_day), 0)::bigint AS rejected_attendance_days,
      coalesce(sum(lar.attendance_rule_points) FILTER (WHERE lar.status = 'approved' AND lar.working_day), 0)::numeric AS attendance_points,
      max(lar.reviewed_at) FILTER (WHERE lar.status = 'approved' AND lar.working_day) AS last_attendance_at
    FROM batch_students bs
    LEFT JOIN legacy_attendance_rows lar ON lar.student_id = bs.id
    GROUP BY bs.id
  ),
  explicit_session_mode AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.attendance_sessions s
      CROSS JOIN params p
      WHERE s.batch = p.batch_name
        AND s.source <> 'legacy_backfill'
        AND s.session_date >= p.epoch
        AND s.session_date <= p.as_of_date
    ) AS has_explicit_sessions
  ),
  eligible_explicit_sessions AS (
    SELECT DISTINCT
      m.student_id,
      s.id AS session_id,
      s.session_date
    FROM memberships m
    JOIN public.attendance_sessions s
      ON s.batch = m.batch
     AND s.source <> 'legacy_backfill'
     AND s.session_date >= m.eligible_from
     AND (m.eligible_to IS NULL OR s.session_date < m.eligible_to)
    CROSS JOIN params p
    WHERE s.session_date >= p.epoch
      AND s.session_date <= p.as_of_date
  ),
  explicit_sessions AS (
    SELECT
      m.student_id,
      count(DISTINCT m.session_id)::bigint AS eligible_sessions
    FROM eligible_explicit_sessions m
    GROUP BY m.student_id
  ),
  explicit_attendance_rows AS (
    SELECT
      es.student_id,
      es.session_id,
      a.status,
      a.reviewed_at,
      coalesce(
        (
          SELECT r.points
          FROM public.point_rules r
          WHERE r.activity_type = 'attendance'
            AND r.active
            AND r.effective_from <= es.session_date
            AND (r.effective_to IS NULL OR es.session_date < r.effective_to)
          ORDER BY r.effective_from DESC
          LIMIT 1
        ),
        0
      )::numeric AS attendance_rule_points,
      row_number() OVER (
        PARTITION BY es.student_id, es.session_id
        ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC NULLS LAST, a.id DESC
      ) AS attendance_row
    FROM eligible_explicit_sessions es
    JOIN public.student_attendance a
      ON a.student_id = es.student_id
     AND a.session_id = es.session_id
     AND a.batch = (SELECT batch_name FROM params)
  ),
  explicit_attendance_totals AS (
    SELECT
      es.student_id,
      coalesce(count(*) FILTER (WHERE ear.attendance_row = 1 AND ear.status = 'approved'), 0)::bigint AS approved_attendance_days,
      coalesce(count(*) FILTER (WHERE ear.attendance_row = 1 AND ear.status = 'pending'), 0)::bigint AS pending_attendance_days,
      coalesce(count(*) FILTER (WHERE ear.attendance_row = 1 AND ear.status = 'rejected'), 0)::bigint AS rejected_attendance_days,
      coalesce(sum(ear.attendance_rule_points) FILTER (WHERE ear.attendance_row = 1 AND ear.status = 'approved'), 0)::numeric AS attendance_points,
      max(ear.reviewed_at) FILTER (WHERE ear.attendance_row = 1 AND ear.status = 'approved') AS last_attendance_at
    FROM eligible_explicit_sessions es
    LEFT JOIN explicit_attendance_rows ear
      ON ear.student_id = es.student_id
     AND ear.session_id = es.session_id
    GROUP BY es.student_id
  ),
  attendance_totals AS (
    SELECT
      bs.id AS student_id,
      CASE WHEN esm.has_explicit_sessions
        THEN coalesce(eat.approved_attendance_days, 0)
        ELSE coalesce(lat.approved_attendance_days, 0)
      END::bigint AS approved_attendance_days,
      CASE WHEN esm.has_explicit_sessions
        THEN coalesce(eat.pending_attendance_days, 0)
        ELSE coalesce(lat.pending_attendance_days, 0)
      END::bigint AS pending_attendance_days,
      CASE WHEN esm.has_explicit_sessions
        THEN coalesce(eat.rejected_attendance_days, 0)
        ELSE coalesce(lat.rejected_attendance_days, 0)
      END::bigint AS rejected_attendance_days,
      CASE WHEN esm.has_explicit_sessions
        THEN coalesce(eat.attendance_points, 0)
        ELSE coalesce(lat.attendance_points, 0)
      END::numeric AS attendance_points,
      CASE WHEN esm.has_explicit_sessions
        THEN eat.last_attendance_at
        ELSE lat.last_attendance_at
      END AS last_attendance_at,
      CASE WHEN esm.has_explicit_sessions
        THEN coalesce(es.eligible_sessions, 0)
        ELSE coalesce(cal.eligible_working_days, 0)
      END::bigint AS eligible_attendance_units
    FROM batch_students bs
    CROSS JOIN explicit_session_mode esm
    LEFT JOIN legacy_attendance_totals lat ON lat.student_id = bs.id
    LEFT JOIN explicit_attendance_totals eat ON eat.student_id = bs.id
    LEFT JOIN explicit_sessions es ON es.student_id = bs.id
    LEFT JOIN calendar_totals cal ON cal.student_id = bs.id
  ),
  base_metrics AS (
    SELECT
      bs.id AS student_id,
      bs.name AS student_name,
      bs.batch,
      e.assignment_expected,
      coalesce(ct.assignment_completed, 0)::bigint AS assignment_completed,
      e.project_expected,
      coalesce(ct.project_completed, 0)::bigint AS project_completed,
      at.eligible_attendance_units::bigint AS eligible_working_days,
      at.approved_attendance_days,
      at.pending_attendance_days,
      at.rejected_attendance_days,
      round((coalesce(ct.assignment_completed, 0)::numeric / nullif(e.assignment_expected, 0)::numeric) * 100, 2) AS assignment_completion_percentage,
      round((coalesce(ct.project_completed, 0)::numeric / nullif(e.project_expected, 0)::numeric) * 100, 2) AS project_completion_percentage,
      round((at.approved_attendance_days::numeric / nullif(at.eligible_attendance_units, 0)::numeric) * 100, 2) AS attendance_percentage,
      coalesce(ct.assignment_completed, 0)::numeric * 5 AS assignment_points,
      coalesce(ct.project_completed, 0)::numeric * 10 AS project_points,
      at.attendance_points,
      (
        coalesce(ct.assignment_completed, 0)::numeric * 5
        + coalesce(ct.project_completed, 0)::numeric * 10
        + at.attendance_points
      )::numeric AS total_points,
      CASE
        WHEN ct.last_coursework_at IS NULL THEN at.last_attendance_at
        WHEN at.last_attendance_at IS NULL THEN ct.last_coursework_at
        ELSE GREATEST(ct.last_coursework_at, at.last_attendance_at)
      END AS final_score_at
    FROM batch_students bs
    CROSS JOIN expected e
    LEFT JOIN coursework_totals ct ON ct.student_id = bs.id
    LEFT JOIN attendance_totals at ON at.student_id = bs.id
  ),
  ranked AS (
    SELECT
      bm.*,
      rank() OVER (
        ORDER BY bm.total_points DESC,
                 coalesce(bm.assignment_completion_percentage, 0) DESC,
                 coalesce(bm.attendance_percentage, 0) DESC,
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
  FROM ranked
  ORDER BY batch_rank, student_id;
$$;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date) TO service_role;

COMMIT;
