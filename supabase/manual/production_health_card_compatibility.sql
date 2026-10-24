-- Narrow production compatibility phase for the Student Health Card release.
--
-- This is deliberately not a historical migration. Run it only after
-- 20261018230000_student_health_card_product_model.sql succeeds. The caller
-- must provide the transaction boundary so this file can be rehearsed with a
-- rollback or applied atomically.

-- All application database calls are server/service-role calls. Remove the
-- broad public students policy and direct client privileges before backfilling
-- the new login identifiers.
REVOKE ALL ON TABLE public.students FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS allow_all ON public.students;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.students TO service_role;

-- These SECURITY DEFINER helpers are invoked by table triggers, never by the
-- browser. Keep execution limited to the service role and the trigger owner.
REVOKE ALL ON FUNCTION public.cf_track_coursework_deactivation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_track_coursework_deactivation() TO service_role;
REVOKE ALL ON FUNCTION public.cf_validate_coursework_item_submission() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_validate_coursework_item_submission() TO service_role;

DO $$
DECLARE
  invalid_accounts integer;
  duplicate_login_ids integer;
BEGIN
  IF to_regclass('public.batch_coursework_assignments') IS NULL
     OR to_regclass('public.student_roster_imports') IS NULL THEN
    RAISE EXCEPTION 'Product-model tables are missing; apply the product-model migration first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'login_id'
  ) THEN
    RAISE EXCEPTION 'students.login_id is missing; apply the product-model migration first.';
  END IF;

  SELECT count(*) INTO invalid_accounts
  FROM public.students
  WHERE NULLIF(btrim(name), '') IS NULL
     OR NULLIF(btrim(batch), '') IS NULL
     OR NULLIF(btrim(password_hash), '') IS NULL;
  IF invalid_accounts > 0 THEN
    RAISE EXCEPTION '% student account(s) require manual review before login_id backfill.', invalid_accounts;
  END IF;

  SELECT count(*) INTO duplicate_login_ids
  FROM (
    SELECT lower(btrim(login_id))
    FROM public.students
    WHERE NULLIF(btrim(login_id), '') IS NOT NULL
    GROUP BY lower(btrim(login_id))
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_login_ids > 0 THEN
    RAISE EXCEPTION '% duplicate existing login_id group(s) require manual review.', duplicate_login_ids;
  END IF;
END $$;

-- Deterministic, global login_id backfill. Existing values are preserved;
-- missing values are assigned in stable UUID order. The base and suffix rules
-- match lib/roster-import.js, while the global used set avoids cross-batch
-- collisions that a batch-local import cannot see.
CREATE TEMP TABLE cf_student_login_plan (
  student_id uuid PRIMARY KEY,
  login_id text UNIQUE NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  student_record public.students%ROWTYPE;
  base text;
  candidate text;
  suffix integer;
BEGIN
  FOR student_record IN
    SELECT *
    FROM public.students
    WHERE NULLIF(btrim(login_id), '') IS NULL
    ORDER BY id
  LOOP
    base := left(
      regexp_replace(
        regexp_replace(lower(regexp_replace(trim(student_record.name), '\s+', ' ', 'g')), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
      ),
      36
    );
    IF base IS NULL OR base = '' THEN
      base := 'student';
    END IF;

    suffix := 1;
    LOOP
      candidate := base || '-' || lpad(suffix::text, 2, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.students existing
        WHERE existing.id <> student_record.id
          AND lower(btrim(existing.login_id)) = candidate
      ) AND NOT EXISTS (
        SELECT 1 FROM cf_student_login_plan planned
        WHERE planned.login_id = candidate
      );
      suffix := suffix + 1;
    END LOOP;

    INSERT INTO cf_student_login_plan(student_id, login_id)
    VALUES (student_record.id, candidate);
  END LOOP;
END $$;

UPDATE public.students student
SET login_id = plan.login_id
FROM cf_student_login_plan plan
WHERE plan.student_id = student.id;

DO $$
DECLARE
  missing_login_ids integer;
  duplicate_login_ids integer;
BEGIN
  SELECT count(*) INTO missing_login_ids
  FROM public.students
  WHERE NULLIF(btrim(login_id), '') IS NULL;
  IF missing_login_ids > 0 THEN
    RAISE EXCEPTION '% student(s) still have no login_id after backfill.', missing_login_ids;
  END IF;

  SELECT count(*) INTO duplicate_login_ids
  FROM (
    SELECT lower(btrim(login_id))
    FROM public.students
    GROUP BY lower(btrim(login_id))
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_login_ids > 0 THEN
    RAISE EXCEPTION '% duplicate login_id group(s) remain after backfill.', duplicate_login_ids;
  END IF;
END $$;

-- Only activate catalog items whose own batch is an exact existing batch.
-- Null/unknown batches are intentionally rejected rather than guessed.
DO $$
DECLARE
  ambiguous_items integer;
  invalid_items integer;
BEGIN
  SELECT count(*) INTO ambiguous_items
  FROM public.coursework_items item
  WHERE item.active
    AND item.deactivated_at IS NULL
    AND NULLIF(btrim(item.batch), '') IS NULL;
  IF ambiguous_items > 0 THEN
    RAISE EXCEPTION '% active coursework item(s) have no deterministic batch mapping.', ambiguous_items;
  END IF;

  SELECT count(*) INTO invalid_items
  FROM public.coursework_items item
  LEFT JOIN public.batches batch ON batch.name = item.batch
  WHERE item.active
    AND item.deactivated_at IS NULL
    AND NULLIF(btrim(item.batch), '') IS NOT NULL
    AND batch.name IS NULL;
  IF invalid_items > 0 THEN
    RAISE EXCEPTION '% active coursework item(s) reference an unknown batch.', invalid_items;
  END IF;
END $$;

INSERT INTO public.batch_coursework_assignments (
  batch,
  coursework_item_id,
  activated_at,
  activated_by_role,
  activated_by_name,
  due_at,
  active
)
SELECT
  item.batch,
  item.id,
  now(),
  'system',
  'production-health-card-release',
  item.due_at,
  true
FROM public.coursework_items item
JOIN public.batches batch ON batch.name = item.batch
WHERE item.active
  AND item.deactivated_at IS NULL
  AND lower(btrim(item.item_type)) IN ('assignment', 'project')
ON CONFLICT (batch, coursework_item_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.coursework_items item
    JOIN public.batches batch ON batch.name = item.batch
    WHERE item.active
      AND item.deactivated_at IS NULL
      AND lower(btrim(item.item_type)) IN ('assignment', 'project')
      AND NOT EXISTS (
        SELECT 1 FROM public.batch_coursework_assignments activation
        WHERE activation.batch = item.batch
          AND activation.coursework_item_id = item.id
          AND activation.active
      )
  ) THEN
    RAISE EXCEPTION 'Deterministic coursework activation verification failed.';
  END IF;
END $$;
