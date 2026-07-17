-- Enable DOCX assignment uploads while preserving the existing hardened upload shape.

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY(
    SELECT DISTINCT mime_type
    FROM unnest(
      coalesce(allowed_mime_types, ARRAY[]::text[])
      || ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    ) AS mime_type
  )
WHERE id = 'assignments';

DROP POLICY IF EXISTS assignments_anon_insert ON storage.objects;

CREATE POLICY assignments_anon_insert
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'assignments'
    AND name ~ '^submission_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(py|txt|md|json|html|ipynb|js|ts|jsx|tsx|csv|pdf|docx)$'
  );
