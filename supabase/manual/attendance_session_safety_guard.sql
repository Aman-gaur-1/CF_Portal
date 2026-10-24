-- Attendance session-safety defense in depth.
--
-- This is a controlled compatibility script, not a historical migration. It
-- preserves existing legacy rows and only rejects future invalid inserts or
-- status/session transitions. Run it transactionally and rehearse it first.

CREATE OR REPLACE FUNCTION public.cf_validate_attendance_session_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_row public.attendance_sessions%ROWTYPE;
BEGIN
  -- Approval is never valid without a real class session. Existing historical
  -- rows are not scanned or rewritten; this applies only to future writes.
  IF NEW.status = 'approved' AND NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'Approved attendance requires a valid class session.'
      USING ERRCODE = '23514';
  END IF;

  -- A new attendance row must be session-backed. The only intentional
  -- sessionless row is a pending student_attendance_query request, which is
  -- explicitly non-approvable until an authoritative session is linked.
  IF TG_OP = 'INSERT'
     AND NEW.session_id IS NULL
     AND NEW.source IS DISTINCT FROM 'student_attendance_query' THEN
    RAISE EXCEPTION 'New attendance requires a valid class session.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Do not reclassify an old legacy sessionless row as a query request, and
    -- do not clear a valid session from a pending normal attendance row.
    IF NEW.session_id IS NULL
       AND NEW.source = 'student_attendance_query'
       AND OLD.source IS DISTINCT FROM NEW.source THEN
      RAISE EXCEPTION 'Legacy attendance cannot be reclassified as a query request.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.session_id IS NULL
       AND NEW.status = 'pending'
       AND NEW.source IS DISTINCT FROM 'student_attendance_query'
       AND (OLD.session_id IS NOT NULL OR OLD.source IS DISTINCT FROM NEW.source) THEN
      RAISE EXCEPTION 'Pending attendance requires a valid class session.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.session_id IS NOT NULL THEN
    SELECT * INTO session_row
    FROM public.attendance_sessions
    WHERE id = NEW.session_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attendance references a missing class session.'
        USING ERRCODE = '23514';
    END IF;

    IF session_row.batch IS DISTINCT FROM NEW.batch
       OR session_row.session_date IS DISTINCT FROM NEW.attendance_date THEN
      RAISE EXCEPTION 'Attendance session does not match its batch and date.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source IN ('student_self_mark', 'student_attendance_query', 'teams_report', 'resolved_unmatched')
       AND session_row.source = 'legacy_backfill' THEN
      RAISE EXCEPTION 'Legacy backfill sessions cannot receive new attendance.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cf_validate_attendance_session_safety_trigger
  ON public.student_attendance;

CREATE TRIGGER cf_validate_attendance_session_safety_trigger
BEFORE INSERT OR UPDATE OF session_id, source, status, batch, attendance_date
ON public.student_attendance
FOR EACH ROW
EXECUTE FUNCTION public.cf_validate_attendance_session_safety();

REVOKE ALL ON FUNCTION public.cf_validate_attendance_session_safety() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_validate_attendance_session_safety() TO service_role;
