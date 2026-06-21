-- Moat Engine foundation: competitor intelligence data model only.
-- No scraping, Apify integration, AI analysis, charts, or reports are implemented here.

-- ---------------------------------------------------------------------------
-- Core competitor directory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  website_url text,
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

-- ---------------------------------------------------------------------------
-- Review sources mapped to competitors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  external_source_id text,
  status text NOT NULL DEFAULT 'active',
  source_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_sources_type_not_blank CHECK (length(trim(source_type)) > 0),
  CONSTRAINT review_sources_name_not_blank CHECK (length(trim(source_name)) > 0),
  CONSTRAINT review_sources_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT review_sources_config_object CHECK (jsonb_typeof(source_config) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_review_sources_competitor
  ON public.review_sources (competitor_id);

CREATE INDEX IF NOT EXISTS idx_review_sources_type_status
  ON public.review_sources (source_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS review_sources_competitor_source_url_key
  ON public.review_sources (competitor_id, source_type, COALESCE(source_url, ''));

-- ---------------------------------------------------------------------------
-- High-volume collected reviews. Partitioned by collected_at for future
-- retention and monthly partition management.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.review_sources(id) ON DELETE SET NULL,
  external_review_id text,
  reviewer_name text,
  rating numeric(3,2),
  review_title text,
  review_text text NOT NULL,
  review_language text NOT NULL DEFAULT 'en',
  review_url text,
  reviewed_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, collected_at),
  CONSTRAINT competitor_reviews_text_not_blank CHECK (length(trim(review_text)) > 0),
  CONSTRAINT competitor_reviews_rating_check CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
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

-- ---------------------------------------------------------------------------
-- Prompt version registry for future analysis jobs
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
-- Review category taxonomy
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
-- Future AI analysis output. Partitioned by analyzed_at to align with review
-- volume and retention windows.
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
-- Competitor-level insight records
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
-- Time-series metrics snapshots. Partitioned by snapshot_date.
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
-- Job registry only. No scraper implementation is added in this sprint.
-- Partitioned by created_at for future job retention.
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT scrape_jobs_type_not_blank CHECK (length(trim(job_type)) > 0),
  CONSTRAINT scrape_jobs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT scrape_jobs_payload_object CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT scrape_jobs_summary_object CHECK (jsonb_typeof(result_summary) = 'object')
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS public.scrape_jobs_default
  PARTITION OF public.scrape_jobs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status_schedule
  ON public.scrape_jobs (status, scheduled_for, created_at);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_competitor
  ON public.scrape_jobs (competitor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_source
  ON public.scrape_jobs (source_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Alert definitions/events foundation
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

-- Keep Moat data server-mediated until a Supabase Auth model exists for admins.
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_metrics_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS competitors_deny_anon ON public.competitors;
CREATE POLICY competitors_deny_anon ON public.competitors FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_sources_deny_anon ON public.review_sources;
CREATE POLICY review_sources_deny_anon ON public.review_sources FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_reviews_deny_anon ON public.competitor_reviews;
CREATE POLICY competitor_reviews_deny_anon ON public.competitor_reviews FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ai_prompt_versions_deny_anon ON public.ai_prompt_versions;
CREATE POLICY ai_prompt_versions_deny_anon ON public.ai_prompt_versions FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_analysis_deny_anon ON public.review_analysis;
CREATE POLICY review_analysis_deny_anon ON public.review_analysis FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_categories_deny_anon ON public.review_categories;
CREATE POLICY review_categories_deny_anon ON public.review_categories FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_insights_deny_anon ON public.competitor_insights;
CREATE POLICY competitor_insights_deny_anon ON public.competitor_insights FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_metrics_snapshot_deny_anon ON public.competitor_metrics_snapshot;
CREATE POLICY competitor_metrics_snapshot_deny_anon ON public.competitor_metrics_snapshot FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS scrape_jobs_deny_anon ON public.scrape_jobs;
CREATE POLICY scrape_jobs_deny_anon ON public.scrape_jobs FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS alerts_deny_anon ON public.alerts;
CREATE POLICY alerts_deny_anon ON public.alerts FOR ALL TO anon USING (false) WITH CHECK (false);

COMMENT ON TABLE public.competitors IS 'Moat competitor directory.';
COMMENT ON TABLE public.review_sources IS 'Moat review-source registry. Source records only; no collection implementation.';
COMMENT ON TABLE public.competitor_reviews IS 'Moat collected competitor reviews, partitioned by collected_at.';
COMMENT ON TABLE public.ai_prompt_versions IS 'Moat prompt version registry for future analysis workflows.';
COMMENT ON TABLE public.review_analysis IS 'Moat future AI analysis output, partitioned by analyzed_at.';
COMMENT ON TABLE public.competitor_metrics_snapshot IS 'Moat metric snapshots, partitioned by snapshot_date.';
COMMENT ON TABLE public.scrape_jobs IS 'Moat job registry only; no scraper execution exists in this sprint.';
COMMENT ON TABLE public.alerts IS 'Moat alert foundation for future monitoring workflows.';
