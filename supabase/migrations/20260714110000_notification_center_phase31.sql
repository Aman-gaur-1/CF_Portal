-- Phase 3.1 Notification Center foundation.
-- Generic notification storage for student, trainer, admin, and future modules.

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type text NOT NULL,
  user_identifier text NOT NULL,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  reference_type text,
  reference_id text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON public.notifications (user_type, user_identifier, notification_type, reference_type, reference_id);

CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON public.notifications (user_type, user_identifier, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_type, user_identifier, created_at DESC)
  WHERE is_read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_deny_anon ON public.notifications;
CREATE POLICY notifications_deny_anon
  ON public.notifications
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.notifications FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO service_role;

NOTIFY pgrst, 'reload schema';
