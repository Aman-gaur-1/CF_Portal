-- Use the authoritative batch start for initial Health Card eligibility.
-- Transfers continue to start on the actual transfer date. The targeted
-- backfill below changes membership dates only; it never rewrites attendance,
-- submissions, coursework, credentials, or identity data.

BEGIN;

ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS starts_on date;

ALTER TABLE public.student_batch_memberships
  ADD COLUMN IF NOT EXISTS membership_source text NOT NULL DEFAULT 'legacy';

COMMENT ON COLUMN public.batches.starts_on IS
  'Authoritative start date for initial student membership eligibility.';

COMMENT ON COLUMN public.student_batch_memberships.membership_source IS
  'How the membership start was established: legacy, batch_start, explicit_join_date, or transfer.';

CREATE INDEX IF NOT EXISTS batches_starts_on_idx
  ON public.batches (starts_on, created_at);

-- This is the only production batch whose historical start date is currently
-- confirmed from the attendance session and batch roster evidence.
UPDATE public.batches
SET starts_on = DATE '2026-11-02'
WHERE name = 'AG | PY | DA | 2 Nov 26 | 8:15 PM'
  AND starts_on IS DISTINCT FROM DATE '2026-11-02';

-- Correct only high-confidence initial memberships in the confirmed batch:
--   * no prior membership in another batch;
--   * the membership was created with the student account (within 5 seconds);
--   * no existing membership already starts on the authoritative date.
-- This deliberately leaves transfers and ambiguous/later explicit joins alone.
WITH target_batch AS (
  SELECT name, starts_on
  FROM public.batches
  WHERE name = 'AG | PY | DA | 2 Nov 26 | 8:15 PM'
    AND starts_on IS NOT NULL
), eligible_memberships AS (
  SELECT m.id, b.starts_on
  FROM public.student_batch_memberships m
  JOIN target_batch b ON b.name = m.batch
  JOIN public.students s ON s.id = m.student_id
  WHERE m.ends_on IS NULL
    AND m.starts_on > b.starts_on
    AND m.membership_source = 'legacy'
    AND abs(extract(epoch FROM (m.created_at - s.created_at))) <= 5
    AND NOT EXISTS (
      SELECT 1
      FROM public.student_batch_memberships previous
      WHERE previous.student_id = m.student_id
        AND previous.id <> m.id
        AND previous.batch <> m.batch
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.student_batch_memberships existing_start
      WHERE existing_start.student_id = m.student_id
        AND existing_start.batch = m.batch
        AND existing_start.starts_on = b.starts_on
        AND existing_start.id <> m.id
    )
)
UPDATE public.student_batch_memberships m
SET starts_on = e.starts_on,
    membership_source = 'batch_start_backfill',
    updated_at = now()
FROM eligible_memberships e
WHERE m.id = e.id;

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
  batch_start date;
  initial_date date;
  initial_source text;
BEGIN
  IF NEW.batch IS NULL OR btrim(NEW.batch) = '' THEN
    RETURN NEW;
  END IF;

  SELECT b.starts_on
  INTO batch_start
  FROM public.batches b
  WHERE b.name = NEW.batch;

  IF TG_OP = 'INSERT' THEN
    initial_date := GREATEST(
      DATE '2026-10-01',
      COALESCE(
        batch_start,
        (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date,
        transition_date
      )
    );
    initial_source := CASE
      WHEN batch_start IS NULL THEN 'legacy_initial'
      ELSE 'batch_start'
    END;

    INSERT INTO public.student_batch_memberships
      (student_id, batch, starts_on, membership_source)
    VALUES (NEW.id, NEW.batch, initial_date, initial_source)
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

    INSERT INTO public.student_batch_memberships
      (student_id, batch, starts_on, membership_source)
    VALUES (NEW.id, NEW.batch, transition_date, 'transfer')
    ON CONFLICT (student_id, batch, starts_on) DO NOTHING;
  ELSE
    -- Preserve the legacy same-batch update behavior for rows that do not
    -- otherwise have an active membership fact.
    INSERT INTO public.student_batch_memberships
      (student_id, batch, starts_on, membership_source)
    VALUES (NEW.id, NEW.batch, transition_date, 'legacy_same_batch')
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

REVOKE ALL ON FUNCTION public.cf_sync_student_batch_membership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_sync_student_batch_membership() TO service_role;

COMMIT;
