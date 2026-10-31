-- Repair high-confidence Python historical aliases without changing the
-- unified 5/10 scoring model or rewriting source submissions.
--
-- Every alias is phase- and type-scoped. In particular, Python "variables"
-- cannot match SQL "Variables and Table Variables" because the source phase
-- is part of the identity and eligibility predicate.

BEGIN;

WITH authoritative(alias_text, canonical_key) AS (
  VALUES
    ('advance function', 'python_assignment_11'),
    ('advanced function', 'python_assignment_11'),
    ('advance functions', 'python_assignment_11'),
    ('advanced functions', 'python_assignment_11'),
    ('ADVANCE_FUNCTION_ASSIGNMENTS', 'python_assignment_11'),
    ('basic function', 'python_assignment_04'),
    ('basic functions', 'python_assignment_04'),
    ('data type', 'python_assignment_01'),
    ('data types', 'python_assignment_01'),
    ('variable', 'python_assignment_01'),
    ('variables', 'python_assignment_01'),
    ('data type & variable', 'python_assignment_01'),
    ('data type and variable', 'python_assignment_01'),
    ('data types & variables', 'python_assignment_01'),
    ('function', 'python_assignment_04'),
    ('functions', 'python_assignment_04'),
    ('functions basic', 'python_assignment_04'),
    ('type casting', 'python_assignment_03'),
    ('user input', 'python_assignment_03'),
    ('user inputs', 'python_assignment_03'),
    ('user input & type casting', 'python_assignment_03'),
    ('loop', 'python_assignment_07'),
    ('loops', 'python_assignment_07'),
    ('loop assignment', 'python_assignment_07'),
    ('loops assignment', 'python_assignment_07')
), resolved(normalized_alias, original_alias, phase, item_type, canonical_id) AS (
  SELECT DISTINCT ON (public.normalize_coursework_alias(a.alias_text), c.phase, c.item_type)
    public.normalize_coursework_alias(a.alias_text),
    a.alias_text,
    c.phase,
    c.item_type,
    c.id
  FROM authoritative a
  JOIN public.coursework_items c ON c.canonical_key = a.canonical_key
  WHERE c.catalog_status = 'canonical'
    AND c.batch IS NULL
    AND c.active
  ORDER BY public.normalize_coursework_alias(a.alias_text), c.phase, c.item_type, a.alias_text
)
INSERT INTO public.coursework_aliases (
  normalized_alias, original_alias, source_phase, source_item_type,
  canonical_phase, canonical_item_type, canonical_coursework_item_id,
  source, confidence, mapping_status
)
SELECT normalized_alias, original_alias, phase, item_type,
       phase, item_type, canonical_id,
       'manual_authoritative', 'CONFIRMED', 'mapped'
FROM resolved
ON CONFLICT (normalized_alias, source_phase, source_item_type) DO UPDATE SET
  original_alias = EXCLUDED.original_alias,
  canonical_phase = EXCLUDED.canonical_phase,
  canonical_item_type = EXCLUDED.canonical_item_type,
  canonical_coursework_item_id = EXCLUDED.canonical_coursework_item_id,
  source = 'manual_authoritative',
  confidence = 'CONFIRMED',
  mapping_status = 'mapped',
  updated_at = now();

-- Keep legacy catalog rows equivalent to the authoritative canonical target.
-- This affects catalog identity metadata only; historical submissions remain
-- untouched.
UPDATE public.coursework_items legacy
SET canonical_coursework_item_id = a.canonical_coursework_item_id,
    catalog_status = 'legacy',
    updated_at = now()
FROM public.coursework_aliases a
WHERE a.source = 'manual_authoritative'
  AND a.mapping_status = 'mapped'
  AND a.source_phase = COALESCE(NULLIF(btrim(legacy.phase), ''), '')
  AND a.source_item_type = lower(btrim(COALESCE(legacy.item_type, '')))
  AND a.normalized_alias = public.normalize_coursework_alias(legacy.title)
  AND legacy.catalog_status <> 'canonical'
  AND legacy.canonical_coursework_item_id IS DISTINCT FROM a.canonical_coursework_item_id;

-- Select one deterministic oldest valid source submission per student and
-- canonical item. Direct canonical links stay on the existing direct path;
-- only unlinked and legacy-linked historical rows are reconciled here.
WITH eligible AS (
  SELECT
    s.id::text AS source_submission_id,
    s.student_id,
    s.batch,
    s.topic AS source_topic,
    s.phase,
    a.canonical_coursework_item_id,
    canonical.phase AS canonical_phase,
    canonical.item_type AS canonical_item_type,
    s.submitted_at,
    row_number() OVER (
      PARTITION BY s.student_id, a.canonical_coursework_item_id
      ORDER BY s.submitted_at NULLS FIRST, s.id
    ) AS completion_rank
  FROM public.submissions s
  JOIN public.coursework_aliases a
    ON a.normalized_alias = public.normalize_coursework_alias(s.topic)
   AND a.source = 'manual_authoritative'
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
  true, true, 'manual-authoritative-alias-reconciliation', now()
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
  confirmed_by = 'manual-authoritative-alias-reconciliation',
  confirmed_at = COALESCE(existing.confirmed_at, EXCLUDED.confirmed_at),
  updated_at = now();

COMMIT;
