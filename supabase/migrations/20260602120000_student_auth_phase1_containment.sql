-- Student authentication Phase 1 containment.
-- Student credential verification and registration now use service-role API routes.
-- Keep safe student profile reads available for the existing admin browser UI.

REVOKE SELECT ON TABLE public.students FROM anon;
GRANT SELECT (id, name, batch, created_at) ON TABLE public.students TO anon;

REVOKE INSERT ON TABLE public.students FROM anon;

DROP POLICY IF EXISTS students_anon_insert ON public.students;
