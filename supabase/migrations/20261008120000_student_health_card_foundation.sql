-- Student Health Card foundation
--
-- This migration is intentionally additive. It does not rewrite submissions,
-- existing points, feedback, AI data, or activity history. It is designed for
-- server-role/API ownership; do not run it against production as part of this
-- local implementation review.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.point_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type text NOT NULL,
  points numeric(12, 2) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_rules_activity_type_check CHECK (activity_type IN ('assignment', 'project', 'attendance')),
  CONSTRAINT point_rules_points_check CHECK (points >= 0),
  CONSTRAINT point_rules_effective_range_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT point_rules_unique_effective_start UNIQUE (activity_type, effective_from)
);

CREATE TABLE IF NOT EXISTS public.coursework_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL,
  title text NOT NULL,
  phase text,
  batch text,
  due_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coursework_items_type_check CHECK (item_type IN ('assignment', 'project')),
  CONSTRAINT coursework_items_title_check CHECK (length(btrim(title)) > 0)
);

CREATE TABLE IF NOT EXISTS public.batch_calendar_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch text NOT NULL,
  calendar_date date NOT NULL,
  is_working_day boolean NOT NULL DEFAULT true,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_calendar_days_unique_day UNIQUE (batch, calendar_date)
);

CREATE TABLE IF NOT EXISTS public.student_batch_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  batch text NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_batch_memberships_range_check CHECK (ends_on IS NULL OR ends_on > starts_on),
  CONSTRAINT student_batch_memberships_unique_start UNIQUE (student_id, batch, starts_on)
);

CREATE TABLE IF NOT EXISTS public.student_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  batch text NOT NULL,
  attendance_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  marked_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_attendance_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT student_attendance_epoch_check CHECK (attendance_date >= DATE '2026-10-01'),
  CONSTRAINT student_attendance_unique_student_day UNIQUE (student_id, attendance_date)
);

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS coursework_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'submissions_coursework_item_id_fkey'
      AND conrelid = 'public.submissions'::regclass
  ) THEN
    ALTER TABLE public.submissions
      ADD CONSTRAINT submissions_coursework_item_id_fkey
      FOREIGN KEY (coursework_item_id)
      REFERENCES public.coursework_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- The exclusion constraint prevents two active rules for the same activity
-- from overlapping. Rules use a half-open [effective_from, effective_to)
-- interval, so the 2026-10-01 Health Card epoch can follow the historical
-- rule without ambiguity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'point_rules_no_active_overlap'
      AND conrelid = 'public.point_rules'::regclass
  ) THEN
    ALTER TABLE public.point_rules
      ADD CONSTRAINT point_rules_no_active_overlap
      EXCLUDE USING gist (
        activity_type WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
      ) WHERE (active);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS point_rules_lookup_idx
  ON public.point_rules (activity_type, effective_from DESC)
  WHERE active;

CREATE INDEX IF NOT EXISTS coursework_items_batch_type_active_idx
  ON public.coursework_items (batch, item_type, active, due_at);

CREATE INDEX IF NOT EXISTS coursework_items_title_lookup_idx
  ON public.coursework_items (batch, lower(title));

CREATE INDEX IF NOT EXISTS batch_calendar_days_working_idx
  ON public.batch_calendar_days (batch, calendar_date)
  WHERE is_working_day;

CREATE INDEX IF NOT EXISTS student_batch_memberships_lookup_idx
  ON public.student_batch_memberships (student_id, batch, starts_on DESC, ends_on);

