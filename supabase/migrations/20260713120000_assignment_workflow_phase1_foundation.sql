-- Assignment workflow Phase 1 foundation.
-- Adds database-driven phases and generic system settings while preserving the
-- existing submissions.phase workflow.

CREATE TABLE IF NOT EXISTS public.assignment_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '',
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'submitted';

CREATE OR REPLACE FUNCTION public.cf_slugify(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from regexp_replace(lower(trim(coalesce(value, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

WITH existing_phases AS (
  SELECT DISTINCT trim(phase) AS name
  FROM public.submissions
  WHERE phase IS NOT NULL AND length(trim(phase)) > 0
),
numbered AS (
  SELECT
    name,
    public.cf_slugify(name) AS base_slug,
    row_number() OVER (ORDER BY name) AS rn,
    row_number() OVER (PARTITION BY public.cf_slugify(name) ORDER BY name) AS slug_rn
  FROM existing_phases
),
seed_rows AS (
  SELECT
    name,
    CASE
      WHEN base_slug = '' THEN 'phase-' || rn
      WHEN slug_rn > 1 THEN base_slug || '-' || slug_rn
      ELSE base_slug
    END AS slug,
    (rn - 1) * 10 AS display_order
  FROM numbered
),
fallback_row AS (
  SELECT 'Python' AS name, 'python' AS slug, 0 AS display_order
  WHERE NOT EXISTS (SELECT 1 FROM seed_rows)
)
INSERT INTO public.assignment_phases (name, slug, description, display_order, is_active)
SELECT name, slug, 'Migrated from existing assignment phase values.', display_order, true
FROM seed_rows
UNION ALL
SELECT name, slug, 'Default phase for backward compatibility.', display_order, true
FROM fallback_row
ON CONFLICT (name) DO UPDATE
SET
  slug = EXCLUDED.slug,
  updated_at = now();

WITH default_phase AS (
  SELECT slug, name
  FROM public.assignment_phases
  WHERE is_active = true
  ORDER BY display_order ASC, created_at ASC
  LIMIT 1
)
INSERT INTO public.system_settings (key, value, description)
SELECT 'DEFAULT_PHASE', to_jsonb(slug), 'Default assignment phase slug used for new submissions.'
FROM default_phase
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_settings (key, value, description)
VALUES
  ('AUTO_APPROVAL_ENABLED', 'false'::jsonb, 'Future auto approval feature flag.'),
  ('AUTO_APPROVAL_DELAY', '0'::jsonb, 'Future auto approval delay in minutes.'),
  ('STUDENT_QUERY_ENABLED', 'false'::jsonb, 'Future student query feature flag.'),
  ('NOTIFICATIONS_ENABLED', 'false'::jsonb, 'Future notification feature flag.')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS assignment_phases_active_order_idx
  ON public.assignment_phases (is_active, display_order, created_at);

CREATE INDEX IF NOT EXISTS submissions_workflow_status_idx
  ON public.submissions (workflow_status);

ALTER TABLE public.assignment_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignment_phases_deny_anon ON public.assignment_phases;
CREATE POLICY assignment_phases_deny_anon
  ON public.assignment_phases
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS system_settings_deny_anon ON public.system_settings;
CREATE POLICY system_settings_deny_anon
  ON public.system_settings
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
