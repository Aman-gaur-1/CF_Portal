-- Student Health Card existing-student membership initialization.
-- Depends on 20261008120000_student_health_card_foundation.sql.
-- Uses no fabricated batch-history dates: students already present at the
-- Health Card epoch begin on the epoch; post-epoch registrations use their
-- India-local created_at date. Existing memberships are never overwritten.
-- Any pre-existing active membership is left untouched so an anomalous
-- cross-batch row cannot be duplicated by this backfill.

BEGIN;

INSERT INTO public.student_batch_memberships (student_id, batch, starts_on)
SELECT
  s.id,
  s.batch,
  CASE
    WHEN (s.created_at AT TIME ZONE 'Asia/Kolkata')::date > DATE '2026-10-01'
      THEN (s.created_at AT TIME ZONE 'Asia/Kolkata')::date
    ELSE DATE '2026-10-01'
  END AS starts_on
FROM public.students s
WHERE s.batch IS NOT NULL
  AND btrim(s.batch) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.student_batch_memberships existing
    WHERE existing.student_id = s.id
      AND existing.ends_on IS NULL
  )
ON CONFLICT (student_id, batch, starts_on) DO NOTHING;

COMMIT;
