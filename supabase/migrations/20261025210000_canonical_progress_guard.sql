-- Keep cumulative Batch Progress strictly canonical after the catalog
-- reconciliation. Existing legacy activations are preserved and remain
-- readable, but they cannot create new progress expectations.
BEGIN;

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
  IF v_batch IS NULL OR v_phase IS NULL OR v_item_type IS NULL OR p_covered_through_coursework_item_id IS NULL THEN
    RAISE EXCEPTION 'Batch, phase, type, and covered-through item are required' USING ERRCODE = '22023';
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
    AND c.catalog_status = 'canonical'
    AND c.batch IS NULL
    AND c.active
    AND c.phase = v_phase
    AND lower(btrim(c.item_type)) = v_item_type
    AND c.sort_order IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Covered-through item must be an active canonical item with explicit ordering' USING ERRCODE = '22023';
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
  WHERE c.catalog_status = 'canonical'
    AND c.batch IS NULL
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
  WHERE c.catalog_status = 'canonical'
    AND c.batch IS NULL
    AND c.active
    AND c.phase = v_phase
    AND lower(btrim(c.item_type)) = v_item_type
    AND c.sort_order IS NOT NULL
    AND c.sort_order <= v_item.sort_order
  ON CONFLICT (batch, coursework_item_id) DO UPDATE SET active = true, updated_at = now();

  SELECT count(*) INTO v_total_items
  FROM public.batch_coursework_assignments a
  JOIN public.coursework_items c ON c.id = a.coursework_item_id
  WHERE a.batch = v_batch AND a.active AND c.catalog_status = 'canonical'
    AND c.phase = v_phase AND lower(btrim(c.item_type)) = v_item_type;

  RETURN jsonb_build_object(
    'batch', v_batch, 'phase', v_phase, 'itemType', v_item_type,
    'coveredThroughItemId', v_item.id, 'coveredThroughSortOrder', v_item.sort_order,
    'newItemCount', v_new_items, 'activeItemCount', v_total_items,
    'backwardMovement', false, 'existingActivationsRetained', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_apply_batch_curriculum_progress(text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_apply_batch_curriculum_progress(text, text, text, uuid, text, text) TO service_role;

COMMIT;
