-- Reviewed curriculum-owner overrides for legacy coursework names.
-- This migration is additive and does not rewrite submissions or coursework
-- titles. It only upgrades the alias confidence and mapping metadata.
BEGIN;

ALTER TABLE public.coursework_aliases
  DROP CONSTRAINT IF EXISTS coursework_aliases_confidence_check;
ALTER TABLE public.coursework_aliases
  ADD CONSTRAINT coursework_aliases_confidence_check
  CHECK (confidence IN ('EXACT', 'HIGH_CONFIDENCE', 'CONFIRMED', 'AMBIGUOUS', 'UNMATCHED'));

INSERT INTO public.coursework_aliases (
  normalized_alias, original_alias, source_phase, source_item_type,
  canonical_phase, canonical_item_type, canonical_coursework_item_id,
  source, confidence, mapping_status
)
SELECT public.normalize_coursework_alias(v.alias_text), v.alias_text,
  c.phase, c.item_type, c.phase, c.item_type, c.id,
  'manual_authoritative', 'CONFIRMED', 'mapped'
FROM (VALUES
  ('ADVANCE_FUNCTION_ASSIGNMENTS', 'python_assignment_11'),
  ('basic function', 'python_assignment_04'),
  ('Conditional Statements - Assignments', 'python_assignment_06'),
  ('Data Type & Variable', 'python_assignment_01'),
  ('Dictionary - Assignments', 'python_assignment_10'),
  ('List Assignment', 'python_assignment_08'),
  ('Loop assigment', 'python_assignment_07'),
  ('Operates', 'python_assignment_02'),
  ('Set Assignment', 'python_assignment_09'),
  ('String Assignments', 'python_assignment_05'),
  ('User Input & Type Casting', 'python_assignment_03'),
  ('Operators, Distinct & Sorting Assignments', 'sql_assignment_03'),
  ('SQL Views and Triggers Assignment', 'sql_assignment_11'),
  ('SQL Date and Time Assignment', 'sql_assignment_06'),
  ('SQL Group By, Aggregate Functions & Having Clause', 'sql_assignment_04'),
  ('SQL Join Assignment', 'sql_assignment_08'),
  ('SQL Set Operations Assignment', 'sql_assignment_09'),
  ('SQL String Assignment', 'sql_assignment_05'),
  ('SQL Truncate and Numeric Functions Assignment', 'sql_assignment_07'),
  ('SQL Variables & Table Variables Assignment', 'sql_assignment_10')
) AS v(alias_text, canonical_key)
JOIN public.coursework_items c ON c.canonical_key = v.canonical_key
ON CONFLICT (normalized_alias, source_phase, source_item_type) DO UPDATE SET
  canonical_phase = EXCLUDED.canonical_phase,
  canonical_item_type = EXCLUDED.canonical_item_type,
  canonical_coursework_item_id = EXCLUDED.canonical_coursework_item_id,
  source = 'manual_authoritative',
  confidence = 'CONFIRMED',
  mapping_status = 'mapped',
  updated_at = now();

UPDATE public.coursework_items legacy
SET canonical_coursework_item_id = a.canonical_coursework_item_id,
    catalog_status = 'legacy',
    updated_at = now()
FROM public.coursework_aliases a
WHERE a.source = 'manual_authoritative'
  AND a.mapping_status = 'mapped'
  AND legacy.catalog_status <> 'canonical'
  AND legacy.canonical_coursework_item_id IS NULL
  AND a.source_phase = COALESCE(NULLIF(btrim(legacy.phase), ''), '')
  AND a.source_item_type = lower(btrim(COALESCE(legacy.item_type, '')))
  AND a.normalized_alias = public.normalize_coursework_alias(legacy.title);

COMMIT;
