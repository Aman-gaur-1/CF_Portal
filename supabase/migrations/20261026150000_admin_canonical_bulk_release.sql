BEGIN;

-- The Extras review view is intentionally separate from the normal Admin
-- curriculum read. Keep its existing fields and semantics, but aggregate the
-- historical submissions once instead of running several correlated scans for
-- every alias.
CREATE OR REPLACE VIEW public.coursework_catalog_extras
WITH (security_invoker = true)
AS
WITH submission_base AS MATERIALIZED (
  SELECT
    s.id,
    s.topic,
    s.student_id,
    s.batch,
    s.submitted_at,
    public.normalize_coursework_alias(s.topic) AS normalized_alias,
    COALESCE(s.phase, '') AS source_phase,
    lower(btrim(COALESCE(s.submission_type, ''))) AS source_item_type
  FROM public.submissions s
  WHERE NULLIF(btrim(COALESCE(s.topic, '')), '') IS NOT NULL
),
alias_stats AS (
  SELECT
    a.id AS alias_id,
    count(*) FILTER (
      WHERE a.source_item_type = ''
        OR b.source_item_type IN (a.source_item_type, CASE WHEN a.source_item_type = 'assignment' THEN '100' ELSE '200' END)
    )::bigint AS submission_count,
    count(DISTINCT b.student_id)::bigint AS student_count,
    count(DISTINCT b.batch)::bigint AS batch_count,
    min(b.submitted_at) AS first_seen,
    max(b.submitted_at) AS last_seen
  FROM public.coursework_aliases a
  LEFT JOIN submission_base b
    ON b.normalized_alias = a.normalized_alias
   AND (a.source_phase = '' OR b.source_phase = a.source_phase)
  WHERE a.mapping_status <> 'mapped'
  GROUP BY a.id
)
SELECT
  a.id AS alias_id,
  a.normalized_alias,
  a.original_alias,
  a.source_phase,
  a.source_item_type,
  COALESCE(a.canonical_phase, NULLIF(a.source_phase, '')) AS suggested_phase,
  COALESCE(a.canonical_item_type, NULLIF(a.source_item_type, '')) AS suggested_item_type,
  a.canonical_coursework_item_id AS suggested_canonical_coursework_item_id,
  a.source,
  a.confidence,
  a.mapping_status,
  COALESCE(s.submission_count, 0)::bigint AS submission_count,
  COALESCE(s.student_count, 0)::bigint AS student_count,
  COALESCE(s.batch_count, 0)::bigint AS batch_count,
  s.first_seen,
  s.last_seen,
  COALESCE(sample.example_submissions, '[]'::jsonb) AS example_submissions
FROM public.coursework_aliases a
LEFT JOIN alias_stats s ON s.alias_id = a.id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(sample_row.topic ORDER BY sample_row.submitted_at NULLS FIRST, sample_row.id) AS example_submissions
  FROM (
    SELECT b.topic, b.submitted_at, b.id
    FROM submission_base b
    WHERE b.normalized_alias = a.normalized_alias
    ORDER BY b.submitted_at NULLS FIRST, b.id
    LIMIT 3
  ) sample_row
) sample ON true
WHERE a.mapping_status <> 'mapped';

REVOKE ALL ON public.coursework_catalog_extras FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.coursework_catalog_extras TO service_role;

