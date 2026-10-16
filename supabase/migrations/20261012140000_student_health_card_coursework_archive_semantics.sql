-- Student Health Card archive semantics correction.
-- NEW corrective migration; do not rewrite or reapply earlier migrations.
-- This migration was prepared locally and was not executed.
-- It preserves points earned before coursework deactivation, excludes archived
-- items from future expectations, and blocks new linked submissions after the
-- deactivation timestamp.

BEGIN;

ALTER TABLE public.coursework_items
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE OR REPLACE FUNCTION public.cf_track_coursework_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active THEN
    NEW.deactivated_at := NULL;
  ELSIF NEW.deactivated_at IS NULL THEN
    NEW.deactivated_at := CASE
      WHEN TG_OP = 'UPDATE' THEN OLD.deactivated_at
      ELSE NULL
    END;
    IF NEW.deactivated_at IS NULL THEN
      NEW.deactivated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cf_track_coursework_deactivation_trigger
  ON public.coursework_items;

CREATE TRIGGER cf_track_coursework_deactivation_trigger
BEFORE INSERT OR UPDATE OF active, deactivated_at
ON public.coursework_items
FOR EACH ROW
EXECUTE FUNCTION public.cf_track_coursework_deactivation();

REVOKE ALL ON FUNCTION public.cf_track_coursework_deactivation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_track_coursework_deactivation() TO service_role;

CREATE OR REPLACE FUNCTION public.cf_validate_coursework_item_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.coursework_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.coursework_items c
    WHERE c.id = NEW.coursework_item_id
      AND (
        c.active
        OR (
          c.deactivated_at IS NOT NULL
          AND NEW.submitted_at IS NOT NULL
          AND NEW.submitted_at < c.deactivated_at
        )
      )
  ) THEN
    RAISE EXCEPTION 'Coursework item is inactive or unavailable for new submissions'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cf_validate_coursework_item_submission_trigger
  ON public.submissions;

CREATE TRIGGER cf_validate_coursework_item_submission_trigger
BEFORE INSERT OR UPDATE OF coursework_item_id, submitted_at
ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.cf_validate_coursework_item_submission();

