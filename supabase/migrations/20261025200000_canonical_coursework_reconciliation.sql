-- Canonical coursework curriculum and non-destructive legacy reconciliation.
--
-- This migration creates exactly the supplied 47-item canonical master, keeps
-- historical catalog rows and submissions intact, and records conservative
-- alias/reconciliation evidence for later review. It does not delete or
-- rewrite historical submissions, attendance, credentials, or scores.

BEGIN;

ALTER TABLE public.coursework_items
  ADD COLUMN IF NOT EXISTS original_title text,
  ADD COLUMN IF NOT EXISTS catalog_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS canonical_key text,
  ADD COLUMN IF NOT EXISTS canonical_coursework_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'coursework_items_catalog_status_check'
      AND conrelid = 'public.coursework_items'::regclass
  ) THEN
    ALTER TABLE public.coursework_items
      ADD CONSTRAINT coursework_items_catalog_status_check
      CHECK (catalog_status IN ('canonical', 'legacy', 'extra', 'archived'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'coursework_items_canonical_key_unique'
      AND conrelid = 'public.coursework_items'::regclass
  ) THEN
    ALTER TABLE public.coursework_items
      ADD CONSTRAINT coursework_items_canonical_key_unique UNIQUE (canonical_key);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'coursework_items_canonical_item_fk'
      AND conrelid = 'public.coursework_items'::regclass
  ) THEN
    ALTER TABLE public.coursework_items
      ADD CONSTRAINT coursework_items_canonical_item_fk
      FOREIGN KEY (canonical_coursework_item_id)
      REFERENCES public.coursework_items(id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.coursework_items
SET original_title = COALESCE(original_title, title),
    catalog_status = COALESCE(NULLIF(catalog_status, ''), 'legacy')
WHERE original_title IS NULL OR catalog_status IS NULL OR catalog_status = '';

CREATE OR REPLACE FUNCTION public.normalize_coursework_alias(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized text := lower(btrim(COALESCE(value, '')));
BEGIN
  normalized := regexp_replace(normalized, '\\.(py|ipynb|txt|md|csv|docx?)\\s*$', '', 'i');
  normalized := regexp_replace(normalized, '^\\s*(assignment\\s*:?\\s*)?\\d+\\s*(->|[-:.])\\s*', '', 'i');
  normalized := replace(normalized, '&', ' and ');
  normalized := regexp_replace(normalized, '[_-]+', ' ', 'g');
  normalized := regexp_replace(normalized, '[^a-z0-9()]+', ' ', 'g');
  normalized := regexp_replace(normalized, '\\bassignments?\\b', 'assignment', 'g');
  normalized := regexp_replace(normalized, '\\s+', ' ', 'g');
  RETURN btrim(normalized);
END;
$$;

CREATE TABLE IF NOT EXISTS public.coursework_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_alias text NOT NULL,
  original_alias text NOT NULL,
  source_phase text NOT NULL DEFAULT '',
  source_item_type text NOT NULL DEFAULT '',
  canonical_phase text,
  canonical_item_type text,
  canonical_coursework_item_id uuid REFERENCES public.coursework_items(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'legacy_item',
  confidence text NOT NULL DEFAULT 'unmatched',
  mapping_status text NOT NULL DEFAULT 'pending_review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coursework_aliases_context_check CHECK (source_item_type IN ('', 'assignment', 'project')),
  CONSTRAINT coursework_aliases_canonical_context_check CHECK (canonical_item_type IS NULL OR canonical_item_type IN ('assignment', 'project')),
  CONSTRAINT coursework_aliases_confidence_check CHECK (confidence IN ('EXACT', 'HIGH_CONFIDENCE', 'CONFIRMED', 'AMBIGUOUS', 'UNMATCHED')),
  CONSTRAINT coursework_aliases_mapping_status_check CHECK (mapping_status IN ('mapped', 'pending_review', 'ambiguous', 'unmatched', 'ignored')),
  CONSTRAINT coursework_aliases_identity_unique UNIQUE (normalized_alias, source_phase, source_item_type)
);

CREATE INDEX IF NOT EXISTS coursework_aliases_status_idx
  ON public.coursework_aliases (mapping_status, source_phase, source_item_type);
CREATE INDEX IF NOT EXISTS coursework_aliases_canonical_idx
  ON public.coursework_aliases (canonical_coursework_item_id, mapping_status);

CREATE OR REPLACE VIEW public.coursework_catalog_extras
WITH (security_invoker = true)
AS
SELECT
  a.id AS alias_id,
  a.normalized_alias,
  a.original_alias,
  a.source_phase,
  a.source_item_type,
  COALESCE(a.canonical_phase, NULLIF(a.source_phase, '')) AS suggested_phase,
  COALESCE(a.canonical_item_type, NULLIF(a.source_item_type, '')) AS suggested_item_type,
  a.canonical_coursework_item_id AS suggested_canonical_coursework_item_id,
  a.source,
  a.confidence,
  a.mapping_status,
  COALESCE((
    SELECT count(*)::bigint
    FROM public.submissions s
    WHERE public.normalize_coursework_alias(s.topic) = a.normalized_alias
      AND (a.source_phase = '' OR COALESCE(s.phase, '') = a.source_phase)
      AND (a.source_item_type = '' OR lower(btrim(COALESCE(s.submission_type, ''))) IN (a.source_item_type, CASE WHEN a.source_item_type = 'assignment' THEN '100' ELSE '200' END))
  ), 0)::bigint AS submission_count,
  COALESCE((
    SELECT count(DISTINCT s.student_id)::bigint
    FROM public.submissions s
    WHERE public.normalize_coursework_alias(s.topic) = a.normalized_alias
      AND (a.source_phase = '' OR COALESCE(s.phase, '') = a.source_phase)
  ), 0)::bigint AS student_count,
  COALESCE((
    SELECT count(DISTINCT s.batch)::bigint
    FROM public.submissions s
    WHERE public.normalize_coursework_alias(s.topic) = a.normalized_alias
      AND (a.source_phase = '' OR COALESCE(s.phase, '') = a.source_phase)
  ), 0)::bigint AS batch_count,
  (
    SELECT min(s.submitted_at) FROM public.submissions s
    WHERE public.normalize_coursework_alias(s.topic) = a.normalized_alias
  ) AS first_seen,
  (
    SELECT max(s.submitted_at) FROM public.submissions s
    WHERE public.normalize_coursework_alias(s.topic) = a.normalized_alias
  ) AS last_seen,
  COALESCE((
    SELECT jsonb_agg(sample.topic)
    FROM (
      SELECT s.topic
      FROM public.submissions s
      WHERE public.normalize_coursework_alias(s.topic) = a.normalized_alias
      ORDER BY s.submitted_at NULLS FIRST, s.id
      LIMIT 3
    ) sample
  ), '[]'::jsonb) AS example_submissions
FROM public.coursework_aliases a
WHERE a.mapping_status <> 'mapped';

REVOKE ALL ON TABLE public.coursework_aliases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.coursework_aliases TO service_role;
REVOKE ALL ON public.coursework_catalog_extras FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.coursework_catalog_extras TO service_role;

ALTER TABLE public.coursework_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coursework_aliases_deny_public ON public.coursework_aliases;
CREATE POLICY coursework_aliases_deny_public ON public.coursework_aliases
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.cf_seed_canonical_coursework()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_data record;
  existing_id uuid;
BEGIN
  FOR row_data IN
    SELECT * FROM (VALUES
      ('python_assignment_01','assignment','Data Type & Variables','Python',1),
      ('python_assignment_02','assignment','Operators Assignment','Python',2),
      ('python_assignment_03','assignment','User Input & Type Casting','Python',3),
      ('python_assignment_04','assignment','Functions - Basic Assignments','Python',4),
      ('python_assignment_05','assignment','String Assignments','Python',5),
      ('python_assignment_06','assignment','Conditional Statements Assignments','Python',6),
      ('python_assignment_07','assignment','Loops Assignments','Python',7),
      ('python_assignment_08','assignment','List Assignments','Python',8),
      ('python_assignment_09','assignment','Set Assignments','Python',9),
      ('python_assignment_10','assignment','Dictionary Assignments','Python',10),
      ('python_assignment_11','assignment','Function - Advance Assignments','Python',11),
      ('python_project_01','project','ATM Functionalities','Python',1),
      ('python_project_02','project','Guess the Number Game','Python',2),
      ('python_project_03','project','Weather Data Analyzer','Python',3),
      ('python_project_04','project','YouTube Comment Analysis Project','Python',4),
      ('data_analytics_assignment_01','assignment','NumPy Operations','Data Analytics',1),
      ('data_analytics_assignment_02','assignment','Multidimensional Array in NumPy','Data Analytics',2),
      ('data_analytics_assignment_03','assignment','Loading Excel and CSV Data','Data Analytics',3),
      ('data_analytics_assignment_04','assignment','DataFrame and Series','Data Analytics',4),
      ('data_analytics_assignment_05','assignment','Series Operations In Pandas','Data Analytics',5),
      ('data_analytics_assignment_06','assignment','Filtering','Data Analytics',6),
      ('data_analytics_assignment_07','assignment','Sorting Value in Pandas','Data Analytics',7),
      ('data_analytics_assignment_08','assignment','Aggregate Functions','Data Analytics',8),
      ('data_analytics_assignment_09','assignment','value_counts() and groupby()','Data Analytics',9),
      ('data_analytics_assignment_10','assignment','datetime in pandas','Data Analytics',10),
      ('data_analytics_assignment_11','assignment','UDF','Data Analytics',11),
      ('data_analytics_assignment_12','assignment','String Function In Pandas','Data Analytics',12),
      ('data_analytics_assignment_13','assignment','Data Cleaning in Pandas','Data Analytics',13),
      ('data_analytics_assignment_14','assignment','Matplotlib For Data Visualization','Data Analytics',14),
      ('data_analytics_project_01','project','Gold Layer Practice Questions','Data Analytics',1),
      ('sql_assignment_01','assignment','Database Creation','SQL',1),
      ('sql_assignment_02','assignment','DDL and DML Commands','SQL',2),
      ('sql_assignment_03','assignment','Operators, Distinct and Sorting','SQL',3),
      ('sql_assignment_04','assignment','Group By, Aggregate Functions & Having Clause','SQL',4),
      ('sql_assignment_05','assignment','String Functions','SQL',5),
      ('sql_assignment_06','assignment','Date and Time Functions','SQL',6),
      ('sql_assignment_07','assignment','Truncate and Numeric Functions','SQL',7),
      ('sql_assignment_08','assignment','Joins','SQL',8),
      ('sql_assignment_09','assignment','Set Operations','SQL',9),
      ('sql_assignment_10','assignment','Variables and Table Variables','SQL',10),
      ('sql_assignment_11','assignment','Views and Triggers','SQL',11),
      ('sql_assignment_12','assignment','Transactions and Exception Handling','SQL',12),
      ('sql_assignment_13','assignment','Subqueries','SQL',13),
      ('sql_assignment_14','assignment','Scalar and Table Valued Functions','SQL',14),
      ('sql_assignment_15','assignment','Constraints','SQL',15),
      ('sql_assignment_16','assignment','Window Functions, Moving Average and CTE','SQL',16),
      ('sql_project_01','project','FoodieHub Data Analytics','SQL',1)
    ) AS rows(canonical_key,item_type,title,phase,sort_order)
  LOOP
    SELECT c.id INTO existing_id
    FROM public.coursework_items c
    WHERE c.batch IS NULL
      AND c.canonical_key IS NULL
      AND lower(btrim(c.title)) = lower(btrim(row_data.title))
      AND lower(btrim(COALESCE(c.phase, ''))) = lower(btrim(row_data.phase))
      AND lower(btrim(c.item_type)) = row_data.item_type
    ORDER BY c.active DESC, c.created_at, c.id
    LIMIT 1;

    IF existing_id IS NULL THEN
      INSERT INTO public.coursework_items (
        item_type, title, phase, batch, due_at, active, original_title,
        catalog_status, canonical_key, canonical_coursework_item_id, sort_order
      ) VALUES (
        row_data.item_type, row_data.title, row_data.phase, NULL, NULL, true,
        row_data.title, 'canonical', row_data.canonical_key, NULL, row_data.sort_order
      ) ON CONFLICT (canonical_key) DO UPDATE SET
        item_type = EXCLUDED.item_type,
        title = EXCLUDED.title,
        phase = EXCLUDED.phase,
        batch = NULL,
        active = true,
        catalog_status = 'canonical',
        sort_order = EXCLUDED.sort_order,
        updated_at = now();
    ELSE
      UPDATE public.coursework_items
      SET item_type = row_data.item_type,
          title = row_data.title,
          phase = row_data.phase,
          batch = NULL,
          active = true,
          catalog_status = 'canonical',
          canonical_key = row_data.canonical_key,
          canonical_coursework_item_id = NULL,
          sort_order = row_data.sort_order,
          original_title = COALESCE(original_title, title),
          updated_at = now()
      WHERE id = existing_id;
    END IF;
  END LOOP;
END;
$$;

SELECT public.cf_seed_canonical_coursework();
DROP FUNCTION public.cf_seed_canonical_coursework();

INSERT INTO public.coursework_aliases (
  normalized_alias, original_alias, source_phase, source_item_type,
  canonical_phase, canonical_item_type, canonical_coursework_item_id,
  source, confidence, mapping_status
)
SELECT public.normalize_coursework_alias(c.title), c.title, c.phase, c.item_type,
  c.phase, c.item_type, c.id, 'canonical_seed', 'EXACT', 'mapped'
FROM public.coursework_items c
WHERE c.catalog_status = 'canonical'
ON CONFLICT (normalized_alias, source_phase, source_item_type) DO UPDATE SET
  canonical_phase = EXCLUDED.canonical_phase,
  canonical_item_type = EXCLUDED.canonical_item_type,
  canonical_coursework_item_id = EXCLUDED.canonical_coursework_item_id,
  source = 'canonical_seed',
  confidence = 'EXACT',
  mapping_status = 'mapped',
  updated_at = now();

INSERT INTO public.coursework_aliases (
  normalized_alias, original_alias, source_phase, source_item_type,
  canonical_phase, canonical_item_type, canonical_coursework_item_id,
  source, confidence, mapping_status
)
SELECT public.normalize_coursework_alias(v.alias_text), v.alias_text, c.phase, c.item_type,
  c.phase, c.item_type, c.id, 'seed_alias', 'HIGH_CONFIDENCE', 'mapped'
FROM (
  SELECT DISTINCT ON (public.normalize_coursework_alias(raw.alias_text), c.phase)
    raw.alias_text, raw.canonical_key, c.phase
  FROM (VALUES
  ('List Assignment','python_assignment_08'),
  ('List Assignments','python_assignment_08'),
  ('Lists assignment','python_assignment_08'),
  ('List - Assignments','python_assignment_08'),
  ('DataFrame and Series','data_analytics_assignment_04'),
  ('data frame and series','data_analytics_assignment_04'),
  ('DataFrames and Series','data_analytics_assignment_04'),
  ('Pandas-Data frame and Series Assignment','data_analytics_assignment_04'),
  ('Filtering assignment','data_analytics_assignment_06'),
  ('Filtering Assignments.','data_analytics_assignment_06'),
  ('Pandas-Filtering Assignment','data_analytics_assignment_06'),
  ('Operators, Distinct & Sorting','sql_assignment_03'),
  ('Operators, Distinct & Sorting Assignment','sql_assignment_03'),
  ('OPERATOR,DISTINCT & SORTING','sql_assignment_03'),
  ('ATM','python_project_01'),
  ('ATM Functionality','python_project_01'),
  ('ATM functionalities','python_project_01'),
  ('Guess Number','python_project_02'),
  ('Guess the Number','python_project_02'),
  ('Guess Number Game','python_project_02'),
  ('Weather Analyzer','python_project_03'),
  ('Weather Data Analyzer','python_project_03'),
  ('Gold Layer Practice','data_analytics_project_01'),
  ('Gold Layer Practice Questions','data_analytics_project_01'),
  ('FoodieHub','sql_project_01'),
  ('FoodieHub Data Analytics','sql_project_01')
  ) AS raw(alias_text, canonical_key)
  JOIN public.coursework_items c ON c.canonical_key = raw.canonical_key
  ORDER BY public.normalize_coursework_alias(raw.alias_text), c.phase, raw.alias_text
) AS v
JOIN public.coursework_items c ON c.canonical_key = v.canonical_key
WHERE public.normalize_coursework_alias(v.alias_text) <> public.normalize_coursework_alias(c.title)
ON CONFLICT (normalized_alias, source_phase, source_item_type) DO UPDATE SET
  canonical_phase = EXCLUDED.canonical_phase,
  canonical_item_type = EXCLUDED.canonical_item_type,
  canonical_coursework_item_id = EXCLUDED.canonical_coursework_item_id,
  source = 'seed_alias',
  confidence = 'HIGH_CONFIDENCE',
  mapping_status = 'mapped',
  updated_at = now();

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

INSERT INTO public.coursework_aliases (
  normalized_alias, original_alias, source_phase, source_item_type,
  canonical_phase, canonical_item_type, canonical_coursework_item_id,
  source, confidence, mapping_status
)
SELECT public.normalize_coursework_alias(c.title), c.title,
  COALESCE(NULLIF(btrim(c.phase), ''), ''), lower(btrim(COALESCE(c.item_type, ''))),
  NULL, NULL, NULL, 'legacy_item', 'UNMATCHED', 'unmatched'
FROM public.coursework_items c
WHERE c.catalog_status <> 'canonical'
ON CONFLICT (normalized_alias, source_phase, source_item_type) DO NOTHING;

INSERT INTO public.coursework_aliases (
  normalized_alias, original_alias, source_phase, source_item_type,
  canonical_phase, canonical_item_type, canonical_coursework_item_id,
  source, confidence, mapping_status
)
SELECT public.normalize_coursework_alias(s.topic), s.topic,
  COALESCE(NULLIF(btrim(s.phase), ''), ''),
  CASE lower(btrim(COALESCE(s.submission_type, '')))
    WHEN '100' THEN 'assignment' WHEN '200' THEN 'project'
    WHEN 'assignment' THEN 'assignment' WHEN 'project' THEN 'project'
    ELSE ''
  END,
  NULL, NULL, NULL, 'submission_topic', 'UNMATCHED', 'unmatched'
FROM public.submissions s
WHERE NULLIF(btrim(COALESCE(s.topic, '')), '') IS NOT NULL
ON CONFLICT (normalized_alias, source_phase, source_item_type) DO NOTHING;

UPDATE public.coursework_aliases a
SET canonical_phase = c.phase,
    canonical_item_type = c.item_type,
    canonical_coursework_item_id = c.id,
    confidence = CASE WHEN a.normalized_alias = public.normalize_coursework_alias(c.title) THEN 'EXACT' ELSE 'HIGH_CONFIDENCE' END,
    mapping_status = 'mapped',
    updated_at = now()
FROM public.coursework_items c
WHERE c.catalog_status = 'canonical'
  AND a.mapping_status <> 'mapped'
  AND a.source_phase = c.phase
  AND (a.source_item_type = '' OR a.source_item_type = c.item_type)
  AND a.normalized_alias = public.normalize_coursework_alias(c.title);

UPDATE public.coursework_items legacy
SET canonical_coursework_item_id = a.canonical_coursework_item_id,
    catalog_status = 'legacy',
    updated_at = now()
FROM public.coursework_aliases a
WHERE legacy.catalog_status <> 'canonical'
  AND a.mapping_status = 'mapped'
  AND a.canonical_coursework_item_id IS NOT NULL
  AND a.source_phase = COALESCE(NULLIF(btrim(legacy.phase), ''), '')
  AND (a.source_item_type = '' OR a.source_item_type = lower(btrim(COALESCE(legacy.item_type, ''))))
  AND a.normalized_alias = public.normalize_coursework_alias(legacy.title);

UPDATE public.coursework_items legacy
SET catalog_status = 'extra', updated_at = now()
WHERE legacy.catalog_status = 'legacy'
  AND legacy.canonical_coursework_item_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.coursework_aliases a
    WHERE a.mapping_status IN ('unmatched', 'ambiguous', 'ignored')
      AND a.source_phase = COALESCE(NULLIF(btrim(legacy.phase), ''), '')
      AND a.source_item_type = lower(btrim(COALESCE(legacy.item_type, '')))
      AND a.normalized_alias = public.normalize_coursework_alias(legacy.title)
  );

INSERT INTO public.student_coursework_reconciliations (
  student_id, batch, coursework_item_id, source_submission_id, source_topic,
  phase, item_type, confidence, status, counts_for_progress, counts_for_points,
  confirmed_by, confirmed_at
)
SELECT DISTINCT ON (s.student_id, legacy.canonical_coursework_item_id)
  s.student_id, s.batch, legacy.canonical_coursework_item_id, s.id::text, s.topic,
  canonical.phase, canonical.item_type, 'high_confidence', 'confirmed', true, false,
  'canonical-coursework-migration', now()
FROM public.submissions s
JOIN public.coursework_items legacy ON legacy.id = s.coursework_item_id
JOIN public.coursework_items canonical ON canonical.id = legacy.canonical_coursework_item_id
WHERE legacy.canonical_coursework_item_id IS NOT NULL
ORDER BY s.student_id, legacy.canonical_coursework_item_id, s.submitted_at NULLS FIRST, s.id
ON CONFLICT (student_id, coursework_item_id) DO NOTHING;

-- Bridge active legacy activations to their canonical item before retiring the
-- legacy activation. This preserves visible work while preventing duplicate
-- active expectations for one canonical item.
INSERT INTO public.batch_coursework_assignments (
  batch, coursework_item_id, activated_at, activated_by_role,
  activated_by_name, due_at, active, updated_at
)
SELECT DISTINCT ON (a.batch, legacy.canonical_coursework_item_id)
  a.batch, legacy.canonical_coursework_item_id, a.activated_at,
  a.activated_by_role, a.activated_by_name, a.due_at, true, now()
FROM public.batch_coursework_assignments a
JOIN public.coursework_items legacy ON legacy.id = a.coursework_item_id
JOIN public.coursework_items canonical ON canonical.id = legacy.canonical_coursework_item_id
WHERE a.active
  AND legacy.catalog_status = 'legacy'
  AND legacy.canonical_coursework_item_id IS NOT NULL
  AND canonical.catalog_status = 'canonical'
ORDER BY a.batch, legacy.canonical_coursework_item_id, a.activated_at, a.id
ON CONFLICT (batch, coursework_item_id) DO UPDATE SET
  active = true,
  updated_at = now();

UPDATE public.batch_coursework_assignments a
SET active = false, updated_at = now()
FROM public.coursework_items legacy
WHERE a.coursework_item_id = legacy.id
  AND a.active
  AND legacy.catalog_status = 'legacy'
  AND legacy.canonical_coursework_item_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.batch_coursework_assignments canonical_activation
    WHERE canonical_activation.batch = a.batch
      AND canonical_activation.coursework_item_id = legacy.canonical_coursework_item_id
      AND canonical_activation.active
  );

