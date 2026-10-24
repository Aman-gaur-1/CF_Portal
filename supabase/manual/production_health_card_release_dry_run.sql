-- Read-only production/staging preflight for the Student Health Card release.
-- This file must not contain DDL/DML. It intentionally reports counts only.

\pset format unaligned
\pset tuples_only on

WITH object_state AS (
  SELECT
    to_regclass('public.batch_coursework_assignments') IS NOT NULL AS batch_activation_table,
    to_regclass('public.student_roster_imports') IS NOT NULL AS roster_import_table,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'login_id'
    ) AS login_id_column,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'external_student_id'
    ) AS external_student_id_column,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'coursework_items' AND column_name = 'deactivated_at'
    ) AS deactivated_at_column,
    to_regprocedure('public.cf_health_card_leaderboard(text,date)') IS NOT NULL AS leaderboard_rpc,
    to_regprocedure('public.cf_get_student_health_card(uuid,date)') IS NOT NULL AS health_card_rpc
),
student_base AS (
  SELECT
    id,
    name,
    batch,
    password_hash,
    COALESCE(
      NULLIF(
        LEFT(
          regexp_replace(
            regexp_replace(lower(regexp_replace(trim(name), '\s+', ' ', 'g')), '[^a-z0-9]+', '-', 'g'),
            '(^-+|-+$)', '', 'g'
          ),
          36
        ),
        ''
      ),
      'student'
    ) AS login_base
  FROM public.students
),
student_base_groups AS (
  SELECT login_base, count(*)::bigint AS base_count
  FROM student_base
  GROUP BY login_base
),
coursework_classification AS (
  SELECT
    ci.id,
    ci.batch,
    ci.item_type,
    ci.active,
    ci.deactivated_at,
    b.name AS matched_batch
  FROM public.coursework_items ci
  LEFT JOIN public.batches b ON b.name = ci.batch
),
linked_awards AS (
  SELECT
    s.id,
    s.student_id,
    s.batch,
    s.coursework_item_id,
    s.submitted_at,
    lower(btrim(coalesce(s.submission_type, ''))) AS submission_type,
    row_number() OVER (
      PARTITION BY s.student_id, s.coursework_item_id
      ORDER BY s.submitted_at, s.id
    ) AS item_attempt
  FROM public.submissions s
  JOIN public.coursework_items ci ON ci.id = s.coursework_item_id
  WHERE s.coursework_item_id IS NOT NULL
    AND s.submitted_at IS NOT NULL
    AND (s.submitted_at AT TIME ZONE 'Asia/Kolkata')::date
      BETWEEN DATE '2026-10-01' AND (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND s.batch = ci.batch
    AND lower(btrim(ci.item_type)) = CASE
      WHEN lower(btrim(coalesce(s.submission_type, ''))) IN ('assignment', '100') THEN 'assignment'
      WHEN lower(btrim(coalesce(s.submission_type, ''))) IN ('project', '200') THEN 'project'
      ELSE NULL
    END
),
activation_plan AS (
  SELECT
    count(*) FILTER (
      WHERE ci.active AND ci.deactivated_at IS NULL
        AND NULLIF(btrim(ci.batch), '') IS NOT NULL
        AND b.name IS NOT NULL
    )::bigint AS deterministic_mappings,
    count(*) FILTER (
      WHERE ci.active AND ci.deactivated_at IS NULL
        AND NULLIF(btrim(ci.batch), '') IS NULL
    )::bigint AS ambiguous_null_batch,
    count(*) FILTER (
      WHERE ci.active AND ci.deactivated_at IS NULL
        AND NULLIF(btrim(ci.batch), '') IS NOT NULL
        AND b.name IS NULL
    )::bigint AS invalid_unknown_batch,
    count(*) FILTER (WHERE NOT ci.active OR ci.deactivated_at IS NOT NULL)::bigint AS deactivated
  FROM coursework_classification ci
  LEFT JOIN public.batches b ON b.name = ci.batch
)
SELECT json_build_object(
  'database', current_database(),
  'objects', (SELECT row_to_json(object_state) FROM object_state),
  'students', json_build_object(
    'total', (SELECT count(*) FROM student_base),
    'eligible_for_login_backfill', (SELECT count(*) FROM student_base
      WHERE NULLIF(btrim(name), '') IS NOT NULL
        AND NULLIF(btrim(batch), '') IS NOT NULL
        AND NULLIF(btrim(password_hash), '') IS NOT NULL
    ),
    'invalid_accounts', (SELECT count(*) FROM student_base
      WHERE NULLIF(btrim(name), '') IS NULL
        OR NULLIF(btrim(batch), '') IS NULL
        OR NULLIF(btrim(password_hash), '') IS NULL
    ),
    'distinct_login_bases', (SELECT count(*) FROM student_base_groups),
    'duplicate_login_base_groups', (SELECT count(*) FROM student_base_groups WHERE base_count > 1),
    'rows_requiring_collision_suffix', (SELECT coalesce(sum(base_count - 1) FILTER (WHERE base_count > 1), 0) FROM student_base_groups),
    'bcrypt_hashes', (SELECT count(*) FROM student_base WHERE password_hash LIKE '$2%'),
    'sha256_hex_hashes', (SELECT count(*) FROM student_base WHERE password_hash ~ '^[0-9a-fA-F]{64}$')
  ),
  'coursework', json_build_object(
    'active_items', (SELECT count(*) FROM coursework_classification WHERE active AND deactivated_at IS NULL),
    'assignment_items', (SELECT count(*) FROM coursework_classification WHERE active AND deactivated_at IS NULL AND lower(btrim(item_type)) = 'assignment'),
    'project_items', (SELECT count(*) FROM coursework_classification WHERE active AND deactivated_at IS NULL AND lower(btrim(item_type)) = 'project'),
    'activation_plan', (SELECT row_to_json(activation_plan) FROM activation_plan)
  ),
  'linked_submission_awards', json_build_object(
    'linked_submissions', (SELECT count(*) FROM public.submissions WHERE coursework_item_id IS NOT NULL),
    'canonical_awards', (SELECT count(*) FROM linked_awards WHERE item_attempt = 1),
    'duplicate_awards_removed', (SELECT count(*) FROM linked_awards WHERE item_attempt > 1),
    'assignment_awards', (SELECT count(*) FROM linked_awards WHERE item_attempt = 1 AND submission_type IN ('assignment', '100')),
    'project_awards', (SELECT count(*) FROM linked_awards WHERE item_attempt = 1 AND submission_type IN ('project', '200'))
  ),
  'attendance', json_build_object(
    'total', (SELECT count(*) FROM public.student_attendance),
    'approved', (SELECT count(*) FROM public.student_attendance WHERE status = 'approved'),
    'pending', (SELECT count(*) FROM public.student_attendance WHERE status = 'pending'),
    'legacy_sessionless_pending', (SELECT count(*) FROM public.student_attendance WHERE status = 'pending' AND session_id IS NULL AND source = 'legacy'),
    'student_attendance_query_rows', (SELECT count(*) FROM public.student_attendance WHERE source = 'student_attendance_query')
  ),
  'health_rpc', json_build_object(
    'leaderboard_present', (SELECT leaderboard_rpc FROM object_state),
    'health_card_present', (SELECT health_card_rpc FROM object_state),
    'leaderboard_uses_activation_table', position('batch_coursework_assignments' IN coalesce(pg_get_functiondef(to_regprocedure('public.cf_health_card_leaderboard(text,date)')), '')) > 0,
    'leaderboard_has_coursework_only_total', position('coalesce(ct.assignment_completed, 0)::numeric * ps.assignment_points' IN coalesce(pg_get_functiondef(to_regprocedure('public.cf_health_card_leaderboard(text,date)')), '')) > 0
  ),
  'security', json_build_object(
    'students_allow_all_policy', EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'allow_all'
    ),
    'anon_can_select_students', has_table_privilege('anon', 'public.students', 'SELECT'),
    'authenticated_can_select_students', has_table_privilege('authenticated', 'public.students', 'SELECT')
  )
)::text;
