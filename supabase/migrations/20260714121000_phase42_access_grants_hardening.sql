-- Phase 4.2 access hardening.
-- Explicitly align earlier server-owned tables/functions with the later
-- service-role-only access pattern. No data or application behavior changes.

REVOKE ALL ON TABLE public.assignment_phases FROM PUBLIC;
REVOKE ALL ON TABLE public.system_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.activity_log FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_phases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_log TO service_role;

REVOKE ALL ON FUNCTION public.cf_slugify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_slugify(text) TO service_role;
