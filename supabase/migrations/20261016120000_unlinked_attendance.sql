-- Stores attendance entries from uploaded Teams reports that could not be matched
-- to any registered student. When students register later, admin/teacher can re-match.

CREATE TABLE IF NOT EXISTS public.unlinked_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_name text NOT NULL,
  batch text NOT NULL,
  attendance_date date NOT NULL,
  uploaded_by_role text NOT NULL CHECK (uploaded_by_role IN ('admin', 'teacher')),
  uploaded_by_name text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'linked', 'dismissed')),
  linked_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unlinked_attendance_epoch_check CHECK (attendance_date >= DATE '2026-10-01'),
  CONSTRAINT unlinked_attendance_unique_name_day UNIQUE (participant_name, batch, attendance_date)
);

ALTER TABLE public.unlinked_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_unlinked_attendance"
  ON public.unlinked_attendance
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unlinked_attendance TO service_role;
