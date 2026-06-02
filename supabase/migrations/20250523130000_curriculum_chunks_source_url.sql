-- GitBook ingestion: canonical source URL per chunk (dedup key with title)
ALTER TABLE public.curriculum_chunks
  ADD COLUMN IF NOT EXISTS source_url text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_chunks_source_url_title
  ON public.curriculum_chunks (source_url, title)
  WHERE source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_source_url
  ON public.curriculum_chunks (source_url)
  WHERE source_url IS NOT NULL;

COMMENT ON COLUMN public.curriculum_chunks.source_url IS
  'Canonical GitBook or document URL; combined with title for idempotent ingestion.';
