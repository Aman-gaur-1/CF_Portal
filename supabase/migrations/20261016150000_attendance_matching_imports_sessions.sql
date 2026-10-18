-- Additive Attendance + Student Health Card operations model.
-- This migration does not rewrite existing attendance or unlinked rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch text NOT NULL,
  attendance_date date NOT NULL,
  session_id uuid,
  source text NOT NULL DEFAULT 'teams_report',
  original_filename text NOT NULL,
  file_hash text NOT NULL,
  file_size bigint,
  uploaded_by_role text NOT NULL CHECK (uploaded_by_role IN ('admin', 'teacher')),
  uploaded_by_name text NOT NULL,
  total_participants integer NOT NULL DEFAULT 0 CHECK (total_participants >= 0),
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  needs_matching_count integer NOT NULL DEFAULT 0 CHECK (needs_matching_count >= 0),
  already_marked_count integer NOT NULL DEFAULT 0 CHECK (already_marked_count >= 0),
  dismissed_count integer NOT NULL DEFAULT 0 CHECK (dismissed_count >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'blocked')),
  duplicate_of uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch text NOT NULL,
  session_date date NOT NULL,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  source text NOT NULL DEFAULT 'teams_report',
  import_id uuid,
  created_by_role text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_sessions_epoch_check CHECK (session_date >= DATE '2026-10-01'),
  CONSTRAINT attendance_sessions_time_range_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS public.student_identity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  batch text NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL DEFAULT 'manual_resolution',
  created_by_role text NOT NULL CHECK (created_by_role IN ('admin', 'teacher', 'system')),
  created_by_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_identity_aliases_alias_check CHECK (length(btrim(alias)) > 0),
  CONSTRAINT student_identity_aliases_normalized_check CHECK (length(btrim(normalized_alias)) > 0)
);

ALTER TABLE public.unlinked_attendance
  ADD COLUMN IF NOT EXISTS original_participant_name text,
  ADD COLUMN IF NOT EXISTS normalized_participant_name text,
  ADD COLUMN IF NOT EXISTS corrected_display_name text,
  ADD COLUMN IF NOT EXISTS suggested_student_id uuid,
  ADD COLUMN IF NOT EXISTS match_score numeric(6, 5),
  ADD COLUMN IF NOT EXISTS match_type text,
  ADD COLUMN IF NOT EXISTS match_reason text,
  ADD COLUMN IF NOT EXISTS resolved_by_role text,
  ADD COLUMN IF NOT EXISTS resolved_by_name text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_id uuid,
  ADD COLUMN IF NOT EXISTS session_id uuid;

UPDATE public.unlinked_attendance
SET original_participant_name = participant_name
WHERE original_participant_name IS NULL;

UPDATE public.unlinked_attendance
SET normalized_participant_name = lower(regexp_replace(btrim(participant_name), '\\s+', ' ', 'g'))
WHERE normalized_participant_name IS NULL;

ALTER TABLE public.student_attendance
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS import_id uuid,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS original_participant_name text,
  ADD COLUMN IF NOT EXISTS resolved_by_role text,
  ADD COLUMN IF NOT EXISTS resolved_by_name text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

INSERT INTO public.attendance_sessions (batch, session_date, title, source, created_by_role, created_by_name)
SELECT DISTINCT
  a.batch,
  a.attendance_date,
  'Legacy attendance',
  'legacy_backfill',
  'system',
  'attendance migration'
FROM public.student_attendance a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.attendance_sessions s
  WHERE s.batch = a.batch
    AND s.session_date = a.attendance_date
    AND s.source = 'legacy_backfill'
);

