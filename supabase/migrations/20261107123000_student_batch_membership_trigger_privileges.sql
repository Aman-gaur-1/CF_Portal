-- Keep the membership trigger implementation callable only by the database
-- trigger/service role. This is a privilege correction; it changes no rows.

BEGIN;

REVOKE ALL ON FUNCTION public.cf_sync_student_batch_membership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_sync_student_batch_membership() TO service_role;

COMMIT;
