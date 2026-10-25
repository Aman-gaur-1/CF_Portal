-- Cumulative batch progress and historical coursework reconciliation.
-- Additive only: existing catalog rows, activations, submissions, attendance,
-- memberships, and credentials are preserved.  Existing catalog items are
-- intentionally left unordered until an administrator supplies an explicit
-- order; alphabetical/created-at order is not a curriculum decision.

BEGIN;

ALTER TABLE public.coursework_items
  ADD COLUMN IF NOT EXISTS sort_order integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'coursework_items_sort_order_check'
      AND conrelid = 'public.coursework_items'::regclass
  ) THEN
    ALTER TABLE public.coursework_items
      ADD CONSTRAINT coursework_items_sort_order_check
      CHECK (sort_order IS NULL OR sort_order >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS coursework_items_global_phase_type_order_idx
  ON public.coursework_items (phase, item_type, sort_order, title)
  WHERE batch IS NULL AND active = true AND sort_order IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coursework_items_global_phase_type_order_uidx
  ON public.coursework_items (phase, item_type, sort_order)
  WHERE batch IS NULL AND sort_order IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.batch_curriculum_phase_order (
  phase text PRIMARY KEY,
  display_order integer NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_curriculum_phase_order_phase_check
    CHECK (phase IN ('Python', 'Data Analytics', 'SQL'))
);

INSERT INTO public.batch_curriculum_phase_order (phase, display_order)
VALUES ('Python', 10), ('Data Analytics', 20), ('SQL', 30)
ON CONFLICT (phase) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.batch_curriculum_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch text NOT NULL,
  phase text NOT NULL,
  item_type text NOT NULL,
  covered_through_coursework_item_id uuid NOT NULL
    REFERENCES public.coursework_items(id) ON DELETE RESTRICT,
  covered_through_sort_order integer NOT NULL,
  updated_by_role text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_curriculum_progress_phase_check
    CHECK (phase IN ('Python', 'Data Analytics', 'SQL')),
  CONSTRAINT batch_curriculum_progress_type_check
    CHECK (item_type IN ('assignment', 'project')),
  CONSTRAINT batch_curriculum_progress_role_check
    CHECK (updated_by_role IN ('admin', 'teacher', 'system')),
  CONSTRAINT batch_curriculum_progress_order_check
    CHECK (covered_through_sort_order >= 0),
  CONSTRAINT batch_curriculum_progress_unique
    UNIQUE (batch, phase, item_type)
);

CREATE INDEX IF NOT EXISTS batch_curriculum_progress_batch_idx
  ON public.batch_curriculum_progress (batch, phase, item_type);

CREATE TABLE IF NOT EXISTS public.student_coursework_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  batch text NOT NULL,
  coursework_item_id uuid NOT NULL REFERENCES public.coursework_items(id) ON DELETE RESTRICT,
  -- Staging uses UUID submission ids while production uses bigint ids. Keep
  -- provenance portable without making the reconciliation table migration
  -- environment-specific; student/item integrity remains FK-enforced.
  source_submission_id text,
  source_topic text,
  phase text NOT NULL,
  item_type text NOT NULL,
  confidence text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review',
  counts_for_progress boolean NOT NULL DEFAULT false,
  counts_for_points boolean NOT NULL DEFAULT false,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_coursework_reconciliation_phase_check
    CHECK (phase IN ('Python', 'Data Analytics', 'SQL')),
  CONSTRAINT student_coursework_reconciliation_type_check
    CHECK (item_type IN ('assignment', 'project')),
  CONSTRAINT student_coursework_reconciliation_confidence_check
    CHECK (confidence IN ('confirmed', 'high_confidence', 'ambiguous', 'rejected')),
  CONSTRAINT student_coursework_reconciliation_status_check
    CHECK (status IN ('pending_review', 'confirmed', 'rejected')),
  CONSTRAINT student_coursework_reconciliation_no_points_check
    CHECK (counts_for_points = false),
  CONSTRAINT student_coursework_reconciliation_unique
    UNIQUE (student_id, coursework_item_id)
);

CREATE INDEX IF NOT EXISTS student_coursework_reconciliations_student_batch_idx
  ON public.student_coursework_reconciliations (student_id, batch, status, counts_for_progress);