CREATE INDEX IF NOT EXISTS student_attendance_student_date_idx
  ON public.student_attendance (student_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS student_attendance_batch_status_date_idx
  ON public.student_attendance (batch, status, attendance_date DESC);

CREATE INDEX IF NOT EXISTS submissions_health_card_lookup_idx
  ON public.submissions (student_id, batch, submitted_at DESC, coursework_item_id);

-- Existing students are not backfilled. New registrations and future batch
-- changes are recorded automatically. Health aggregation has a documented
-- created_at fallback for pre-migration students with no membership fact.
CREATE OR REPLACE FUNCTION public.cf_sync_student_batch_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transition_date date := GREATEST(
    DATE '2026-10-01',
    (now() AT TIME ZONE 'Asia/Kolkata')::date
  );
  initial_date date;
BEGIN
  IF NEW.batch IS NULL OR btrim(NEW.batch) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    initial_date := GREATEST(
      DATE '2026-10-01',
      COALESCE((NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date, transition_date)
    );

    INSERT INTO public.student_batch_memberships (student_id, batch, starts_on)
    VALUES (NEW.id, NEW.batch, initial_date)
    ON CONFLICT (student_id, batch, starts_on) DO NOTHING;
    RETURN NEW;
  END IF;

  IF NEW.batch IS DISTINCT FROM OLD.batch THEN
    UPDATE public.student_batch_memberships
    SET ends_on = transition_date,
        updated_at = now()
    WHERE student_id = OLD.id
      AND batch = OLD.batch
      AND ends_on IS NULL
      AND starts_on < transition_date;

    INSERT INTO public.student_batch_memberships (student_id, batch, starts_on)
    VALUES (NEW.id, NEW.batch, transition_date)
    ON CONFLICT (student_id, batch, starts_on) DO NOTHING;
  ELSE
    INSERT INTO public.student_batch_memberships (student_id, batch, starts_on)
    VALUES (NEW.id, NEW.batch, transition_date)
    ON CONFLICT (student_id, batch, starts_on) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cf_sync_student_batch_membership_trigger ON public.students;
CREATE TRIGGER cf_sync_student_batch_membership_trigger
AFTER INSERT OR UPDATE OF batch ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.cf_sync_student_batch_membership();

-- Seed reference/history rules and the first Health Card epoch without
-- changing any existing submission row.
INSERT INTO public.point_rules (activity_type, points, effective_from, effective_to, active)
VALUES
  ('assignment', 100, DATE '1900-01-01', DATE '2026-10-01', true),
  ('project', 200, DATE '1900-01-01', DATE '2026-10-01', true),
  ('assignment', 5, DATE '2026-10-01', NULL, true),
  ('project', 10, DATE '2026-10-01', NULL, true),
  ('attendance', 1, DATE '2026-10-01', NULL, true)
ON CONFLICT (activity_type, effective_from) DO NOTHING;

-- No browser client gets CRUD access to these server-owned tables. The
-- service-role API is the only application access path in this project.
ALTER TABLE public.point_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coursework_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_calendar_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_batch_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS point_rules_deny_public ON public.point_rules;
CREATE POLICY point_rules_deny_public ON public.point_rules
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS coursework_items_deny_public ON public.coursework_items;
CREATE POLICY coursework_items_deny_public ON public.coursework_items
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS batch_calendar_days_deny_public ON public.batch_calendar_days;
CREATE POLICY batch_calendar_days_deny_public ON public.batch_calendar_days
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS student_batch_memberships_deny_public ON public.student_batch_memberships;
CREATE POLICY student_batch_memberships_deny_public ON public.student_batch_memberships
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS student_attendance_deny_public ON public.student_attendance;
CREATE POLICY student_attendance_deny_public ON public.student_attendance
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.point_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.coursework_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.batch_calendar_days FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.student_batch_memberships FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.student_attendance FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.point_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.coursework_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_calendar_days TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_batch_memberships TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_attendance TO service_role;

REVOKE ALL ON FUNCTION public.cf_sync_student_batch_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_sync_student_batch_membership() TO service_role;

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
    SELECT c.id, lower(btrim(c.item_type)) AS item_type, c.title, c.active
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
      coalesce(count(*) FILTER (WHERE ar.status = 'pending'), 0) AS pending_attendance_days,
      coalesce(count(*) FILTER (WHERE ar.status = 'rejected'), 0) AS rejected_attendance_days,
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
  v_top10 jsonb;
  v_recent jsonb;
BEGIN
  SELECT * INTO v_student
  FROM public.students s
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'studentId', l.student_id,
    'name', l.student_name,
    'batch', l.batch,
    'rank', l.batch_rank,
    'totalPoints', l.total_points,
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

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', l.batch_rank,
    'studentId', l.student_id,
    'name', l.student_name,
    'totalPoints', l.total_points,
    'assignmentCompletionPercentage', l.assignment_completion_percentage,
    'attendancePercentage', l.attendance_percentage
  ) ORDER BY l.batch_rank), '[]'::jsonb)
  INTO v_top10
  FROM public.cf_health_card_leaderboard(v_student.batch, v_as_of) l
  WHERE l.batch_rank <= 10;

  SELECT coalesce(jsonb_agg(item ORDER BY occurred_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'type', 'coursework',
      'title', coalesce(s.topic, 'Coursework submission'),
      'activityType', CASE lower(btrim(coalesce(s.submission_type, '')))
        WHEN 'project' THEN 'project'
        WHEN '200' THEN 'project'
        ELSE 'assignment'
      END,
      'occurredAt', s.submitted_at
    ) AS item, s.submitted_at AS occurred_at
    FROM public.submissions s
    WHERE s.student_id = v_student.id
      AND s.batch = v_student.batch
      AND s.submitted_at IS NOT NULL
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= DATE '2026-10-01'
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= v_as_of

    UNION ALL

    SELECT jsonb_build_object(
      'type', 'attendance',
      'title', 'Attendance marked',
      'status', a.status,
      'attendanceDate', a.attendance_date,
      'occurredAt', a.created_at
    ) AS item, a.created_at AS occurred_at
    FROM public.student_attendance a
    WHERE a.student_id = v_student.id
      AND a.batch = v_student.batch
      AND a.attendance_date >= DATE '2026-10-01'
      AND a.attendance_date <= v_as_of
    ORDER BY occurred_at DESC
    LIMIT 12
  ) recent;

  RETURN jsonb_build_object(
    'epochStart', '2026-10-01',
    'timezone', 'Asia/Kolkata',
    'student', jsonb_build_object('id', v_student.id, 'name', v_student.name, 'batch', v_student.batch),
    'metrics', coalesce(v_current, jsonb_build_object(
      'studentId', v_student.id,
      'name', v_student.name,
      'batch', v_student.batch,
      'rank', NULL,
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
    'leaderboard', jsonb_build_object(
      'top10', v_top10,
      'current', v_current
    ),
    'recentActivity', v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_health_card_leaderboard(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cf_get_student_health_card(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_health_card_leaderboard(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.cf_get_student_health_card(uuid, date) TO service_role;

COMMIT;
