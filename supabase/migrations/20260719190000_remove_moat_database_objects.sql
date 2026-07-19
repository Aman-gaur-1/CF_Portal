-- Permanent MOAT database cleanup.
-- MOAT has been retired and will not return. This migration removes only the
-- MOAT-owned database layer and does not touch Assignment Portal data.

-- Remove MOAT triggers/functions first so their dependencies are explicit.
DO $$
BEGIN
  IF to_regclass('public.competitor_reviews') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_set_competitor_review_dedupe_hash ON public.competitor_reviews;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.set_competitor_review_dedupe_hash();

-- Drop MOAT-only tables. CASCADE removes their policies, indexes, constraints,
-- triggers, and partition/default child tables when present.
DROP TABLE IF EXISTS public.alerts CASCADE;
DROP TABLE IF EXISTS public.competitor_insights CASCADE;
DROP TABLE IF EXISTS public.review_analysis_default CASCADE;
DROP TABLE IF EXISTS public.review_analysis CASCADE;
DROP TABLE IF EXISTS public.ai_prompt_versions CASCADE;
DROP TABLE IF EXISTS public.review_categories CASCADE;
DROP TABLE IF EXISTS public.competitor_metrics_snapshot_default CASCADE;
DROP TABLE IF EXISTS public.competitor_metrics_snapshot CASCADE;
DROP TABLE IF EXISTS public.review_ingestion_audit CASCADE;
DROP TABLE IF EXISTS public.scrape_jobs_default CASCADE;
DROP TABLE IF EXISTS public.scrape_jobs CASCADE;
DROP TABLE IF EXISTS public.provider_configs CASCADE;
DROP TABLE IF EXISTS public.competitor_source_profiles CASCADE;
DROP TABLE IF EXISTS public.competitor_reviews_default CASCADE;
DROP TABLE IF EXISTS public.competitor_reviews CASCADE;
DROP TABLE IF EXISTS public.review_sources CASCADE;
DROP TABLE IF EXISTS public.competitors CASCADE;
