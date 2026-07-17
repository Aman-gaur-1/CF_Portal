-- Phase A repair: remove legacy broad submissions policy.
--
-- `allow_all` was not created by the checked-in migrations. It can exist on
-- older projects from manual/dashboard setup and keeps anon access open because
-- Postgres RLS policies are permissive by default.

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON public.submissions;

DROP POLICY IF EXISTS submissions_anon_select ON public.submissions;
DROP POLICY IF EXISTS submissions_anon_insert ON public.submissions;
DROP POLICY IF EXISTS submissions_anon_update ON public.submissions;
DROP POLICY IF EXISTS submissions_anon_delete ON public.submissions;

REVOKE ALL ON TABLE public.submissions FROM anon;
REVOKE ALL ON TABLE public.submissions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.submissions TO service_role;

DROP POLICY IF EXISTS submissions_deny_anon ON public.submissions;
CREATE POLICY submissions_deny_anon
  ON public.submissions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
