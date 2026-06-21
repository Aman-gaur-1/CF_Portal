-- Moat Sprint 3: source discovery, provider registry, and privacy cleanup.
-- No external providers are connected. No reviews are collected.

ALTER TABLE public.competitor_reviews
  DROP COLUMN IF EXISTS reviewer_name;

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

INSERT INTO public.provider_configs (provider_name, enabled, status)
VALUES
  ('apify', false, 'not_configured'),
  ('outscraper', false, 'not_configured'),
  ('custom', false, 'not_configured')
ON CONFLICT (provider_name) DO NOTHING;

ALTER TABLE public.provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_source_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_configs_deny_anon ON public.provider_configs;
CREATE POLICY provider_configs_deny_anon
  ON public.provider_configs FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS competitor_source_profiles_deny_anon ON public.competitor_source_profiles;
CREATE POLICY competitor_source_profiles_deny_anon
  ON public.competitor_source_profiles FOR ALL TO anon USING (false) WITH CHECK (false);

COMMENT ON TABLE public.provider_configs IS 'Moat dry-run provider registry. API keys and external calls are intentionally excluded.';
COMMENT ON TABLE public.competitor_source_profiles IS 'Moat exact source identity mapping per competitor. No review data is collected here.';
