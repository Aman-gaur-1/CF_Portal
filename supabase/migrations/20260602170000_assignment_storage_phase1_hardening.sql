-- Assignment Storage Phase 1 hardening.
-- Public links and current upload/download workflows remain operational.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS original_file_name text;

UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'application/javascript',
    'application/json',
    'application/octet-stream',
    'application/pdf',
    'application/typescript',
    'application/x-ipynb+json',
    'application/x-python-code',
    'text/csv',
    'text/html',
    'text/javascript',
    'text/markdown',
    'text/plain',
    'text/typescript',
    'text/x-python'
  ]
WHERE id = 'assignments';

DROP POLICY IF EXISTS "Allow anonymous uploads" ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_insert ON storage.objects;

CREATE POLICY assignments_anon_insert
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'assignments'
    AND name ~ '^submission_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(py|txt|md|json|html|ipynb|js|ts|jsx|tsx|csv|pdf)$'
  );
