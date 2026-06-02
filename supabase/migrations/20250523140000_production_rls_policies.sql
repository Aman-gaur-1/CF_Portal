-- =============================================================================
-- Production RLS policies (ConsoleFlare Portal)
-- =============================================================================
-- Architecture preserved:
--   • Browser uses supabase anon key (students + trainers)
--   • API routes use service_role (AI pipeline, curriculum sync, GitBook ingest)
--   • Trainer login stays env-based (not Supabase Auth)
--
-- Important: Without Supabase Auth, anon policies cannot prove "which student"
-- is logged in. Row isolation for students/trainers still relies on app logic
-- + optional future Auth. These policies add real guards where possible:
--   • curriculum_chunks: client cannot read/write (server-only RAG)
--   • submissions AI columns: only service_role can mutate via trigger
--   • storage: scoped to assignments bucket only
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. submissions — AI column guard (trigger)
-- ---------------------------------------------------------------------------
-- WHY: Students/trainers use the anon client. AI drafts must only be written
-- by /api/generate-feedback (service_role). Trainers may still edit `feedback`
-- (approved text) but cannot forge ai_evaluation or overwrite ai_feedback.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_submission_ai_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role (API routes) may write all AI fields
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Clients may only queue evaluation on insert
    NEW.ai_feedback := NULL;
    NEW.ai_evaluation := NULL;
    NEW.ai_feedback_at := NULL;
    NEW.ai_error := NULL;
    NEW.ai_model := NULL;
    NEW.ai_rag_version := NULL;
    NEW.submission_text := NULL;
    IF NEW.ai_status IS NULL OR NEW.ai_status NOT IN ('pending') THEN
      NEW.ai_status := 'pending';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Preserve AI pipeline columns; allow trainer edits to feedback fields
    NEW.ai_status := OLD.ai_status;
    NEW.ai_feedback := OLD.ai_feedback;
    NEW.ai_evaluation := OLD.ai_evaluation;
    NEW.ai_feedback_at := OLD.ai_feedback_at;
    NEW.ai_error := OLD.ai_error;
    NEW.ai_model := OLD.ai_model;
    NEW.ai_rag_version := OLD.ai_rag_version;
    NEW.submission_text := OLD.submission_text;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_submission_ai_fields ON public.submissions;

CREATE TRIGGER trg_guard_submission_ai_fields
  BEFORE INSERT OR UPDATE ON public.submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_submission_ai_fields();

-- ---------------------------------------------------------------------------
-- B. submissions — RLS policies
-- ---------------------------------------------------------------------------

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- POLICY: submissions_anon_select
-- WHO: anon (browser — students + trainers)
-- WHAT: Read submission rows
-- WHY: Trainers list all submissions; students load their own via .eq('student_id')
--      in the app. True per-student isolation needs Supabase Auth later.
DROP POLICY IF EXISTS submissions_anon_select ON public.submissions;
CREATE POLICY submissions_anon_select
  ON public.submissions
  FOR SELECT
  TO anon
  USING (true);

-- POLICY: submissions_anon_insert
-- WHO: anon (students submitting assignments)
-- WHAT: Insert a new submission
-- WHY: Student portal insert after upload; requires student_id + topic so rows
--      are well-formed. AI fields are stripped/set by trigger above.
DROP POLICY IF EXISTS submissions_anon_insert ON public.submissions;
CREATE POLICY submissions_anon_insert
  ON public.submissions
  FOR INSERT
  TO anon
  WITH CHECK (
    student_id IS NOT NULL
    AND topic IS NOT NULL
    AND length(trim(topic)) > 0
  );

-- POLICY: submissions_anon_update
-- WHO: anon (trainers saving feedback, points, phase)
-- WHAT: Update submission rows
-- WHY: Trainer workflow (FeedbackEditor, approve draft → feedback column).
--      AI columns cannot change from client (trigger enforces).
DROP POLICY IF EXISTS submissions_anon_update ON public.submissions;
CREATE POLICY submissions_anon_update
  ON public.submissions
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- POLICY: submissions_anon_delete
-- WHO: anon (trainers)
-- WHAT: Delete a submission
-- WHY: SubmissionsTab delete action + storage cleanup in app code.
DROP POLICY IF EXISTS submissions_anon_delete ON public.submissions;
CREATE POLICY submissions_anon_delete
  ON public.submissions
  FOR DELETE
  TO anon
  USING (true);