CREATE OR REPLACE FUNCTION public.cf_bulk_coursework_release(
  p_mode text,
  p_batches text[],
  p_coursework_item_ids uuid[],
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
  v_mode text := lower(btrim(COALESCE(p_mode, '')));
  v_phase text := NULLIF(btrim(COALESCE(p_phase, '')), '');
  v_item_type text := NULLIF(lower(btrim(COALESCE(p_item_type, ''))), '');
  v_batches text[];
  v_item_ids uuid[];
  v_item_id uuid;
  v_target public.coursework_items%ROWTYPE;
  v_item public.coursework_items%ROWTYPE;
  v_batch text;
  v_current public.batch_curriculum_progress%ROWTYPE;
  v_existing_item_id uuid;
  v_batch_students bigint;
  v_batch_new bigint;
  v_batch_already bigint;
  v_batch_duplicate bigint;
  v_batch_expected bigint;
  v_total_new bigint := 0;
  v_total_already bigint := 0;
  v_total_duplicate bigint := 0;
  v_total_expected bigint := 0;
  v_total_students bigint := 0;
  v_results jsonb := '[]'::jsonb;
  v_candidate_count bigint;
  v_distinct_batch_count bigint;
  v_now timestamptz := now();
BEGIN
  IF p_updated_by_role <> 'admin' THEN
    RAISE EXCEPTION 'Bulk coursework release is admin-only' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('select-topics', 'covered-through') THEN
    RAISE EXCEPTION 'Bulk release mode is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_batches IS NULL OR cardinality(p_batches) = 0 OR cardinality(p_batches) > 500 THEN
    RAISE EXCEPTION 'At least one and no more than 500 target batches are required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT NULLIF(btrim(batch_name), '') ORDER BY NULLIF(btrim(batch_name), ''))
    INTO v_batches
  FROM unnest(p_batches) AS input(batch_name);
  IF v_batches IS NULL OR cardinality(v_batches) <> cardinality(p_batches) THEN
    RAISE EXCEPTION 'Target batches must be unique and non-empty' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_distinct_batch_count
  FROM public.batches b
  WHERE b.name = ANY(v_batches);
  IF v_distinct_batch_count <> cardinality(v_batches) THEN
    RAISE EXCEPTION 'Every target batch must exist' USING ERRCODE = '22023';
  END IF;

  IF v_mode = 'covered-through' THEN
    IF v_phase NOT IN ('Python', 'Data Analytics', 'SQL') OR v_item_type NOT IN ('assignment', 'project') OR p_covered_through_coursework_item_id IS NULL THEN
      RAISE EXCEPTION 'Covered-through phase, type, and item are required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM public.coursework_items c
    WHERE c.id = p_covered_through_coursework_item_id
      AND c.catalog_status = 'canonical'
      AND c.batch IS NULL
      AND c.active
      AND c.phase = v_phase
      AND lower(btrim(c.item_type)) = v_item_type
      AND c.sort_order IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Covered-through item must be an active canonical item with explicit ordering' USING ERRCODE = '22023';
    END IF;
    v_item_ids := ARRAY(
      SELECT c.id
      FROM public.coursework_items c
      WHERE c.catalog_status = 'canonical'
        AND c.batch IS NULL
        AND c.active
        AND c.phase = v_phase
        AND lower(btrim(c.item_type)) = v_item_type
        AND c.sort_order IS NOT NULL
        AND c.sort_order <= v_target.sort_order
      ORDER BY c.sort_order, c.title, c.id
    );
  ELSE
    IF v_phase NOT IN ('Python', 'Data Analytics', 'SQL') OR v_item_type NOT IN ('assignment', 'project') THEN
      RAISE EXCEPTION 'Select-topics phase and type are required' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT item_id) INTO v_item_ids
    FROM unnest(COALESCE(p_coursework_item_ids, '{}'::uuid[])) AS input(item_id);
    IF v_item_ids IS NULL OR cardinality(v_item_ids) = 0 OR cardinality(v_item_ids) > 200 THEN
      RAISE EXCEPTION 'Select between one and 200 coursework items' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_candidate_count
    FROM public.coursework_items c
    WHERE c.id = ANY(v_item_ids)
      AND c.catalog_status = 'canonical'
      AND c.batch IS NULL
      AND c.active
      AND c.phase = v_phase
      AND lower(btrim(c.item_type)) = v_item_type
      AND c.sort_order IS NOT NULL;
    IF v_candidate_count <> cardinality(v_item_ids) THEN
      RAISE EXCEPTION 'Every selected item must be an active ordered canonical item in the selected phase and type' USING ERRCODE = '22023';
    END IF;
  END IF;

  FOREACH v_batch IN ARRAY v_batches LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_batch || '|canonical-coursework-release', 0));
    SELECT count(*) INTO v_batch_students
    FROM public.students s
    WHERE s.batch = v_batch AND s.status = 'active';
    v_batch_new := 0;
    v_batch_already := 0;
    v_batch_duplicate := 0;

    IF v_mode = 'covered-through' THEN
      SELECT * INTO v_current
      FROM public.batch_curriculum_progress p
      WHERE p.batch = v_batch AND p.phase = v_phase AND p.item_type = v_item_type
      FOR UPDATE;
      IF FOUND AND v_current.covered_through_sort_order > v_target.sort_order THEN
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'batch', v_batch, 'status', 'already_beyond', 'currentSortOrder', v_current.covered_through_sort_order,
          'requestedSortOrder', v_target.sort_order, 'newActivations', 0, 'alreadyActive', 0,
          'duplicateEquivalentSkipped', 0, 'activeStudentCount', v_batch_students, 'expectedPendingImpact', 0
        ));
        v_total_students := v_total_students + v_batch_students;
        CONTINUE;
      END IF;
    END IF;

    FOREACH v_item_id IN ARRAY v_item_ids LOOP
      SELECT * INTO v_item FROM public.coursework_items WHERE id = v_item_id;
      v_existing_item_id := NULL;
      SELECT active_item.id INTO v_existing_item_id
      FROM public.batch_coursework_assignments a
      JOIN public.coursework_items active_item ON active_item.id = a.coursework_item_id
      WHERE a.batch = v_batch
        AND a.active
        AND (
          active_item.id = v_item.id
          OR active_item.canonical_coursework_item_id = v_item.id
          OR (
            lower(btrim(COALESCE(active_item.phase, ''))) = lower(btrim(COALESCE(v_item.phase, '')))
            AND lower(btrim(COALESCE(active_item.item_type, ''))) = lower(btrim(COALESCE(v_item.item_type, '')))
            AND regexp_replace(lower(btrim(COALESCE(active_item.title, ''))), '\s+', ' ', 'g') = regexp_replace(lower(btrim(COALESCE(v_item.title, ''))), '\s+', ' ', 'g')
          )
        )
      ORDER BY CASE WHEN active_item.id = v_item.id THEN 0 ELSE 1 END, a.activated_at, a.id
      LIMIT 1;
      IF v_existing_item_id IS NOT NULL THEN
        v_batch_already := v_batch_already + 1;
        IF v_existing_item_id <> v_item.id THEN
          v_batch_duplicate := v_batch_duplicate + 1;
        END IF;
      ELSE
        INSERT INTO public.batch_coursework_assignments (
          batch, coursework_item_id, activated_at, activated_by_role,
          activated_by_name, due_at, active, updated_at
        ) VALUES (
          v_batch, v_item.id, v_now, p_updated_by_role,
          COALESCE(NULLIF(btrim(p_updated_by_name), ''), 'admin'), NULL, true, v_now
        )
        ON CONFLICT (batch, coursework_item_id) DO UPDATE SET
          active = true,
          activated_by_role = EXCLUDED.activated_by_role,
          activated_by_name = EXCLUDED.activated_by_name,
          updated_at = EXCLUDED.updated_at;
        v_batch_new := v_batch_new + 1;
      END IF;
    END LOOP;

    IF v_mode = 'covered-through' THEN
      INSERT INTO public.batch_curriculum_progress (
        batch, phase, item_type, covered_through_coursework_item_id,
        covered_through_sort_order, updated_by_role, updated_by_name, updated_at
      ) VALUES (
        v_batch, v_phase, v_item_type, v_target.id, v_target.sort_order,
        p_updated_by_role, COALESCE(NULLIF(btrim(p_updated_by_name), ''), 'admin'), v_now
      )
      ON CONFLICT (batch, phase, item_type) DO UPDATE SET
        covered_through_coursework_item_id = EXCLUDED.covered_through_coursework_item_id,
        covered_through_sort_order = EXCLUDED.covered_through_sort_order,
        updated_by_role = EXCLUDED.updated_by_role,
        updated_by_name = EXCLUDED.updated_by_name,
        updated_at = EXCLUDED.updated_at
      WHERE public.batch_curriculum_progress.covered_through_sort_order <= EXCLUDED.covered_through_sort_order;
    END IF;

    v_batch_expected := v_batch_new * v_batch_students;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'batch', v_batch, 'status', 'advanced', 'newActivations', v_batch_new,
      'alreadyActive', v_batch_already, 'duplicateEquivalentSkipped', v_batch_duplicate,
      'activeStudentCount', v_batch_students, 'expectedPendingImpact', v_batch_expected
    ));
    v_total_new := v_total_new + v_batch_new;
    v_total_already := v_total_already + v_batch_already;
    v_total_duplicate := v_total_duplicate + v_batch_duplicate;
    v_total_expected := v_total_expected + v_batch_expected;
    v_total_students := v_total_students + v_batch_students;
  END LOOP;

  RETURN jsonb_build_object(
    'mode', v_mode,
    'targetBatches', to_jsonb(v_batches),
    'newActivations', v_total_new,
    'alreadyActive', v_total_already,
    'duplicateEquivalentSkipped', v_total_duplicate,
    'activeStudentsAffected', v_total_students,
    'expectedPendingImpact', v_total_expected,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_bulk_coursework_release(text, text[], uuid[], text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_bulk_coursework_release(text, text[], uuid[], text, text, uuid, text, text) TO service_role;

COMMIT;
