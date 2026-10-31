BEGIN;

CREATE INDEX IF NOT EXISTS coursework_mapping_corrections_old_item_idx
  ON public.coursework_mapping_corrections (old_canonical_coursework_item_id);

CREATE INDEX IF NOT EXISTS coursework_mapping_corrections_new_item_idx
  ON public.coursework_mapping_corrections (new_canonical_coursework_item_id);

COMMIT;
