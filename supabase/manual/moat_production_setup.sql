-- Moat production setup - manual SQL Editor script
-- Assumption: production may have none of the Moat schema.
-- Scope: schema + indexes + RLS + seed competitors + seed website sources only.
-- Does not scrape, run jobs, create AI analysis, dashboards, or reports.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. competitors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  website_url text,
  category text,
  city text,
  active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitors_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT competitors_slug_not_blank CHECK (length(trim(slug)) > 0),
  CONSTRAINT competitors_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT competitors_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS competitors_name_key
  ON public.competitors (lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS competitors_slug_key
  ON public.competitors (slug);

CREATE INDEX IF NOT EXISTS idx_competitors_status
  ON public.competitors (status);

CREATE INDEX IF NOT EXISTS idx_competitors_active
  ON public.competitors (active);

CREATE INDEX IF NOT EXISTS idx_competitors_category
  ON public.competitors (category)
  WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competitors_city
  ON public.competitors (city)
  WHERE city IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. review_sources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  external_source_id text,
  active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  source_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_sources_type_not_blank CHECK (length(trim(source_type)) > 0),
  CONSTRAINT review_sources_name_not_blank CHECK (length(trim(source_name)) > 0),
  CONSTRAINT review_sources_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT review_sources_config_object CHECK (jsonb_typeof(source_config) = 'object'),
  CONSTRAINT review_sources_source_type_check CHECK (
    source_type IN ('google_maps', 'trustpilot', 'reddit', 'youtube', 'quora', 'justdial', 'website')
  )
);

CREATE INDEX IF NOT EXISTS idx_review_sources_competitor
  ON public.review_sources (competitor_id);

CREATE INDEX IF NOT EXISTS idx_review_sources_type_status
  ON public.review_sources (source_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS review_sources_competitor_source_url_key
  ON public.review_sources (competitor_id, source_type, COALESCE(source_url, ''));

CREATE INDEX IF NOT EXISTS idx_review_sources_active
  ON public.review_sources (active);

CREATE INDEX IF NOT EXISTS idx_review_sources_competitor_active
  ON public.review_sources (competitor_id, active);

-- ---------------------------------------------------------------------------
-- 3. competitor_reviews - partitioned by collected_at
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.review_sources(id) ON DELETE SET NULL,
  external_review_id text,
  rating numeric(3,2),
  review_title text,
  review_text text NOT NULL,
  review_language text NOT NULL DEFAULT 'en',
  review_url text,
  reviewed_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, collected_at),
  CONSTRAINT competitor_reviews_text_not_blank CHECK (length(trim(review_text)) > 0),
  CONSTRAINT competitor_reviews_rating_check CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  CONSTRAINT competitor_reviews_raw_payload_object CHECK (jsonb_typeof(raw_payload) = 'object'),
  CONSTRAINT competitor_reviews_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
) PARTITION BY RANGE (collected_at);

CREATE TABLE IF NOT EXISTS public.competitor_reviews_default
  PARTITION OF public.competitor_reviews DEFAULT;

