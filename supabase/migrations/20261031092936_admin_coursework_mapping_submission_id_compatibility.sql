-- The production submissions table uses bigint ids while the staging schema
-- uses uuid ids. Keep the correction API portable by storing the existing
-- source identifier as text, matching reconciliation.source_submission_id.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.coursework_mapping_corrections') IS NOT NULL THEN
    ALTER TABLE public.coursework_mapping_corrections
      DROP CONSTRAINT IF EXISTS coursework_mapping_corrections_submission_id_fkey;
    ALTER TABLE public.coursework_mapping_corrections
      ALTER COLUMN submission_id TYPE text USING submission_id::text;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.cf_correct_coursework_mapping(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.cf_correct_coursework_mapping(
  p_submission_id text,
  p_target_canonical_coursework_item_id uuid,
  p_reason text,
  p_admin_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submission_row public.submissions%ROWTYPE;
  target_row public.coursework_items%ROWTYPE;
  source_row public.coursework_items%ROWTYPE;
  old_canonical_row public.coursework_items%ROWTYPE;
  old_reconciliation public.student_coursework_reconciliations%ROWTYPE;
  target_reconciliation public.student_coursework_reconciliations%ROWTYPE;
  latest_correction public.coursework_mapping_corrections%ROWTYPE;
  correction_row public.coursework_mapping_corrections%ROWTYPE;
  old_item_id uuid;
  reconciliation_id uuid;
BEGIN
  IF p_submission_id IS NULL OR p_target_canonical_coursework_item_id IS NULL THEN
    RAISE EXCEPTION 'Submission and target canonical coursework are required' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 OR length(btrim(COALESCE(p_reason, ''))) > 500 THEN
    RAISE EXCEPTION 'A correction reason between 5 and 500 characters is required' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_admin_name, ''))) = 0 OR length(btrim(p_admin_name)) > 160 THEN
    RAISE EXCEPTION 'Admin identity is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO submission_row FROM public.submissions WHERE id::text = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submission was not found' USING ERRCODE = '22023'; END IF;

  SELECT * INTO target_row
  FROM public.coursework_items
  WHERE id = p_target_canonical_coursework_item_id
    AND catalog_status = 'canonical'
    AND batch IS NULL
    AND active
    AND deactivated_at IS NULL
    AND lower(btrim(item_type)) IN ('assignment', 'project')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active canonical coursework item' USING ERRCODE = '22023'; END IF;

  SELECT * INTO latest_correction
  FROM public.coursework_mapping_corrections
  WHERE submission_id = submission_row.id::text
  ORDER BY corrected_at DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    old_item_id := latest_correction.new_canonical_coursework_item_id;
  ELSE
    IF submission_row.coursework_item_id IS NOT NULL THEN
      SELECT * INTO source_row FROM public.coursework_items WHERE id = submission_row.coursework_item_id;
      IF FOUND THEN
        old_item_id := CASE WHEN source_row.catalog_status = 'canonical' THEN source_row.id ELSE source_row.canonical_coursework_item_id END;
      END IF;
    END IF;
    IF old_item_id IS NULL THEN
      SELECT * INTO old_reconciliation
      FROM public.student_coursework_reconciliations
      WHERE student_id = submission_row.student_id AND source_submission_id = submission_row.id::text
      ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1 FOR UPDATE;
      IF FOUND THEN old_item_id := old_reconciliation.coursework_item_id; END IF;
    END IF;
  END IF;

  IF old_item_id IS NOT NULL THEN
    SELECT * INTO old_canonical_row FROM public.coursework_items WHERE id = old_item_id;
  END IF;
  IF old_item_id = target_row.id THEN
    RAISE EXCEPTION 'This submission is already mapped to the selected coursework' USING ERRCODE = '22023';
  END IF;

  IF old_item_id IS NOT NULL THEN
    SELECT * INTO old_reconciliation
    FROM public.student_coursework_reconciliations
    WHERE student_id = submission_row.student_id
      AND coursework_item_id = old_item_id
      AND source_submission_id = submission_row.id::text
    FOR UPDATE;
  END IF;
  SELECT * INTO target_reconciliation
  FROM public.student_coursework_reconciliations
  WHERE student_id = submission_row.student_id AND coursework_item_id = target_row.id
  FOR UPDATE;

  IF submission_row.coursework_item_id IS NOT NULL THEN
    UPDATE public.submissions
    SET coursework_item_id = target_row.id, submission_type = lower(btrim(target_row.item_type))
    WHERE id::text = submission_row.id::text;
  END IF;

  IF old_reconciliation.id IS NOT NULL
    AND old_reconciliation.id IS DISTINCT FROM target_reconciliation.id
    AND (submission_row.coursework_item_id IS NOT NULL OR target_reconciliation.id IS NOT NULL) THEN
    UPDATE public.student_coursework_reconciliations
    SET status = 'rejected', counts_for_progress = false, counts_for_points = false,
        confirmed_by = btrim(p_admin_name), confirmed_at = now(), updated_at = now()
    WHERE id = old_reconciliation.id;
  END IF;

  IF submission_row.coursework_item_id IS NULL AND target_reconciliation.id IS NULL THEN
    IF old_reconciliation.id IS NOT NULL THEN
      UPDATE public.student_coursework_reconciliations
      SET coursework_item_id = target_row.id, phase = target_row.phase,
          item_type = lower(btrim(target_row.item_type)), confidence = 'confirmed',
          status = 'confirmed', counts_for_progress = true, counts_for_points = true,
          confirmed_by = btrim(p_admin_name), confirmed_at = now(), updated_at = now()
      WHERE id = old_reconciliation.id
      RETURNING id INTO reconciliation_id;
    ELSE
      INSERT INTO public.student_coursework_reconciliations (
        student_id, batch, coursework_item_id, source_submission_id, source_topic,
        phase, item_type, confidence, status, counts_for_progress, counts_for_points,
        confirmed_by, confirmed_at
      ) VALUES (
        submission_row.student_id, submission_row.batch, target_row.id, submission_row.id::text,
        submission_row.topic, target_row.phase, lower(btrim(target_row.item_type)),
        'confirmed', 'confirmed', true, true, btrim(p_admin_name), now()
      ) RETURNING id INTO reconciliation_id;
    END IF;
  ELSE
    reconciliation_id := target_reconciliation.id;
  END IF;

  INSERT INTO public.coursework_mapping_corrections (
    submission_id, student_id, student_name, batch,
    old_canonical_coursework_item_id, old_canonical_title, old_canonical_phase, old_item_type,
    new_canonical_coursework_item_id, new_canonical_title, new_canonical_phase, new_item_type,
    admin_name, reason
  ) VALUES (
    submission_row.id::text, submission_row.student_id, COALESCE(submission_row.student_name, ''), submission_row.batch,
    old_canonical_row.id, old_canonical_row.title, old_canonical_row.phase, lower(btrim(old_canonical_row.item_type)),
    target_row.id, target_row.title, target_row.phase, lower(btrim(target_row.item_type)),
    btrim(p_admin_name), btrim(p_reason)
  ) RETURNING * INTO correction_row;

  RETURN jsonb_build_object(
    'correctionId', correction_row.id, 'submissionId', submission_row.id::text,
    'studentId', submission_row.student_id, 'oldCanonicalCourseworkItemId', old_canonical_row.id,
    'newCanonicalCourseworkItemId', target_row.id, 'newCanonicalTitle', target_row.title,
    'newCanonicalPhase', target_row.phase, 'newItemType', lower(btrim(target_row.item_type)),
    'reconciliationId', reconciliation_id, 'correctedAt', correction_row.corrected_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_correct_coursework_mapping(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_correct_coursework_mapping(text, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
