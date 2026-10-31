-- Admin-only, canonical-coursework mapping corrections.
--
-- A correction changes the canonical interpretation of a submission. It never
-- accepts or stores a client-supplied score, and it never deletes the original
-- submission or its evidence. The append-only history is the per-submission
-- authority when present; the existing Health Card reconciliation remains the
-- point-bearing student+canonical-item fact and is deduplicated safely.

BEGIN;

CREATE TABLE IF NOT EXISTS public.coursework_mapping_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Production currently uses bigint submission ids while staging uses uuid.
  -- The existing reconciliation source id is already text for this reason.
  submission_id text NOT NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  student_name text NOT NULL,
  batch text NOT NULL,
  old_canonical_coursework_item_id uuid REFERENCES public.coursework_items(id) ON DELETE SET NULL,
  old_canonical_title text,
  old_canonical_phase text,
  old_item_type text,
  new_canonical_coursework_item_id uuid NOT NULL REFERENCES public.coursework_items(id) ON DELETE RESTRICT,
  new_canonical_title text NOT NULL,
  new_canonical_phase text NOT NULL,
  new_item_type text NOT NULL,
  admin_name text NOT NULL,
  reason text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coursework_mapping_corrections_old_type_check
    CHECK (old_item_type IS NULL OR old_item_type IN ('assignment', 'project')),
  CONSTRAINT coursework_mapping_corrections_new_type_check
    CHECK (new_item_type IN ('assignment', 'project')),
  CONSTRAINT coursework_mapping_corrections_reason_check
    CHECK (length(btrim(reason)) BETWEEN 5 AND 500)
);