INSERT INTO public.student_coursework_reconciliations (
  student_id, batch, coursework_item_id, source_submission_id, source_topic,
  phase, item_type, confidence, status, counts_for_progress, counts_for_points,
  confirmed_by, confirmed_at
)
SELECT DISTINCT ON (s.student_id, a.canonical_coursework_item_id)
  s.student_id, s.batch, a.canonical_coursework_item_id, s.id::text, s.topic,
  canonical.phase, canonical.item_type,
  CASE a.confidence
    WHEN 'CONFIRMED' THEN 'confirmed'
    WHEN 'EXACT' THEN 'high_confidence'
    ELSE 'high_confidence'
  END,
  'confirmed', true, false,
  'canonical-coursework-migration', now()
FROM public.submissions s
JOIN public.coursework_aliases a
  ON a.normalized_alias = public.normalize_coursework_alias(s.topic)
 AND a.mapping_status = 'mapped'
 AND (a.source_phase = '' OR a.source_phase = COALESCE(s.phase, ''))
JOIN public.coursework_items canonical ON canonical.id = a.canonical_coursework_item_id
WHERE s.coursework_item_id IS NULL
  AND (a.source_item_type = '' OR lower(btrim(COALESCE(s.submission_type, ''))) IN (a.source_item_type, CASE WHEN a.source_item_type = 'assignment' THEN '100' ELSE '200' END))