UPDATE public.student_attendance a
SET session_id = s.id
FROM public.attendance_sessions s
WHERE a.session_id IS NULL
  AND s.batch = a.batch
  AND s.session_date = a.attendance_date
  AND s.source = 'legacy_backfill';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_imports_session_id_fkey'
      AND conrelid = 'public.attendance_imports'::regclass
  ) THEN
    ALTER TABLE public.attendance_imports
      ADD CONSTRAINT attendance_imports_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_sessions_import_id_fkey'
      AND conrelid = 'public.attendance_sessions'::regclass
  ) THEN
    ALTER TABLE public.attendance_sessions
      ADD CONSTRAINT attendance_sessions_import_id_fkey
      FOREIGN KEY (import_id) REFERENCES public.attendance_imports(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unlinked_attendance_import_id_fkey'
      AND conrelid = 'public.unlinked_attendance'::regclass
  ) THEN
    ALTER TABLE public.unlinked_attendance
      ADD CONSTRAINT unlinked_attendance_import_id_fkey
      FOREIGN KEY (import_id) REFERENCES public.attendance_imports(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unlinked_attendance_session_id_fkey'
      AND conrelid = 'public.unlinked_attendance'::regclass
  ) THEN
    ALTER TABLE public.unlinked_attendance
      ADD CONSTRAINT unlinked_attendance_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_attendance_session_id_fkey'
      AND conrelid = 'public.student_attendance'::regclass
  ) THEN
    ALTER TABLE public.student_attendance
      ADD CONSTRAINT student_attendance_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_attendance_import_id_fkey'
      AND conrelid = 'public.student_attendance'::regclass
  ) THEN
    ALTER TABLE public.student_attendance
      ADD CONSTRAINT student_attendance_import_id_fkey
      FOREIGN KEY (import_id) REFERENCES public.attendance_imports(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.student_attendance
  DROP CONSTRAINT IF EXISTS student_attendance_unique_student_day;

ALTER TABLE public.unlinked_attendance
  DROP CONSTRAINT IF EXISTS unlinked_attendance_unique_name_day;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_default_key_idx
  ON public.attendance_sessions (batch, session_date, coalesce(title, ''), coalesce(starts_at, 'epoch'::timestamptz));

CREATE UNIQUE INDEX IF NOT EXISTS attendance_imports_duplicate_key_idx
  ON public.attendance_imports (file_hash, batch, attendance_date, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE UNIQUE INDEX IF NOT EXISTS student_identity_aliases_batch_alias_idx
  ON public.student_identity_aliases (batch, normalized_alias);

CREATE UNIQUE INDEX IF NOT EXISTS student_attendance_student_session_idx
  ON public.student_attendance (student_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unlinked_attendance_participant_session_idx
  ON public.unlinked_attendance (
    participant_name,
    batch,
    attendance_date,
    coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS attendance_imports_batch_date_idx
  ON public.attendance_imports (batch, attendance_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS attendance_imports_file_hash_idx
  ON public.attendance_imports (file_hash);

CREATE INDEX IF NOT EXISTS attendance_sessions_batch_date_idx
  ON public.attendance_sessions (batch, session_date DESC, starts_at DESC);

CREATE INDEX IF NOT EXISTS student_identity_aliases_lookup_idx
  ON public.student_identity_aliases (batch, normalized_alias)
  WHERE active;

CREATE INDEX IF NOT EXISTS unlinked_attendance_matching_idx
  ON public.unlinked_attendance (batch, status, attendance_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS student_attendance_session_lookup_idx
  ON public.student_attendance (session_id, student_id);

ALTER TABLE public.attendance_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_identity_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full_access_attendance_imports ON public.attendance_imports;
CREATE POLICY service_role_full_access_attendance_imports
  ON public.attendance_imports FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full_access_attendance_sessions ON public.attendance_sessions;
CREATE POLICY service_role_full_access_attendance_sessions
  ON public.attendance_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full_access_student_identity_aliases ON public.student_identity_aliases;
CREATE POLICY service_role_full_access_student_identity_aliases
  ON public.student_identity_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.attendance_imports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.attendance_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.student_identity_aliases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_imports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_identity_aliases TO service_role;

REVOKE ALL ON TABLE public.unlinked_attendance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unlinked_attendance TO service_role;
REVOKE ALL ON TABLE public.student_attendance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_attendance TO service_role;

COMMIT;
