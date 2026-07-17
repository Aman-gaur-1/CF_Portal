-- Phase A security hardening: remove direct anonymous access to submissions
-- and make assignment files private while preserving insert-only uploads.

-- ---------------------------------------------------------------------------
-- submissions: server/API owned only
-- ---------------------------------------------------------------------------

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS submissions_anon_select ON public.submissions;
DROP POLICY IF EXISTS submissions_anon_insert ON public.submissions;
DROP POLICY IF EXISTS submissions_anon_update ON public.submissions;
DROP POLICY IF EXISTS submissions_anon_delete ON public.submissions;
DROP POLICY IF EXISTS submissions_deny_anon ON public.submissions;

REVOKE ALL ON TABLE public.submissions FROM anon;
REVOKE ALL ON TABLE public.submissions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.submissions TO service_role;

CREATE POLICY submissions_deny_anon
  ON public.submissions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- storage.objects: private assignment files, upload-only anon access
-- ---------------------------------------------------------------------------

UPDATE storage.buckets
SET public = false
WHERE id = 'assignments';

DROP POLICY IF EXISTS assignments_anon_select ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_insert ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_delete ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_update ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_upload_only ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_no_read ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_no_delete ON storage.objects;
DROP POLICY IF EXISTS assignments_anon_no_update ON storage.objects;

CREATE POLICY assignments_anon_upload_only
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'assignments'
    AND name ~ '^submission_[0-9a-fA-F-]{36}\.[A-Za-z0-9]+$'
    AND length(name) <= 120
  );

CREATE POLICY assignments_anon_no_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (false);

CREATE POLICY assignments_anon_no_delete
  ON storage.objects
  FOR DELETE
  TO anon, authenticated
  USING (false);

CREATE POLICY assignments_anon_no_update
  ON storage.objects
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