REVOKE ALL ON FUNCTION public.cf_validate_coursework_item_submission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_validate_coursework_item_submission() TO service_role;

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
  batch_students AS (
    SELECT s.id, s.name, s.batch, s.created_at
    FROM public.students s, params p
    WHERE s.batch = p.batch_name
  ),
  memberships AS (
    SELECT
      bs.id AS student_id,
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
    FROM batch_students bs, params p
  ),
  all_catalog AS (
    SELECT c.id, lower(btrim(c.item_type)) AS item_type, c.title, c.active, c.deactivated_at
    FROM public.coursework_items c, params p
    WHERE (c.batch IS NULL OR c.batch = p.batch_name)
      AND lower(btrim(c.item_type)) IN ('assignment', 'project')
  ),
  active_catalog AS (
    SELECT * FROM all_catalog WHERE active
  ),
  expected AS (
    SELECT
      count(*) FILTER (WHERE item_type = 'assignment') AS assignment_expected,
      count(*) FILTER (WHERE item_type = 'project') AS project_expected
    FROM active_catalog
  ),
  calendar_totals AS (
    SELECT m.student_id, count(d.id) AS eligible_working_days
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
      s.topic,
      s.coursework_item_id,
      s.submitted_at,
      (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date AS activity_date,
      CASE lower(btrim(coalesce(s.submission_type, '')))
        WHEN 'assignment' THEN 'assignment'
        WHEN '100' THEN 'assignment'
        WHEN 'project' THEN 'project'
        WHEN '200' THEN 'project'
        ELSE NULL
      END AS legacy_type
    FROM public.submissions s
    JOIN batch_students bs ON bs.id = s.student_id AND bs.batch = s.batch
    CROSS JOIN params p
    WHERE s.submitted_at IS NOT NULL
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= p.epoch
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= p.as_of_date
  ),
  linked_candidates AS (
    SELECT
      es.id,
      es.student_id,
      es.submitted_at,
      es.activity_date,
      c.id AS item_id,
      c.item_type AS activity_type
    FROM eligible_submissions es
    JOIN all_catalog c ON c.id = es.coursework_item_id
    WHERE (
      c.active
      OR (
        c.deactivated_at IS NOT NULL
        AND es.submitted_at < c.deactivated_at
      )
    )
  ),
  linked_awards AS (
    SELECT *
    FROM (
      SELECT lc.*, row_number() OVER (
        PARTITION BY lc.student_id, lc.item_id
        ORDER BY lc.submitted_at ASC, lc.id ASC
      ) AS item_row
      FROM linked_candidates lc
    ) deduped
    WHERE item_row = 1
  ),
  title_candidates AS (
    SELECT
      es.id,
      es.student_id,
      es.submitted_at,
      es.activity_date,
      c.id AS item_id,
      c.item_type AS activity_type
    FROM eligible_submissions es
    JOIN active_catalog c
      ON es.coursework_item_id IS NULL
     AND es.legacy_type = c.item_type
     AND lower(btrim(coalesce(es.topic, ''))) = lower(btrim(c.title))
    WHERE (
      SELECT count(*)
      FROM active_catalog c2
      WHERE c2.item_type = c.item_type
        AND lower(btrim(c2.title)) = lower(btrim(c.title))
    ) = 1
  ),
  title_awards AS (
    SELECT *
    FROM (
      SELECT tc.*, row_number() OVER (
        PARTITION BY tc.student_id, tc.item_id
        ORDER BY tc.submitted_at ASC, tc.id ASC
      ) AS item_row
      FROM title_candidates tc
    ) deduped
    WHERE item_row = 1
  ),
  fallback_awards AS (
    SELECT id, student_id, submitted_at, activity_date, NULL::uuid AS item_id, legacy_type AS activity_type
    FROM (
      SELECT
        es.*,
        row_number() OVER (
          PARTITION BY es.student_id, es.legacy_type, lower(btrim(coalesce(es.topic, '')))
          ORDER BY es.submitted_at ASC, es.id ASC
        ) AS topic_row
      FROM eligible_submissions es
      WHERE es.coursework_item_id IS NULL
        AND es.legacy_type IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM title_candidates tc WHERE tc.id = es.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM all_catalog inactive_catalog
          WHERE NOT inactive_catalog.active
            AND inactive_catalog.item_type = es.legacy_type
            AND lower(btrim(inactive_catalog.title)) = lower(btrim(coalesce(es.topic, '')))
            AND (
              inactive_catalog.deactivated_at IS NULL
              OR es.submitted_at >= inactive_catalog.deactivated_at
            )
        )
    ) deduped
    WHERE topic_row = 1
  ),
  award_rows AS (
    SELECT id, student_id, submitted_at AS activity_at, activity_date, item_id, activity_type FROM linked_awards
    UNION ALL
    SELECT id, student_id, submitted_at AS activity_at, activity_date, item_id, activity_type FROM title_awards
    UNION ALL
    SELECT id, student_id, submitted_at AS activity_at, activity_date, item_id, activity_type FROM fallback_awards
  ),
  award_values AS (
    SELECT
      ar.*,
      coalesce(pr.points, 0)::numeric AS award_points
    FROM award_rows ar
    LEFT JOIN LATERAL (
      SELECT r.points
      FROM public.point_rules r
      WHERE r.activity_type = ar.activity_type
        AND r.active
        AND r.effective_from <= ar.activity_date
        AND (r.effective_to IS NULL OR ar.activity_date < r.effective_to)
      ORDER BY r.effective_from DESC
      LIMIT 1
    ) pr ON true
  ),
  award_totals AS (
    SELECT
      bs.id AS student_id,
      coalesce(sum(av.award_points) FILTER (WHERE av.activity_type = 'assignment'), 0)::numeric AS assignment_points,
      coalesce(sum(av.award_points) FILTER (WHERE av.activity_type = 'project'), 0)::numeric AS project_points,
      max(av.activity_at) AS last_coursework_at
    FROM batch_students bs
    LEFT JOIN award_values av ON av.student_id = bs.id
    GROUP BY bs.id
  ),
  completed_catalog AS (
    SELECT student_id, item_id
    FROM linked_awards
    WHERE item_id IN (SELECT id FROM active_catalog)
    UNION
    SELECT student_id, item_id
    FROM title_awards
  ),
  completion_totals AS (
    SELECT
      bs.id AS student_id,
      count(DISTINCT cc.item_id) FILTER (WHERE c.item_type = 'assignment') AS assignment_completed,
      count(DISTINCT cc.item_id) FILTER (WHERE c.item_type = 'project') AS project_completed
    FROM batch_students bs
    LEFT JOIN completed_catalog cc ON cc.student_id = bs.id
    LEFT JOIN active_catalog c ON c.id = cc.item_id
    GROUP BY bs.id
  ),
  attendance_rows AS (
    SELECT
      a.id,
      a.student_id,
      a.status,
      a.attendance_date,
      a.reviewed_at,
      EXISTS (
        SELECT 1
        FROM public.batch_calendar_days d, params p
        WHERE d.batch = p.batch_name
          AND d.calendar_date = a.attendance_date
          AND d.is_working_day
      ) AS working_day,
      coalesce(ar.points, 0)::numeric AS attendance_rule_points
    FROM public.student_attendance a
    JOIN memberships m ON m.student_id = a.student_id
    CROSS JOIN params p
    LEFT JOIN LATERAL (
      SELECT r.points
      FROM public.point_rules r
      WHERE r.activity_type = 'attendance'
        AND r.active
        AND r.effective_from <= a.attendance_date
        AND (r.effective_to IS NULL OR a.attendance_date < r.effective_to)
      ORDER BY r.effective_from DESC
      LIMIT 1
    ) ar ON true
    WHERE a.batch = p.batch_name
      AND a.attendance_date >= p.epoch
      AND a.attendance_date <= p.as_of_date
      AND a.attendance_date >= m.eligible_from
      AND (m.eligible_to IS NULL OR a.attendance_date < m.eligible_to)
  ),
  attendance_totals AS (
    SELECT
      bs.id AS student_id,
      coalesce(count(*) FILTER (WHERE ar.status = 'approved' AND ar.working_day), 0) AS approved_attendance_days,
      coalesce(count(*) FILTER (WHERE ar.status = 'pending' AND ar.working_day), 0) AS pending_attendance_days,
      coalesce(count(*) FILTER (WHERE ar.status = 'rejected' AND ar.working_day), 0) AS rejected_attendance_days,
      coalesce(sum(ar.attendance_rule_points) FILTER (WHERE ar.status = 'approved' AND ar.working_day), 0)::numeric AS attendance_points,
      max(ar.reviewed_at) FILTER (WHERE ar.status = 'approved' AND ar.working_day) AS last_attendance_at
    FROM batch_students bs
    LEFT JOIN attendance_rows ar ON ar.student_id = bs.id
    GROUP BY bs.id
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
      coalesce(cal.eligible_working_days, 0)::bigint AS eligible_working_days,
      coalesce(att.approved_attendance_days, 0)::bigint AS approved_attendance_days,
      coalesce(att.pending_attendance_days, 0)::bigint AS pending_attendance_days,
      coalesce(att.rejected_attendance_days, 0)::bigint AS rejected_attendance_days,
      round((coalesce(ct.assignment_completed, 0)::numeric / nullif(e.assignment_expected, 0)::numeric) * 100, 2) AS assignment_completion_percentage,
      round((coalesce(ct.project_completed, 0)::numeric / nullif(e.project_expected, 0)::numeric) * 100, 2) AS project_completion_percentage,
      round((coalesce(att.approved_attendance_days, 0)::numeric / nullif(cal.eligible_working_days, 0)::numeric) * 100, 2) AS attendance_percentage,
      coalesce(aw.assignment_points, 0)::numeric AS assignment_points,
      coalesce(aw.project_points, 0)::numeric AS project_points,
      coalesce(att.attendance_points, 0)::numeric AS attendance_points,
      (
        coalesce(aw.assignment_points, 0) +
        coalesce(aw.project_points, 0) +
        coalesce(att.attendance_points, 0)
      )::numeric AS total_points,
      CASE
        WHEN aw.last_coursework_at IS NULL THEN att.last_attendance_at
        WHEN att.last_attendance_at IS NULL THEN aw.last_coursework_at
        ELSE GREATEST(aw.last_coursework_at, att.last_attendance_at)
      END AS final_score_at
    FROM batch_students bs
    CROSS JOIN expected e
    LEFT JOIN calendar_totals cal ON cal.student_id = bs.id
    LEFT JOIN award_totals aw ON aw.student_id = bs.id
    LEFT JOIN completion_totals ct ON ct.student_id = bs.id
    LEFT JOIN attendance_totals att ON att.student_id = bs.id
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
  SELECT * FROM ranked ORDER BY batch_rank, student_id;
$$;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date) TO service_role;

COMMIT;
