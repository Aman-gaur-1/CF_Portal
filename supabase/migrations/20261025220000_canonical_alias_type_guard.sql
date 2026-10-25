-- Canonical aliases must retain phase and coursework type context. Preserve
-- duplicate seed rows as ignored review metadata; historical coursework and
-- submissions are not touched or deleted.
BEGIN;

UPDATE public.coursework_aliases AS flexible
SET mapping_status = 'ignored',
    confidence = 'AMBIGUOUS',
    updated_at = now()
FROM public.coursework_aliases AS typed
WHERE flexible.source = 'seed_alias'
  AND flexible.source_item_type = ''
  AND typed.source_item_type <> ''
  AND typed.mapping_status = 'mapped'
  AND typed.normalized_alias = flexible.normalized_alias
  AND typed.source_phase = flexible.source_phase
  AND typed.canonical_coursework_item_id = flexible.canonical_coursework_item_id;

UPDATE public.coursework_aliases a
SET source_item_type = lower(btrim(c.item_type)),
    updated_at = now()
FROM public.coursework_items c
WHERE a.source = 'seed_alias'
  AND a.source_item_type = ''
  AND a.mapping_status = 'mapped'
  AND c.id = a.canonical_coursework_item_id;

COMMIT;
