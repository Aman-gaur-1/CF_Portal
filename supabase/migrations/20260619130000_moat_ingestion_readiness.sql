-- Moat Sprint 2: ingestion readiness fields and source seeds.
-- No review scraping, AI analysis, dashboards, or reports are implemented here.

ALTER TABLE public.competitors
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

UPDATE public.competitors
SET active = (status = 'active')
WHERE active IS DISTINCT FROM (status = 'active');

CREATE INDEX IF NOT EXISTS idx_competitors_active
  ON public.competitors (active);

CREATE INDEX IF NOT EXISTS idx_competitors_category
  ON public.competitors (category)
  WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competitors_city
  ON public.competitors (city)
  WHERE city IS NOT NULL;

ALTER TABLE public.review_sources
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

UPDATE public.review_sources
SET active = (status = 'active')
WHERE active IS DISTINCT FROM (status = 'active');

ALTER TABLE public.review_sources
  DROP CONSTRAINT IF EXISTS review_sources_source_type_check,
  ADD CONSTRAINT review_sources_source_type_check
    CHECK (source_type IN ('google_maps', 'trustpilot', 'reddit', 'youtube', 'quora', 'justdial', 'website'));

CREATE INDEX IF NOT EXISTS idx_review_sources_active
  ON public.review_sources (active);

CREATE INDEX IF NOT EXISTS idx_review_sources_competitor_active
  ON public.review_sources (competitor_id, active);

ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviews_collected integer NOT NULL DEFAULT 0;

ALTER TABLE public.scrape_jobs
  DROP CONSTRAINT IF EXISTS scrape_jobs_reviews_collected_check,
  ADD CONSTRAINT scrape_jobs_reviews_collected_check CHECK (reviews_collected >= 0);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_completed_at
  ON public.scrape_jobs (completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- Known initial competitor metadata. This prepares source management without
-- seeding any reviews or creating ingestion jobs.
UPDATE public.competitors
SET
  category = updates.category,
  city = updates.city,
  website_url = updates.website_url,
  updated_at = now()
FROM (
  VALUES
    ('scaler', 'Data Science / Tech Upskilling', 'Bengaluru', 'https://www.scaler.com'),
    ('upgrad', 'Higher Education / Upskilling', 'Mumbai', 'https://www.upgrad.com'),
    ('great-learning', 'Professional Learning', 'Gurugram', 'https://www.mygreatlearning.com'),
    ('simplilearn', 'Professional Certification', 'Bengaluru', 'https://www.simplilearn.com'),
    ('intellipaat', 'Professional Certification', 'Bengaluru', 'https://intellipaat.com'),
    ('almabetter', 'Data Science / Tech Upskilling', 'Bengaluru', 'https://www.almabetter.com'),
    ('coding-ninjas', 'Coding Bootcamp', 'Gurugram', 'https://www.codingninjas.com'),
    ('pw-skills', 'Online Upskilling', 'Noida', 'https://pwskills.com'),
    ('datamites', 'Data Science Training', 'Bengaluru', 'https://datamites.com'),
    ('excelr', 'Professional Training', 'Bengaluru', 'https://www.excelr.com'),
    ('analytixlabs', 'Analytics Training', 'Gurugram', 'https://www.analytixlabs.co.in'),
    ('edureka', 'Online Upskilling', 'Bengaluru', 'https://www.edureka.co'),
    ('odinschool', 'Data Science / Tech Upskilling', 'Hyderabad', 'https://www.odinschool.com'),
    ('newton-school', 'Coding Bootcamp', 'Bengaluru', 'https://www.newtonschool.co'),
    ('acciojob', 'Coding Bootcamp', 'Gurugram', 'https://acciojob.com'),
    ('masai', 'Coding Bootcamp', 'Bengaluru', 'https://www.masaischool.com')
) AS updates(slug, category, city, website_url)
WHERE public.competitors.slug = updates.slug;

INSERT INTO public.review_sources (competitor_id, source_type, source_name, source_url, status, active, source_config)
SELECT
  c.id,
  'website',
  c.name || ' Website',
  c.website_url,
  'active',
  true,
  jsonb_build_object('provider_ready', true, 'seeded_by', 'moat_sprint_2')
FROM public.competitors c
WHERE c.website_url IS NOT NULL
ON CONFLICT DO NOTHING;
