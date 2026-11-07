-- Supports the PostgREST nested submissions(count) query used by Admin Coursework.
-- Keep this index narrowly scoped to the measured relationship lookup.
CREATE INDEX IF NOT EXISTS submissions_coursework_item_id_idx
  ON public.submissions (coursework_item_id);
