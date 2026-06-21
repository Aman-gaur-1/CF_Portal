-- Moat Sprint 4: controlled Apify review ingestion POC.
-- Scope: storage support, dedupe indexes on default partition, and audit table.
-- No AI analysis, sentiment analysis, dashboards, or opportunity mining.

ALTER TABLE public.competitor_reviews
  DROP COLUMN IF EXISTS reviewer_name,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedupe_hash text;

ALTER TABLE public.competitor_reviews
  DROP CONSTRAINT IF EXISTS competitor_reviews_raw_payload_object,
  ADD CONSTRAINT competitor_reviews_raw_payload_object CHECK (jsonb_typeof(raw_payload) = 'object');

-- The current schema uses a default partition for the POC. These indexes make
-- repeated Scaler + Google Maps syncs idempotent on the active storage target.
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

UPDATE public.competitor_reviews
SET dedupe_hash =
  md5(
    COALESCE(review_text, '')
    || '|'
    || COALESCE(
      to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      ''
    )
  )
WHERE dedupe_hash IS NULL;

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

ALTER TABLE public.review_ingestion_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_ingestion_audit_deny_anon ON public.review_ingestion_audit;
CREATE POLICY review_ingestion_audit_deny_anon
  ON public.review_ingestion_audit FOR ALL TO anon USING (false) WITH CHECK (false);

COMMENT ON TABLE public.review_ingestion_audit IS 'Operational audit for Moat review ingestion runs. Stores counts only, no review PII.';
