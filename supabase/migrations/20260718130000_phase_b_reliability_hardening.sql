-- Phase B reliability hardening: shared rate limits and supporting indexes.

CREATE TABLE IF NOT EXISTS public.cf_rate_limits (
  rate_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cf_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cf_rate_limits_deny_anon ON public.cf_rate_limits;
CREATE POLICY cf_rate_limits_deny_anon
  ON public.cf_rate_limits
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.cf_rate_limits FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cf_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.cf_consume_rate_limit(
  p_rate_key text,
  p_window_seconds integer,
  p_max_attempts integer
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer, current_count integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := trim(coalesce(p_rate_key, ''));
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 60), 86400));
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 10), 10000));
  v_row public.cf_rate_limits%ROWTYPE;
BEGIN
  IF v_key = '' THEN
    allowed := false;
    retry_after_seconds := v_window;
    current_count := 0;
    reset_at := now() + make_interval(secs => v_window);
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.cf_rate_limits(rate_key, count, reset_at, updated_at)
  VALUES (v_key, 0, now() + make_interval(secs => v_window), now())
  ON CONFLICT (rate_key) DO NOTHING;

  SELECT * INTO v_row
  FROM public.cf_rate_limits
  WHERE rate_key = v_key
  FOR UPDATE;

  IF v_row.reset_at <= now() THEN
    UPDATE public.cf_rate_limits
    SET count = 1,
        reset_at = now() + make_interval(secs => v_window),
        updated_at = now()
    WHERE rate_key = v_key
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.cf_rate_limits
    SET count = count + 1,
        updated_at = now()
    WHERE rate_key = v_key
    RETURNING * INTO v_row;
  END IF;

  allowed := v_row.count <= v_max;
  retry_after_seconds := greatest(ceil(extract(epoch FROM (v_row.reset_at - now())))::integer, 1);
  current_count := v_row.count;
  reset_at := v_row.reset_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cf_consume_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_consume_rate_limit(text, integer, integer) TO service_role;

CREATE INDEX IF NOT EXISTS submissions_ai_health_recent_idx
  ON public.submissions (ai_status, ai_feedback_at DESC)
  WHERE ai_status IN ('ready', 'failed');

CREATE INDEX IF NOT EXISTS activity_log_created_at_idx
  ON public.activity_log (created_at DESC);
