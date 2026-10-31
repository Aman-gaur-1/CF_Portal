-- Complete reconciliation for canonical-seeded and high-confidence aliases
-- that predate the authoritative alias repair. This keeps the SQL Health Card
-- and My Submissions on the same canonical completion facts.

BEGIN;

UPDATE public.coursework_items legacy
SET canonical_coursework_item_id = a.canonical_coursework_item_id,
    catalog_status = 'legacy',
    updated_at = now()
FROM public.coursework_aliases a
WHERE a.mapping_status = 'mapped'
  AND a.confidence IN ('CONFIRMED', 'EXACT', 'HIGH_CONFIDENCE')
  AND a.source_phase = COALESCE(NULLIF(btrim(legacy.phase), ''), '')
  AND a.source_item_type = lower(btrim(COALESCE(legacy.item_type, '')))
  AND a.normalized_alias = public.normalize_coursework_alias(legacy.title)
  AND legacy.catalog_status <> 'canonical'
  AND legacy.canonical_coursework_item_id IS DISTINCT FROM a.canonical_coursework_item_id;

WITH eligible AS (
  SELECT
    s.id::text AS source_submission_id,
    s.student_id,
    s.batch,
    s.topic AS source_topic,
    a.canonical_coursework_item_id,
    canonical.phase AS canonical_phase,
    canonical.item_type AS canonical_item_type,
    row_number() OVER (
      PARTITION BY s.student_id, a.canonical_coursework_item_id
      ORDER BY s.submitted_at NULLS FIRST, s.id
    ) AS completion_rank
  FROM public.submissions s
  JOIN public.coursework_aliases a
    ON a.normalized_alias = public.normalize_coursework_alias(s.topic)
   AND a.mapping_status = 'mapped'
   AND a.confidence IN ('CONFIRMED', 'EXACT', 'HIGH_CONFIDENCE')
   AND lower(btrim(a.source_phase)) = lower(btrim(COALESCE(s.phase, '')))
   AND a.source_item_type = CASE
     WHEN lower(btrim(COALESCE(s.submission_type, ''))) IN ('100', 'assignment') THEN 'assignment'
     WHEN lower(btrim(COALESCE(s.submission_type, ''))) IN ('200', 'project') THEN 'project'
     ELSE ''
   END
  JOIN public.coursework_items canonical
    ON canonical.id = a.canonical_coursework_item_id
   AND canonical.catalog_status = 'canonical'
   AND canonical.batch IS NULL
   AND canonical.active
   AND lower(btrim(COALESCE(s.phase, ''))) = lower(btrim(canonical.phase))
  LEFT JOIN public.coursework_items source_item
    ON source_item.id = s.coursework_item_id
  WHERE (s.coursework_item_id IS NULL OR source_item.catalog_status <> 'canonical')
)
INSERT INTO public.student_coursework_reconciliations AS existing (
  student_id, batch, coursework_item_id, source_submission_id, source_topic,
  phase, item_type, confidence, status, counts_for_progress, counts_for_points,
  confirmed_by, confirmed_at
)
SELECT
  student_id, batch, canonical_coursework_item_id, source_submission_id,
  source_topic, canonical_phase, canonical_item_type, 'confirmed', 'confirmed',
  true, true, 'canonical-historical-reconciliation', now()
FROM eligible
WHERE completion_rank = 1
ON CONFLICT (student_id, coursework_item_id) DO UPDATE SET
  batch = EXCLUDED.batch,
  phase = EXCLUDED.phase,
  item_type = EXCLUDED.item_type,
  confidence = 'confirmed',
  status = 'confirmed',
  counts_for_progress = true,
  counts_for_points = true,
  confirmed_by = CASE
    WHEN existing.confirmed_by = 'manual-authoritative-alias-reconciliation'
      THEN existing.confirmed_by
    ELSE 'canonical-historical-reconciliation'
  END,
  confirmed_at = COALESCE(existing.confirmed_at, EXCLUDED.confirmed_at),
  updated_at = now();

COMMIT;
