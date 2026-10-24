-- Staging-only rehearsal for the attendance session-safety guard.
-- Every insert, trigger, and fixture is rolled back.

BEGIN;

DROP TRIGGER IF EXISTS cf_validate_attendance_session_safety_trigger
  ON public.student_attendance;
DROP FUNCTION IF EXISTS public.cf_validate_attendance_session_safety();

-- Confirm the old deployed writer shape was accepted before the guard: it
-- omitted source and session_id, allowing the column default source=legacy.
SAVEPOINT legacy_writer_attempt;
DO $$
DECLARE
  student_row public.students%ROWTYPE;
BEGIN
  SELECT * INTO student_row FROM public.students ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staging has no student fixture.'; END IF;
  INSERT INTO public.student_attendance(student_id, batch, attendance_date, status, marked_at)
  VALUES (student_row.id, student_row.batch, DATE '2099-01-01', 'pending', now());
END $$;
ROLLBACK TO SAVEPOINT legacy_writer_attempt;

\ir attendance_session_safety_guard.sql

DO $$
DECLARE
  student_row public.students%ROWTYPE;
  normal_session_id uuid;
  legacy_session_id uuid;
  first_session_id uuid;
  second_session_id uuid;
  query_attendance_id uuid;
BEGIN
  SELECT * INTO student_row FROM public.students ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staging has no student fixture.'; END IF;

  -- The former old-route write is rejected by the database guard.
  BEGIN
    INSERT INTO public.student_attendance(student_id, batch, attendance_date, status, marked_at)
    VALUES (student_row.id, student_row.batch, DATE '2099-01-01', 'pending', now());
    RAISE EXCEPTION 'Expected the legacy sessionless insert to be rejected.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO public.attendance_sessions(batch, session_date, title, source, created_by_role, created_by_name)
  VALUES (student_row.batch, DATE '2099-01-02', 'CF safety normal session', 'teams_report', 'system', 'safety rehearsal')
  RETURNING id INTO normal_session_id;

  INSERT INTO public.student_attendance(student_id, batch, attendance_date, session_id, source, status, marked_at)
  VALUES (student_row.id, student_row.batch, DATE '2099-01-02', normal_session_id, 'student_self_mark', 'pending', now());

  BEGIN
    INSERT INTO public.student_attendance(student_id, batch, attendance_date, session_id, source, status, marked_at)
    VALUES (student_row.id, student_row.batch, DATE '2099-01-02', normal_session_id, 'student_self_mark', 'pending', now());
    RAISE EXCEPTION 'Expected the same student/session duplicate to be rejected.';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO public.attendance_sessions(batch, session_date, title, source, created_by_role, created_by_name)
  VALUES (student_row.batch, DATE '2099-01-02', 'CF safety legacy session', 'legacy_backfill', 'system', 'safety rehearsal')
  RETURNING id INTO legacy_session_id;

  BEGIN
    INSERT INTO public.student_attendance(student_id, batch, attendance_date, session_id, source, status, marked_at)
    VALUES (student_row.id, student_row.batch, DATE '2099-01-02', legacy_session_id, 'student_self_mark', 'pending', now());
    RAISE EXCEPTION 'Expected self-mark on legacy_backfill session to be rejected.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- A missing-attendance query remains pending and sessionless, but cannot be
  -- approved until a real session is linked. Rejection remains possible.
  INSERT INTO public.student_attendance(student_id, batch, attendance_date, source, status, marked_at)
  VALUES (student_row.id, student_row.batch, DATE '2099-01-03', 'student_attendance_query', 'pending', now())
  RETURNING id INTO query_attendance_id;

  BEGIN
    UPDATE public.student_attendance SET status = 'approved' WHERE id = query_attendance_id;
    RAISE EXCEPTION 'Expected sessionless query approval to be rejected.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.student_attendance SET status = 'rejected' WHERE id = query_attendance_id;

  -- Two sessions on one day remain independently valid and independently
  -- deduplicated by the existing (student_id, session_id) index.
  INSERT INTO public.attendance_sessions(batch, session_date, title, starts_at, source, created_by_role, created_by_name)
  VALUES (student_row.batch, DATE '2099-01-04', 'CF safety session one', TIMESTAMPTZ '2099-01-04 10:00:00+05:30', 'teams_report', 'system', 'safety rehearsal')
  RETURNING id INTO first_session_id;
  INSERT INTO public.attendance_sessions(batch, session_date, title, starts_at, source, created_by_role, created_by_name)
  VALUES (student_row.batch, DATE '2099-01-04', 'CF safety session two', TIMESTAMPTZ '2099-01-04 11:00:00+05:30', 'teams_report', 'system', 'safety rehearsal')
  RETURNING id INTO second_session_id;
  INSERT INTO public.student_attendance(student_id, batch, attendance_date, session_id, source, status, marked_at)
  VALUES
    (student_row.id, student_row.batch, DATE '2099-01-04', first_session_id, 'teams_report', 'approved', now()),
    (student_row.id, student_row.batch, DATE '2099-01-04', second_session_id, 'teams_report', 'approved', now());

  RAISE NOTICE 'attendance session-safety rehearsal assertions passed; rolling back';
END $$;

ROLLBACK;
