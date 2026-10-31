BEGIN;

REVOKE ALL ON TABLE public.coursework_mapping_corrections FROM service_role;
GRANT SELECT ON TABLE public.coursework_mapping_corrections TO service_role;

COMMIT;