CREATE INDEX IF NOT EXISTS idx_competitor_reviews_competitor_collected
  ON public.competitor_reviews (competitor_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_reviews_source_external
  ON public.competitor_reviews (source_id, external_review_id)
  WHERE external_review_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competitor_reviews_rating
  ON public.competitor_reviews (rating)
  WHERE rating IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS competitor_reviews_default_external_review_key
  ON public.competitor_reviews_default (competitor_id, source_id, external_review_id)
  WHERE external_review_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_competitor_review_dedupe_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.dedupe_hash :=
    md5(
      COALESCE(NEW.review_text, '')
      || '|'
      || COALESCE(
        to_char(NEW.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        ''
      )
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_competitor_review_dedupe_hash ON public.competitor_reviews;

CREATE TRIGGER trg_set_competitor_review_dedupe_hash
  BEFORE INSERT OR UPDATE OF review_text, reviewed_at
  ON public.competitor_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.set_competitor_review_dedupe_hash();

DO $$
DECLARE
  partition_table regclass;
  partition_name text;
BEGIN
  FOR partition_table IN
    SELECT inhrelid::regclass
    FROM pg_inherits
    WHERE inhparent = 'public.competitor_reviews'::regclass
  LOOP
    partition_name := replace(partition_table::text, '.', '_');

    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s (competitor_id, source_id, dedupe_hash) WHERE external_review_id IS NULL AND dedupe_hash IS NOT NULL',
      left(partition_name || '_dedupe_hash_key', 63),
      partition_table
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. ai_prompt_versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  prompt_body text NOT NULL,
  schema_version text,
  status text NOT NULL DEFAULT 'draft',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CONSTRAINT ai_prompt_versions_key_not_blank CHECK (length(trim(prompt_key)) > 0),
  CONSTRAINT ai_prompt_versions_version_positive CHECK (version > 0),
  CONSTRAINT ai_prompt_versions_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT ai_prompt_versions_body_not_blank CHECK (length(trim(prompt_body)) > 0),
  CONSTRAINT ai_prompt_versions_status_check CHECK (status IN ('draft', 'active', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_versions_key_version_key
  ON public.ai_prompt_versions (prompt_key, version);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_status
  ON public.ai_prompt_versions (prompt_key, status);

-- ---------------------------------------------------------------------------
-- 5. review_categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL,
  label text NOT NULL,
  description text,
  parent_category_id uuid REFERENCES public.review_categories(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_categories_key_not_blank CHECK (length(trim(category_key)) > 0),
  CONSTRAINT review_categories_label_not_blank CHECK (length(trim(label)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS review_categories_key_key
  ON public.review_categories (category_key);

CREATE INDEX IF NOT EXISTS idx_review_categories_active_sort
  ON public.review_categories (is_active, sort_order);

-- ---------------------------------------------------------------------------
-- 6. review_analysis - partitioned by analyzed_at
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_analysis (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL,
  review_collected_at timestamptz NOT NULL,
  prompt_version_id uuid REFERENCES public.ai_prompt_versions(id) ON DELETE SET NULL,
  sentiment text,
  sentiment_score numeric(5,4),
  category_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  pain_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, analyzed_at),
  CONSTRAINT review_analysis_review_fk FOREIGN KEY (review_id, review_collected_at)
    REFERENCES public.competitor_reviews(id, collected_at) ON DELETE CASCADE,
  CONSTRAINT review_analysis_status_check CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  CONSTRAINT review_analysis_sentiment_score_check CHECK (sentiment_score IS NULL OR (sentiment_score >= -1 AND sentiment_score <= 1)),
  CONSTRAINT review_analysis_category_scores_object CHECK (jsonb_typeof(category_scores) = 'object'),
  CONSTRAINT review_analysis_extracted_claims_array CHECK (jsonb_typeof(extracted_claims) = 'array'),
  CONSTRAINT review_analysis_pain_points_array CHECK (jsonb_typeof(pain_points) = 'array'),
  CONSTRAINT review_analysis_opportunities_array CHECK (jsonb_typeof(opportunities) = 'array'),
  CONSTRAINT review_analysis_raw_output_object CHECK (jsonb_typeof(raw_output) = 'object')
) PARTITION BY RANGE (analyzed_at);

CREATE TABLE IF NOT EXISTS public.review_analysis_default
  PARTITION OF public.review_analysis DEFAULT;

CREATE INDEX IF NOT EXISTS idx_review_analysis_review
  ON public.review_analysis (review_id, review_collected_at);

CREATE INDEX IF NOT EXISTS idx_review_analysis_status_analyzed
  ON public.review_analysis (status, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_analysis_prompt_version
  ON public.review_analysis (prompt_version_id);

-- ---------------------------------------------------------------------------
-- 7. competitor_insights
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  source_analysis_id uuid,
  source_analysis_analyzed_at timestamptz,
  insight_type text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(5,4),
  status text NOT NULL DEFAULT 'draft',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_insights_analysis_fk FOREIGN KEY (source_analysis_id, source_analysis_analyzed_at)
    REFERENCES public.review_analysis(id, analyzed_at) ON DELETE SET NULL,
  CONSTRAINT competitor_insights_type_not_blank CHECK (length(trim(insight_type)) > 0),
  CONSTRAINT competitor_insights_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT competitor_insights_summary_not_blank CHECK (length(trim(summary)) > 0),
  CONSTRAINT competitor_insights_status_check CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT competitor_insights_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT competitor_insights_evidence_array CHECK (jsonb_typeof(evidence) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_competitor_insights_competitor_type
  ON public.competitor_insights (competitor_id, insight_type, status);

CREATE INDEX IF NOT EXISTS idx_competitor_insights_validity
  ON public.competitor_insights (valid_from DESC, valid_until);

-- ---------------------------------------------------------------------------
-- 8. competitor_metrics_snapshot - partitioned by snapshot_date
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_metrics_snapshot (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  metric_type text NOT NULL,
  period_start date,
  period_end date,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, snapshot_date),
  CONSTRAINT competitor_metrics_type_not_blank CHECK (length(trim(metric_type)) > 0),
  CONSTRAINT competitor_metrics_period_check CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  CONSTRAINT competitor_metrics_object CHECK (jsonb_typeof(metrics) = 'object')
) PARTITION BY RANGE (snapshot_date);

CREATE TABLE IF NOT EXISTS public.competitor_metrics_snapshot_default
  PARTITION OF public.competitor_metrics_snapshot DEFAULT;

CREATE INDEX IF NOT EXISTS idx_competitor_metrics_competitor_date
  ON public.competitor_metrics_snapshot (competitor_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_metrics_type_date
  ON public.competitor_metrics_snapshot (metric_type, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- 9. scrape_jobs - partitioned by created_at
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scrape_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  competitor_id uuid REFERENCES public.competitors(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.review_sources(id) ON DELETE SET NULL,
  job_type text NOT NULL DEFAULT 'review_sync',
  status text NOT NULL DEFAULT 'queued',
  requested_by text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  completed_at timestamptz,
  reviews_collected integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT scrape_jobs_type_not_blank CHECK (length(trim(job_type)) > 0),
  CONSTRAINT scrape_jobs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT scrape_jobs_payload_object CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT scrape_jobs_summary_object CHECK (jsonb_typeof(result_summary) = 'object'),
  CONSTRAINT scrape_jobs_reviews_collected_check CHECK (reviews_collected >= 0)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS public.scrape_jobs_default
  PARTITION OF public.scrape_jobs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status_schedule
  ON public.scrape_jobs (status, scheduled_for, created_at);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_competitor
  ON public.scrape_jobs (competitor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_source
  ON public.scrape_jobs (source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_completed_at
  ON public.scrape_jobs (completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 10. provider_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'not_configured',
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_configs_name_check CHECK (provider_name IN ('apify', 'outscraper', 'custom')),
  CONSTRAINT provider_configs_status_check CHECK (status IN ('not_configured', 'ready', 'disabled', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_configs_provider_name_key
  ON public.provider_configs (provider_name);

CREATE INDEX IF NOT EXISTS idx_provider_configs_enabled
  ON public.provider_configs (enabled);

-- ---------------------------------------------------------------------------
-- 11. competitor_source_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_source_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  profile_url text,
  search_pattern text,
  external_identifier text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_source_profiles_type_check CHECK (
    source_type IN ('google_maps', 'trustpilot', 'reddit', 'youtube', 'quora', 'justdial', 'website')
  ),
  CONSTRAINT competitor_source_profiles_identity_check CHECK (
    length(trim(COALESCE(profile_url, ''))) > 0
    OR length(trim(COALESCE(search_pattern, ''))) > 0
    OR length(trim(COALESCE(external_identifier, ''))) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_competitor_source_profiles_competitor
  ON public.competitor_source_profiles (competitor_id);

CREATE INDEX IF NOT EXISTS idx_competitor_source_profiles_type_active
  ON public.competitor_source_profiles (source_type, active);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_source_profiles_identity_key
  ON public.competitor_source_profiles (
    competitor_id,
    source_type,
    COALESCE(profile_url, ''),
    COALESCE(search_pattern, ''),
    COALESCE(external_identifier, '')
  );

-- ---------------------------------------------------------------------------
-- 12. review_ingestion_audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_ingestion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  source_id uuid REFERENCES public.review_sources(id) ON DELETE SET NULL,
  fetched_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_ingestion_audit_counts_check CHECK (
    fetched_count >= 0
    AND inserted_count >= 0
    AND duplicate_count >= 0
    AND failed_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_review_ingestion_audit_job
  ON public.review_ingestion_audit (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_ingestion_audit_source
  ON public.review_ingestion_audit (source_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 13. alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid REFERENCES public.competitors(id) ON DELETE CASCADE,
  insight_id uuid REFERENCES public.competitor_insights(id) ON DELETE SET NULL,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'open',
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alerts_type_not_blank CHECK (length(trim(alert_type)) > 0),
  CONSTRAINT alerts_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT alerts_severity_check CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  CONSTRAINT alerts_status_check CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  CONSTRAINT alerts_trigger_payload_object CHECK (jsonb_typeof(trigger_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_severity
  ON public.alerts (status, severity, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_competitor_triggered
  ON public.alerts (competitor_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_insight
  ON public.alerts (insight_id)
  WHERE insight_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS: deny anon. Service role bypasses RLS for Moat API routes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_metrics_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_source_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_ingestion_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS competitors_deny_anon ON public.competitors;
CREATE POLICY competitors_deny_anon
  ON public.competitors FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_sources_deny_anon ON public.review_sources;
CREATE POLICY review_sources_deny_anon
  ON public.review_sources FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_reviews_deny_anon ON public.competitor_reviews;
CREATE POLICY competitor_reviews_deny_anon
  ON public.competitor_reviews FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ai_prompt_versions_deny_anon ON public.ai_prompt_versions;
CREATE POLICY ai_prompt_versions_deny_anon
  ON public.ai_prompt_versions FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_analysis_deny_anon ON public.review_analysis;
CREATE POLICY review_analysis_deny_anon
  ON public.review_analysis FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_categories_deny_anon ON public.review_categories;
CREATE POLICY review_categories_deny_anon
  ON public.review_categories FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_insights_deny_anon ON public.competitor_insights;
CREATE POLICY competitor_insights_deny_anon
  ON public.competitor_insights FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_metrics_snapshot_deny_anon ON public.competitor_metrics_snapshot;
CREATE POLICY competitor_metrics_snapshot_deny_anon
  ON public.competitor_metrics_snapshot FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS scrape_jobs_deny_anon ON public.scrape_jobs;
CREATE POLICY scrape_jobs_deny_anon
  ON public.scrape_jobs FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS provider_configs_deny_anon ON public.provider_configs;
CREATE POLICY provider_configs_deny_anon
  ON public.provider_configs FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_source_profiles_deny_anon ON public.competitor_source_profiles;
CREATE POLICY competitor_source_profiles_deny_anon
  ON public.competitor_source_profiles FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_ingestion_audit_deny_anon ON public.review_ingestion_audit;
CREATE POLICY review_ingestion_audit_deny_anon
  ON public.review_ingestion_audit FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS alerts_deny_anon ON public.alerts;
CREATE POLICY alerts_deny_anon
  ON public.alerts FOR ALL TO anon USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.competitors IS 'Moat competitor directory.';
COMMENT ON TABLE public.review_sources IS 'Moat review-source registry. Source records only; no collection implementation.';
COMMENT ON TABLE public.competitor_reviews IS 'Moat collected competitor reviews, partitioned by collected_at.';
COMMENT ON TABLE public.ai_prompt_versions IS 'Moat prompt version registry for future analysis workflows.';
COMMENT ON TABLE public.review_analysis IS 'Moat future AI analysis output, partitioned by analyzed_at.';
COMMENT ON TABLE public.competitor_metrics_snapshot IS 'Moat metric snapshots, partitioned by snapshot_date.';
COMMENT ON TABLE public.scrape_jobs IS 'Moat job registry only; no scraper execution exists in this sprint.';
COMMENT ON TABLE public.provider_configs IS 'Moat dry-run provider registry. API keys and external calls are intentionally excluded.';
COMMENT ON TABLE public.competitor_source_profiles IS 'Moat exact source identity mapping per competitor. No review data is collected here.';
COMMENT ON TABLE public.review_ingestion_audit IS 'Operational audit for Moat review ingestion runs. Stores counts only, no review PII.';
COMMENT ON TABLE public.alerts IS 'Moat alert foundation for future monitoring workflows.';

-- ---------------------------------------------------------------------------
-- Seed competitors. Reviews are intentionally not seeded.
-- ---------------------------------------------------------------------------
INSERT INTO public.competitors (name, slug, website_url, category, city, active, status, metadata)
VALUES
  ('Scaler', 'scaler', 'https://www.scaler.com', 'Data Science / Tech Upskilling', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('UpGrad', 'upgrad', 'https://www.upgrad.com', 'Higher Education / Upskilling', 'Mumbai', true, 'active', '{}'::jsonb),
  ('Great Learning', 'great-learning', 'https://www.mygreatlearning.com', 'Professional Learning', 'Gurugram', true, 'active', '{}'::jsonb),
  ('Simplilearn', 'simplilearn', 'https://www.simplilearn.com', 'Professional Certification', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('Intellipaat', 'intellipaat', 'https://intellipaat.com', 'Professional Certification', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('AlmaBetter', 'almabetter', 'https://www.almabetter.com', 'Data Science / Tech Upskilling', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('Coding Ninjas', 'coding-ninjas', 'https://www.codingninjas.com', 'Coding Bootcamp', 'Gurugram', true, 'active', '{}'::jsonb),
  ('PW Skills', 'pw-skills', 'https://pwskills.com', 'Online Upskilling', 'Noida', true, 'active', '{}'::jsonb),
  ('DataMites', 'datamites', 'https://datamites.com', 'Data Science Training', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('ExcelR', 'excelr', 'https://www.excelr.com', 'Professional Training', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('AnalytixLabs', 'analytixlabs', 'https://www.analytixlabs.co.in', 'Analytics Training', 'Gurugram', true, 'active', '{}'::jsonb),
  ('Edureka', 'edureka', 'https://www.edureka.co', 'Online Upskilling', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('OdinSchool', 'odinschool', 'https://www.odinschool.com', 'Data Science / Tech Upskilling', 'Hyderabad', true, 'active', '{}'::jsonb),
  ('Newton School', 'newton-school', 'https://www.newtonschool.co', 'Coding Bootcamp', 'Bengaluru', true, 'active', '{}'::jsonb),
  ('AccioJob', 'acciojob', 'https://acciojob.com', 'Coding Bootcamp', 'Gurugram', true, 'active', '{}'::jsonb),
  ('Masai', 'masai', 'https://www.masaischool.com', 'Coding Bootcamp', 'Bengaluru', true, 'active', '{}'::jsonb)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  website_url = EXCLUDED.website_url,
  category = EXCLUDED.category,
  city = EXCLUDED.city,
  active = EXCLUDED.active,
  status = EXCLUDED.status,
  updated_at = now();

-- Seed only source records. No reviews and no jobs are created.
INSERT INTO public.review_sources (competitor_id, source_type, source_name, source_url, status, active, source_config)
SELECT
  c.id,
  'website',
  c.name || ' Website',
  c.website_url,
  'active',
  true,
  jsonb_build_object('provider_ready', true, 'seeded_by', 'moat_manual_production_setup')
FROM public.competitors c
WHERE c.website_url IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.provider_configs (provider_name, enabled, status)
VALUES
  ('apify', false, 'not_configured'),
  ('outscraper', false, 'not_configured'),
  ('custom', false, 'not_configured')
ON CONFLICT (provider_name) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification queries to run after the transaction succeeds.
-- Expected counts on a fresh production database:
-- competitors = 16
-- review_sources = 16
-- provider_configs = 3
-- all other Moat data tables = 0
-- ---------------------------------------------------------------------------
SELECT 'competitors' AS table_name, count(*) AS row_count FROM public.competitors
UNION ALL SELECT 'review_sources', count(*) FROM public.review_sources
UNION ALL SELECT 'competitor_reviews', count(*) FROM public.competitor_reviews
UNION ALL SELECT 'ai_prompt_versions', count(*) FROM public.ai_prompt_versions
UNION ALL SELECT 'review_analysis', count(*) FROM public.review_analysis
UNION ALL SELECT 'review_categories', count(*) FROM public.review_categories
UNION ALL SELECT 'competitor_insights', count(*) FROM public.competitor_insights
UNION ALL SELECT 'competitor_metrics_snapshot', count(*) FROM public.competitor_metrics_snapshot
UNION ALL SELECT 'scrape_jobs', count(*) FROM public.scrape_jobs
UNION ALL SELECT 'provider_configs', count(*) FROM public.provider_configs
UNION ALL SELECT 'competitor_source_profiles', count(*) FROM public.competitor_source_profiles
UNION ALL SELECT 'review_ingestion_audit', count(*) FROM public.review_ingestion_audit
UNION ALL SELECT 'alerts', count(*) FROM public.alerts
ORDER BY table_name;
