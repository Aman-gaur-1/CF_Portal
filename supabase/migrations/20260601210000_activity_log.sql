-- Lightweight append-only operational activity history.
-- Application reads are limited to recent rows and old rows are pruned by
-- the server helper. Browser clients do not write to this table.

CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  description text NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('teacher', 'admin', 'system')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
  ON public.activity_log (created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.activity_log IS
  'Short-lived append-only operational history for the admin Recent Activity panel.';