CREATE INDEX IF NOT EXISTS student_coursework_reconciliations_item_idx
  ON public.student_coursework_reconciliations (coursework_item_id, status, counts_for_progress);

ALTER TABLE public.batch_curriculum_phase_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_curriculum_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_coursework_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batch_curriculum_phase_order_deny_public ON public.batch_curriculum_phase_order;
CREATE POLICY batch_curriculum_phase_order_deny_public ON public.batch_curriculum_phase_order
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS batch_curriculum_progress_deny_public ON public.batch_curriculum_progress;
CREATE POLICY batch_curriculum_progress_deny_public ON public.batch_curriculum_progress
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS student_coursework_reconciliations_deny_public ON public.student_coursework_reconciliations;
CREATE POLICY student_coursework_reconciliations_deny_public ON public.student_coursework_reconciliations
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.batch_curriculum_phase_order FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.batch_curriculum_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.student_coursework_reconciliations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_curriculum_phase_order TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_curriculum_progress TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_coursework_reconciliations TO service_role;

-- Atomic forward release.  A lower target is rejected by the database; the
-- API presents the impact and requires an explicit confirmation before it can
-- choose to keep the existing higher release.  No call ever deactivates an
-- earlier activation.
CREATE OR REPLACE FUNCTION public.cf_apply_batch_curriculum_progress(
  p_batch text,
  p_phase text,
  p_item_type text,
  p_covered_through_coursework_item_id uuid,
  p_updated_by_role text,
  p_updated_by_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch text := NULLIF(btrim(p_batch), '');
  v_phase text := NULLIF(btrim(p_phase), '');
  v_item_type text := NULLIF(lower(btrim(p_item_type)), '');
  v_item public.coursework_items%ROWTYPE;
  v_previous public.batch_curriculum_progress%ROWTYPE;
  v_new_items bigint := 0;
  v_total_items bigint := 0;
BEGIN
  IF v_batch IS NULL OR v_phase IS NULL OR v_item_type IS NULL
     OR p_covered_through_coursework_item_id IS NULL THEN
    RAISE EXCEPTION 'Batch, phase, type, and covered-through item are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_updated_by_role NOT IN ('admin', 'teacher', 'system') THEN
    RAISE EXCEPTION 'Invalid curriculum progress actor role' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.batches b WHERE b.name = v_batch) THEN
    RAISE EXCEPTION 'Batch does not exist' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_batch || '|' || v_phase || '|' || v_item_type, 0));

  SELECT * INTO v_item
  FROM public.coursework_items c
  WHERE c.id = p_covered_through_coursework_item_id
    AND c.batch IS NULL
    AND c.active
    AND c.phase = v_phase
    AND lower(btrim(c.item_type)) = v_item_type
    AND c.sort_order IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Covered-through item must be an active global item with explicit ordering'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_previous
  FROM public.batch_curriculum_progress p
  WHERE p.batch = v_batch AND p.phase = v_phase AND p.item_type = v_item_type
  FOR UPDATE;
  IF FOUND AND v_previous.covered_through_sort_order > v_item.sort_order THEN
    RAISE EXCEPTION 'Backward progress requires confirmation; existing activations are retained'
      USING ERRCODE = 'P0001', DETAIL = json_build_object(
        'previousSortOrder', v_previous.covered_through_sort_order,
        'requestedSortOrder', v_item.sort_order,
        'previousItemId', v_previous.covered_through_coursework_item_id
      )::text;
  END IF;

  SELECT count(*) INTO v_new_items
  FROM public.coursework_items c
  WHERE c.batch IS NULL
    AND c.active
    AND c.phase = v_phase
    AND lower(btrim(c.item_type)) = v_item_type
    AND c.sort_order IS NOT NULL
    AND c.sort_order <= v_item.sort_order
    AND NOT EXISTS (
      SELECT 1 FROM public.batch_coursework_assignments a
      WHERE a.batch = v_batch AND a.coursework_item_id = c.id AND a.active
    );

  INSERT INTO public.batch_curriculum_progress (
    batch, phase, item_type, covered_through_coursework_item_id,
    covered_through_sort_order, updated_by_role, updated_by_name, updated_at
  ) VALUES (
    v_batch, v_phase, v_item_type, v_item.id, v_item.sort_order,
    p_updated_by_role, COALESCE(NULLIF(btrim(p_updated_by_name), ''), 'system'), now()
  )
  ON CONFLICT (batch, phase, item_type) DO UPDATE SET
    covered_through_coursework_item_id = EXCLUDED.covered_through_coursework_item_id,
    covered_through_sort_order = EXCLUDED.covered_through_sort_order,
    updated_by_role = EXCLUDED.updated_by_role,
    updated_by_name = EXCLUDED.updated_by_name,
    updated_at = now()
  WHERE public.batch_curriculum_progress.covered_through_sort_order <= EXCLUDED.covered_through_sort_order;

  INSERT INTO public.batch_coursework_assignments (
    batch, coursework_item_id, activated_at, activated_by_role,
    activated_by_name, active, updated_at
  )
  SELECT v_batch, c.id, now(), p_updated_by_role,
    COALESCE(NULLIF(btrim(p_updated_by_name), ''), 'system'), true, now()
  FROM public.coursework_items c
  WHERE c.batch IS NULL
    AND c.active
    AND c.phase = v_phase
    AND lower(btrim(c.item_type)) = v_item_type
    AND c.sort_order IS NOT NULL
    AND c.sort_order <= v_item.sort_order
  ON CONFLICT (batch, coursework_item_id) DO UPDATE SET
    active = true,
    updated_at = now();

  SELECT count(*) INTO v_total_items
  FROM public.batch_coursework_assignments a
  JOIN public.coursework_items c ON c.id = a.coursework_item_id
  WHERE a.batch = v_batch AND a.active
    AND c.phase = v_phase AND lower(btrim(c.item_type)) = v_item_type;

  RETURN jsonb_build_object(
    'batch', v_batch,
    'phase', v_phase,
    'itemType', v_item_type,
    'coveredThroughItemId', v_item.id,
    'coveredThroughSortOrder', v_item.sort_order,
    'newItemCount', v_new_items,
    'activeItemCount', v_total_items,
    'backwardMovement', false,
    'existingActivationsRetained', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_apply_batch_curriculum_progress(text, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_apply_batch_curriculum_progress(text, text, text, uuid, text, text)
  TO service_role;

-- Health Card scoring keeps progress completion separate from current scoring:
-- confirmed reconciliation rows satisfy progress only and can never award points.
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
    SELECT coalesce(max(points) FILTER (WHERE activity_type = 'assignment'), 5)::numeric AS assignment_points,
      coalesce(max(points) FILTER (WHERE activity_type = 'project'), 10)::numeric AS project_points,
      coalesce(max(points) FILTER (WHERE activity_type = 'attendance'), 1)::numeric AS attendance_points
    FROM public.point_rules r CROSS JOIN params p
    WHERE r.active AND r.effective_from <= p.as_of_date
      AND (r.effective_to IS NULL OR p.as_of_date < r.effective_to)
  ),
  batch_students AS (
    SELECT s.id, s.name, s.batch, s.created_at, s.status
    FROM public.students s CROSS JOIN params p WHERE s.batch = p.batch_name
  ),
  memberships AS (
    SELECT bs.id AS student_id, bs.batch,
      GREATEST(p.epoch, COALESCE((
        SELECT m.starts_on FROM public.student_batch_memberships m
        WHERE m.student_id = bs.id AND m.batch = bs.batch AND m.starts_on <= p.as_of_date
          AND (m.ends_on IS NULL OR m.ends_on > p.as_of_date)
        ORDER BY m.starts_on DESC, m.created_at DESC LIMIT 1
      ), (bs.created_at AT TIME ZONE 'Asia/Kolkata')::date, p.epoch)) AS eligible_from,
      (SELECT m.ends_on FROM public.student_batch_memberships m
       WHERE m.student_id = bs.id AND m.batch = bs.batch AND m.starts_on <= p.as_of_date
         AND (m.ends_on IS NULL OR m.ends_on > p.as_of_date)
       ORDER BY m.starts_on DESC, m.created_at DESC LIMIT 1) AS eligible_to
    FROM batch_students bs CROSS JOIN params p WHERE bs.status = 'active'
  ),
  active_assignments AS (
    SELECT a.batch, a.coursework_item_id AS item_id, c.item_type, c.phase, c.due_at, a.activated_at
    FROM public.batch_coursework_assignments a
    JOIN public.coursework_items c ON c.id = a.coursework_item_id
    CROSS JOIN params p
    WHERE a.batch = p.batch_name AND a.active AND c.active
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
    FROM public.submissions s JOIN memberships m ON m.student_id = s.student_id AND m.batch = s.batch
    CROSS JOIN params p
    WHERE s.submitted_at IS NOT NULL
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.epoch AND p.as_of_date
      AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= m.eligible_from
      AND (m.eligible_to IS NULL OR (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date < m.eligible_to)
  ),
  canonical_linked_candidates AS (
    SELECT es.id, es.student_id, es.batch, es.submitted_at, c.id AS item_id,
      lower(btrim(c.item_type)) AS item_type
    FROM eligible_submissions es JOIN public.coursework_items c ON c.id = es.coursework_item_id
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
  all_linked_progress AS (
    SELECT DISTINCT s.student_id, s.batch, c.id AS item_id, lower(btrim(c.item_type)) AS item_type
    FROM public.submissions s JOIN public.coursework_items c ON c.id = s.coursework_item_id
    WHERE s.coursework_item_id IS NOT NULL AND c.active
      AND (c.batch IS NULL OR c.batch = s.batch)
      AND lower(btrim(coalesce(s.submission_type, ''))) = lower(btrim(c.item_type))
  ),
  reconciled_progress AS (
    SELECT DISTINCT r.student_id, r.batch, r.coursework_item_id AS item_id,
      lower(btrim(r.item_type)) AS item_type
    FROM public.student_coursework_reconciliations r
    WHERE r.status = 'confirmed' AND r.counts_for_progress
      AND r.confidence IN ('confirmed', 'high_confidence')
  ),
  progress_items AS (
    SELECT student_id, batch, item_id, item_type FROM all_linked_progress
    UNION
    SELECT student_id, batch, item_id, item_type FROM reconciled_progress
  ),
  coursework_totals AS (
    SELECT bs.id AS student_id,
      count(pi.item_id) FILTER (WHERE pi.item_type = 'assignment' AND aa.item_id IS NOT NULL)::bigint AS assignment_completed,
      count(pi.item_id) FILTER (WHERE pi.item_type = 'project' AND aa.item_id IS NOT NULL)::bigint AS project_completed,
      count(ca.item_id) FILTER (WHERE ca.item_type = 'assignment' AND aa.item_id IS NOT NULL)::bigint AS scored_assignment_count,
      count(ca.item_id) FILTER (WHERE ca.item_type = 'project' AND aa.item_id IS NOT NULL)::bigint AS scored_project_count,
      max(ca.submitted_at) AS last_coursework_at
    FROM batch_students bs
    LEFT JOIN progress_items pi ON pi.student_id = bs.id AND pi.batch = bs.batch
    LEFT JOIN active_assignments aa ON aa.item_id = pi.item_id AND aa.batch = bs.batch
    LEFT JOIN canonical_awards ca ON ca.student_id = bs.id AND ca.batch = bs.batch AND ca.item_id = pi.item_id
    GROUP BY bs.id
  ),
  eligible_session_dates AS (
    SELECT DISTINCT m.student_id, s.session_date
    FROM memberships m JOIN public.attendance_sessions s ON s.batch = m.batch
      AND s.source <> 'legacy_backfill' AND s.session_date >= m.eligible_from
      AND (m.eligible_to IS NULL OR s.session_date < m.eligible_to)
    CROSS JOIN params p WHERE s.session_date BETWEEN p.epoch AND p.as_of_date
  ),
  daily_attendance AS (
    SELECT esd.student_id, esd.session_date,
      max(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) AS approved,
      max(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      max(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      max(coalesce(a.reviewed_at, a.updated_at, a.marked_at)) AS latest_at
    FROM eligible_session_dates esd LEFT JOIN public.student_attendance a
      ON a.student_id = esd.student_id AND a.batch = (SELECT batch_name FROM params)
      AND a.attendance_date = esd.session_date AND a.session_id IS NOT NULL
    GROUP BY esd.student_id, esd.session_date
  ),
  attendance_totals AS (
    SELECT bs.id AS student_id, count(da.session_date)::bigint AS tracked_days,
      count(da.session_date) FILTER (WHERE da.approved = 1)::bigint AS approved_days,
      count(da.session_date) FILTER (WHERE da.approved = 0 AND da.pending = 1)::bigint AS pending_days,
      count(da.session_date) FILTER (WHERE da.approved = 0 AND da.pending = 0 AND da.rejected = 1)::bigint AS rejected_days,
      max(da.latest_at) FILTER (WHERE da.approved = 1) AS last_attendance_at
    FROM batch_students bs LEFT JOIN daily_attendance da ON da.student_id = bs.id GROUP BY bs.id
  ),
  base_metrics AS (
    SELECT bs.id AS student_id, bs.name AS student_name, bs.batch, bs.status,
      CASE WHEN bs.status = 'active' THEN e.assignment_expected ELSE 0 END AS assignment_expected,
      CASE WHEN bs.status = 'active' THEN coalesce(ct.assignment_completed, 0)::bigint ELSE 0 END AS assignment_completed,
      CASE WHEN bs.status = 'active' THEN e.project_expected ELSE 0 END AS project_expected,
      CASE WHEN bs.status = 'active' THEN coalesce(ct.project_completed, 0)::bigint ELSE 0 END AS project_completed,
      CASE WHEN bs.status = 'active' THEN coalesce(at.tracked_days, 0)::bigint ELSE 0 END AS eligible_working_days,
      CASE WHEN bs.status = 'active' THEN coalesce(at.approved_days, 0)::bigint ELSE 0 END AS approved_attendance_days,
      CASE WHEN bs.status = 'active' THEN coalesce(at.pending_days, 0)::bigint ELSE 0 END AS pending_attendance_days,
      CASE WHEN bs.status = 'active' THEN coalesce(at.rejected_days, 0)::bigint ELSE 0 END AS rejected_attendance_days,
      CASE WHEN bs.status = 'active' THEN round((coalesce(ct.assignment_completed, 0)::numeric / nullif(e.assignment_expected, 0)) * 100, 2) END AS assignment_completion_percentage,
      CASE WHEN bs.status = 'active' THEN round((coalesce(ct.project_completed, 0)::numeric / nullif(e.project_expected, 0)) * 100, 2) END AS project_completion_percentage,
      CASE WHEN bs.status = 'active' THEN round((coalesce(at.approved_days, 0)::numeric / nullif(at.tracked_days, 0)) * 100, 2) END AS attendance_percentage,
      CASE WHEN bs.status = 'active' THEN coalesce(ct.scored_assignment_count, 0)::numeric * ps.assignment_points ELSE 0 END AS assignment_points,
      CASE WHEN bs.status = 'active' THEN coalesce(ct.scored_project_count, 0)::numeric * ps.project_points ELSE 0 END AS project_points,
      CASE WHEN bs.status = 'active' THEN coalesce(at.approved_days, 0)::numeric * ps.attendance_points ELSE 0 END AS attendance_points,
      CASE WHEN bs.status = 'active' THEN (coalesce(ct.scored_assignment_count, 0)::numeric * ps.assignment_points + coalesce(ct.scored_project_count, 0)::numeric * ps.project_points) ELSE 0 END AS total_points,
      CASE WHEN bs.status = 'active' THEN CASE WHEN ct.last_coursework_at IS NULL THEN at.last_attendance_at
        WHEN at.last_attendance_at IS NULL THEN ct.last_coursework_at ELSE GREATEST(ct.last_coursework_at, at.last_attendance_at) END END AS final_score_at
    FROM batch_students bs CROSS JOIN expected e CROSS JOIN point_scale ps
    LEFT JOIN coursework_totals ct ON ct.student_id = bs.id
    LEFT JOIN attendance_totals at ON at.student_id = bs.id
  ),
  ranked AS (
    SELECT bm.*, CASE WHEN bm.status = 'active' THEN row_number() OVER (
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

COMMIT;