ORDER BY s.student_id, a.canonical_coursework_item_id, s.submitted_at NULLS FIRST, s.id
ON CONFLICT (student_id, coursework_item_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cf_map_coursework_alias(
  p_alias_id uuid,
  p_canonical_coursework_item_id uuid,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alias_row public.coursework_aliases%ROWTYPE;
  canonical_row public.coursework_items%ROWTYPE;
  mapped_items bigint := 0;
  reconciled_rows bigint := 0;
BEGIN
  SELECT * INTO alias_row FROM public.coursework_aliases WHERE id = p_alias_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coursework alias was not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO canonical_row FROM public.coursework_items
  WHERE id = p_canonical_coursework_item_id
    AND catalog_status = 'canonical' AND batch IS NULL AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active canonical coursework item' USING ERRCODE = '22023'; END IF;

  UPDATE public.coursework_aliases
  SET canonical_phase = canonical_row.phase,
      canonical_item_type = canonical_row.item_type,
      canonical_coursework_item_id = canonical_row.id,
      source = 'manual', confidence = 'HIGH_CONFIDENCE', mapping_status = 'mapped', updated_at = now()
  WHERE id = p_alias_id;

  UPDATE public.coursework_items
  SET canonical_coursework_item_id = canonical_row.id,
      catalog_status = 'legacy', updated_at = now()
  WHERE catalog_status <> 'canonical'
    AND public.normalize_coursework_alias(title) = alias_row.normalized_alias
    AND COALESCE(NULLIF(btrim(phase), ''), '') = alias_row.source_phase
    AND (alias_row.source_item_type = '' OR lower(btrim(COALESCE(item_type, ''))) = alias_row.source_item_type);
  GET DIAGNOSTICS mapped_items = ROW_COUNT;

  INSERT INTO public.student_coursework_reconciliations (
    student_id, batch, coursework_item_id, source_submission_id, source_topic,
    phase, item_type, confidence, status, counts_for_progress, counts_for_points,
    confirmed_by, confirmed_at
  )
  SELECT DISTINCT ON (s.student_id)
    s.student_id, s.batch, canonical_row.id, s.id::text, s.topic,
    canonical_row.phase, canonical_row.item_type, 'high_confidence', 'confirmed', true, false,
    COALESCE(NULLIF(btrim(p_actor), ''), 'admin'), now()
  FROM public.submissions s
  WHERE public.normalize_coursework_alias(s.topic) = alias_row.normalized_alias
    AND (alias_row.source_phase = '' OR COALESCE(s.phase, '') = alias_row.source_phase)
    AND (alias_row.source_item_type = '' OR lower(btrim(COALESCE(s.submission_type, ''))) IN (alias_row.source_item_type, CASE WHEN alias_row.source_item_type = 'assignment' THEN '100' ELSE '200' END))
    AND s.coursework_item_id IS NULL
  ORDER BY s.student_id, s.submitted_at NULLS FIRST, s.id
  ON CONFLICT (student_id, coursework_item_id) DO NOTHING;
  GET DIAGNOSTICS reconciled_rows = ROW_COUNT;

  RETURN jsonb_build_object('aliasId', p_alias_id, 'canonicalCourseworkItemId', canonical_row.id, 'mappedItems', mapped_items, 'reconciledRows', reconciled_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.cf_map_coursework_alias(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_map_coursework_alias(uuid, uuid, text) TO service_role;

COMMIT;