-- ---------------------------------------------------------------------------
-- C. students — RLS policies
-- ---------------------------------------------------------------------------
-- NOTE: Login uses .select('*') with password_hash — cannot hide hash from anon
-- without moving login to a SECURITY DEFINER RPC (future hardening).
-- ---------------------------------------------------------------------------

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- POLICY: students_anon_select
-- WHO: anon
-- WHAT: Read student accounts (including password_hash for login query)
-- WHY: StudentAuth login/register flows; trainer StudentsTab listing.
DROP POLICY IF EXISTS students_anon_select ON public.students;
CREATE POLICY students_anon_select
  ON public.students
  FOR SELECT
  TO anon
  USING (true);

-- POLICY: students_anon_insert
-- WHO: anon
-- WHAT: Register new student
-- WHY: StudentAuth registration form.
DROP POLICY IF EXISTS students_anon_insert ON public.students;
CREATE POLICY students_anon_insert
  ON public.students
  FOR INSERT
  TO anon
  WITH CHECK (
    name IS NOT NULL
    AND length(trim(name)) > 0
    AND batch IS NOT NULL
    AND password_hash IS NOT NULL
    AND length(password_hash) >= 32
  );

-- POLICY: students_anon_update
-- WHO: anon (trainers editing name/batch/password)
-- WHAT: Update student rows
-- WHY: StudentsTab saveEdit (trainer panel).
DROP POLICY IF EXISTS students_anon_update ON public.students;
CREATE POLICY students_anon_update
  ON public.students
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- POLICY: students_anon_delete
-- WHO: anon (trainers)
-- WHAT: Delete student
-- WHY: StudentsTab delete with confirmation.
DROP POLICY IF EXISTS students_anon_delete ON public.students;
CREATE POLICY students_anon_delete
  ON public.students
  FOR DELETE
  TO anon
  USING (true);

-- ---------------------------------------------------------------------------
-- D. curriculum_chunks — RLS policies (server-only)
-- ---------------------------------------------------------------------------
-- WHY: RAG reads/writes use service_role in API routes. Browser must not read
--      curriculum text or inject chunks (IP protection + prompt integrity).
-- ---------------------------------------------------------------------------

ALTER TABLE public.curriculum_chunks ENABLE ROW LEVEL SECURITY;

-- POLICY: curriculum_chunks_deny_anon
-- WHO: anon
-- WHAT: Deny all operations
-- WHY: No client code should access this table; ingestion + rag-source API only.
DROP POLICY IF EXISTS curriculum_chunks_deny_anon ON public.curriculum_chunks;
CREATE POLICY curriculum_chunks_deny_anon
  ON public.curriculum_chunks
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- No policy for service_role: bypasses RLS and retains full access.

-- ---------------------------------------------------------------------------
-- E. storage.objects — assignments bucket
-- ---------------------------------------------------------------------------
-- WHY: Scope file operations to the assignments bucket used by StudentView and
--      trainers. Public URLs may still work if bucket is public; this blocks
--      anon access to other buckets.
-- ---------------------------------------------------------------------------

-- Ensure bucket exists (safe if already created in dashboard)
INSERT INTO storage.buckets (id, name, public)
VALUES ('assignments', 'assignments', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- POLICY: assignments_anon_select
-- WHO: anon
-- WHAT: Download / list files in assignments bucket
-- WHY: Student download links; trainer open file; AI extract downloads via service role.
DROP POLICY IF EXISTS assignments_anon_select ON storage.objects;
CREATE POLICY assignments_anon_select
  ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'assignments');

-- POLICY: assignments_anon_insert
-- WHO: anon (students uploading submission files)
-- WHAT: Upload into assignments bucket only
-- WHY: StudentView handleSubmit storage.upload(...)
DROP POLICY IF EXISTS assignments_anon_insert ON storage.objects;
CREATE POLICY assignments_anon_insert
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'assignments'
    AND name IS NOT NULL
    AND length(name) <= 512
    AND name !~ '[/\\]'
  );

-- POLICY: assignments_anon_delete
-- WHO: anon (trainers removing files when deleting submissions)
-- WHAT: Delete objects in assignments bucket
-- WHY: SubmissionsTab deleteSubmission storage.remove
DROP POLICY IF EXISTS assignments_anon_delete ON storage.objects;
CREATE POLICY assignments_anon_delete
  ON storage.objects
  FOR DELETE
  TO anon
  USING (bucket_id = 'assignments');

-- POLICY: assignments_anon_update
-- WHO: anon — denied (not used by app)
-- WHAT: Prevent overwrite attacks on existing objects
DROP POLICY IF EXISTS assignments_anon_update ON storage.objects;
CREATE POLICY assignments_anon_update
  ON storage.objects
  FOR UPDATE
  TO anon
  USING (false)
  WITH CHECK (false);
