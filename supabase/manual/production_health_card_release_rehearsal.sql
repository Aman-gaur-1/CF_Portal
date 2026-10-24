-- Staging-only rollback rehearsal for the production compatibility phase.
-- The product-model migration is already installed in staging; this fixture
-- exercises the exact compatibility SQL without retaining any data or policy
-- changes.

BEGIN;

CREATE TEMP TABLE cf_rehearsal_students (
  student_id uuid PRIMARY KEY,
  original_hash text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE cf_rehearsal_original_students ON COMMIT DROP AS
SELECT id, password_hash, login_id
FROM public.students;

-- Existing staging fixtures may intentionally omit passwords. Give only those
-- rollback-scoped rows a non-secret test hash so the production guard can be
-- exercised without weakening the production rule that invalid accounts block.
UPDATE public.students
SET password_hash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
WHERE NULLIF(btrim(password_hash), '') IS NULL;

WITH selected_batches AS (
  SELECT name, row_number() OVER (ORDER BY name) AS batch_number
  FROM public.batches
), inserted AS (
  INSERT INTO public.students(name, batch, password_hash, must_change_password)
  SELECT 'CF Release Rehearsal Duplicate', name,
    CASE WHEN batch_number = 1
      THEN '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
      ELSE '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    END,
    false
  FROM selected_batches
  WHERE batch_number IN (1, 2)
  RETURNING id, password_hash
)
INSERT INTO cf_rehearsal_students(student_id, original_hash)
SELECT id, password_hash FROM inserted;

\ir production_health_card_compatibility.sql

DO $$
DECLARE
  fixture_count integer;
  fixture_login_count integer;
  changed_hash_count integer;
BEGIN
  SELECT count(*) INTO fixture_count FROM cf_rehearsal_students;
  IF fixture_count <> 2 THEN
    RAISE EXCEPTION 'Rehearsal fixture could not create two cross-batch duplicate-name students.';
  END IF;

  SELECT count(*) INTO fixture_login_count
  FROM cf_rehearsal_students fixture
  JOIN public.students student ON student.id = fixture.student_id
  WHERE NULLIF(btrim(student.login_id), '') IS NOT NULL;
  IF fixture_login_count <> fixture_count THEN
    RAISE EXCEPTION 'Rehearsal login_id backfill did not assign every fixture.';
  END IF;

  SELECT count(*) INTO changed_hash_count
  FROM cf_rehearsal_students fixture
  JOIN public.students student ON student.id = fixture.student_id
  WHERE student.password_hash <> fixture.original_hash;
  IF changed_hash_count <> 0 THEN
    RAISE EXCEPTION 'Rehearsal changed an existing password hash.';
  END IF;

  IF (SELECT count(DISTINCT lower(student.login_id))
      FROM cf_rehearsal_students fixture
      JOIN public.students student ON student.id = fixture.student_id) <> fixture_count THEN
    RAISE EXCEPTION 'Rehearsal did not resolve duplicate-name login collisions.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cf_rehearsal_original_students original
    JOIN public.students current_student ON current_student.id = original.id
    WHERE NULLIF(btrim(original.password_hash), '') IS NOT NULL
      AND current_student.password_hash <> original.password_hash
  ) THEN
    RAISE EXCEPTION 'Rehearsal changed a valid pre-existing password hash.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cf_rehearsal_original_students original
    JOIN public.students current_student ON current_student.id = original.id
    WHERE NULLIF(btrim(original.login_id), '') IS NOT NULL
      AND current_student.login_id <> original.login_id
  ) THEN
    RAISE EXCEPTION 'Rehearsal changed a pre-existing login_id.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'allow_all'
  ) THEN
    RAISE EXCEPTION 'Rehearsal left the broad students policy in place.';
  END IF;

  RAISE NOTICE 'production compatibility rehearsal assertions passed; rolling back fixture and changes';
END $$;

ROLLBACK;
