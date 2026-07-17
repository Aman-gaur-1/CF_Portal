-- Final Notification Center enhancements.
-- Adds rich notification metadata and lifecycle fields without changing workflow.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS action_label text,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS notifications_expiry_idx
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

INSERT INTO public.system_settings (key, value, description)
VALUES
  ('NOTIFICATION_PREFERENCES', '{}'::jsonb, 'Per-user notification preferences by user type and identifier.'),
  ('NOTIFICATION_RETENTION_DAYS', '30'::jsonb, 'Notification retention period in days.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
