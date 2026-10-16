-- Corrective access hardening for the already-applied unlinked attendance table.
-- Keep browser roles out of this server-owned table while preserving API access.

REVOKE ALL ON TABLE public.unlinked_attendance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unlinked_attendance TO service_role;