CREATE INDEX IF NOT EXISTS coursework_mapping_corrections_submission_idx
  ON public.coursework_mapping_corrections (submission_id, corrected_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS coursework_mapping_corrections_student_idx
  ON public.coursework_mapping_corrections (student_id, corrected_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS coursework_mapping_corrections_old_item_idx
  ON public.coursework_mapping_corrections (old_canonical_coursework_item_id);

CREATE INDEX IF NOT EXISTS coursework_mapping_corrections_new_item_idx
  ON public.coursework_mapping_corrections (new_canonical_coursework_item_id);

ALTER TABLE public.coursework_mapping_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.coursework_mapping_corrections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.coursework_mapping_corrections FROM service_role;
GRANT SELECT ON TABLE public.coursework_mapping_corrections TO service_role;

DROP POLICY IF EXISTS coursework_mapping_corrections_deny_public ON public.coursework_mapping_corrections;
CREATE POLICY coursework_mapping_corrections_deny_public
  ON public.coursework_mapping_corrections
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.cf_prevent_coursework_mapping_correction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Coursework mapping correction history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS coursework_mapping_corrections_immutable ON public.coursework_mapping_corrections;
CREATE TRIGGER coursework_mapping_corrections_immutable
BEFORE UPDATE OR DELETE ON public.coursework_mapping_corrections
FOR EACH ROW
EXECUTE FUNCTION public.cf_prevent_coursework_mapping_correction_mutation();

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

  SELECT * INTO submission_row
  FROM public.submissions
  WHERE id::text = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission was not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO target_row
  FROM public.coursework_items
  WHERE id = p_target_canonical_coursework_item_id
    AND catalog_status = 'canonical'
    AND batch IS NULL
    AND active
    AND deactivated_at IS NULL
    AND lower(btrim(item_type)) IN ('assignment', 'project')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an active canonical coursework item' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO latest_correction
  FROM public.coursework_mapping_corrections
  WHERE submission_id = submission_row.id
  ORDER BY corrected_at DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    old_item_id := latest_correction.new_canonical_coursework_item_id;
  ELSE
    IF submission_row.coursework_item_id IS NOT NULL THEN
      SELECT * INTO source_row
      FROM public.coursework_items
      WHERE id = submission_row.coursework_item_id;
      IF FOUND THEN
        old_item_id := CASE
          WHEN source_row.catalog_status = 'canonical' THEN source_row.id
          ELSE source_row.canonical_coursework_item_id
        END;
      END IF;
    END IF;

    IF old_item_id IS NULL THEN
      SELECT * INTO old_reconciliation
      FROM public.student_coursework_reconciliations
      WHERE student_id = submission_row.student_id
        AND source_submission_id = submission_row.id::text
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE;
      IF FOUND THEN old_item_id := old_reconciliation.coursework_item_id; END IF;
    END IF;
  END IF;

  IF old_item_id IS NOT NULL THEN
    SELECT * INTO old_canonical_row
    FROM public.coursework_items
    WHERE id = old_item_id;
  END IF;

  IF old_item_id = target_row.id THEN
    RAISE EXCEPTION 'This submission is already mapped to the selected coursework' USING ERRCODE = '22023';
  END IF;

  -- Lock any existing source reconciliation before deciding whether the target
  -- can reuse it. The unique student+canonical-item index prevents duplicate
  -- point-bearing rows, while the correction history preserves the submission
  -- level interpretation.
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
  WHERE student_id = submission_row.student_id
    AND coursework_item_id = target_row.id
  FOR UPDATE;

  IF submission_row.coursework_item_id IS NOT NULL THEN
    -- Direct links are the authoritative current submission link. The trigger
    -- and this server-derived value keep submission_type aligned to the item.
    UPDATE public.submissions
    SET coursework_item_id = target_row.id,
        submission_type = lower(btrim(target_row.item_type))
    WHERE id = submission_row.id;
  END IF;

  IF old_reconciliation.id IS NOT NULL
    AND old_reconciliation.id IS DISTINCT FROM target_reconciliation.id
    AND (submission_row.coursework_item_id IS NOT NULL OR target_reconciliation.id IS NOT NULL) THEN
    UPDATE public.student_coursework_reconciliations
    SET status = 'rejected',
        counts_for_progress = false,
        counts_for_points = false,
        confirmed_by = btrim(p_admin_name),
        confirmed_at = now(),
        updated_at = now()
    WHERE id = old_reconciliation.id;
  END IF;

  IF submission_row.coursework_item_id IS NULL AND target_reconciliation.id IS NULL THEN
    IF old_reconciliation.id IS NOT NULL THEN
      UPDATE public.student_coursework_reconciliations
      SET coursework_item_id = target_row.id,
          phase = target_row.phase,
          item_type = lower(btrim(target_row.item_type)),
          confidence = 'confirmed',
          status = 'confirmed',
          counts_for_progress = true,
          counts_for_points = true,
          confirmed_by = btrim(p_admin_name),
          confirmed_at = now(),
          updated_at = now()
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
      )
      RETURNING id INTO reconciliation_id;
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
    submission_row.id, submission_row.student_id, COALESCE(submission_row.student_name, ''), submission_row.batch,
    old_canonical_row.id, old_canonical_row.title, old_canonical_row.phase, lower(btrim(old_canonical_row.item_type)),
    target_row.id, target_row.title, target_row.phase, lower(btrim(target_row.item_type)),
    btrim(p_admin_name), btrim(p_reason)
  )
  RETURNING * INTO correction_row;

  RETURN jsonb_build_object(
    'correctionId', correction_row.id,
    'submissionId', submission_row.id,
    'studentId', submission_row.student_id,
    'oldCanonicalCourseworkItemId', old_canonical_row.id,
    'newCanonicalCourseworkItemId', target_row.id,
    'newCanonicalTitle', target_row.title,
    'newCanonicalPhase', target_row.phase,
    'newItemType', lower(btrim(target_row.item_type)),
    'reconciliationId', reconciliation_id,
    'correctedAt', correction_row.corrected_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cf_correct_coursework_mapping(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_correct_coursework_mapping(text, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.cf_prevent_coursework_mapping_correction_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_prevent_coursework_mapping_correction_mutation() TO service_role;

COMMENT ON TABLE public.coursework_mapping_corrections IS
  'Append-only Admin audit and current per-submission canonical mapping authority.';

NOTIFY pgrst, 'reload schema';

COMMIT;
