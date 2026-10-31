-- Promote every confirmed canonical reconciliation to the unified point model.
-- The reconciliation row and original submission remain unchanged; only the
-- explicit point-eligibility flag is backfilled. A historical batch value is
-- not used as a gate because the student may have since transferred batches.

BEGIN;

UPDATE public.student_coursework_reconciliations r
SET counts_for_points = true
FROM public.students s,
     public.coursework_items c
WHERE r.student_id = s.id
  AND c.id = r.coursework_item_id
  AND r.status = 'confirmed'
  AND r.counts_for_progress
  AND r.confidence IN ('confirmed', 'high_confidence')
  AND c.catalog_status = 'canonical'
  AND lower(btrim(c.item_type)) = lower(btrim(r.item_type))
  AND (c.batch IS NULL OR c.batch = s.batch OR c.batch = r.batch)
  AND r.counts_for_points IS DISTINCT FROM true;

COMMIT;
