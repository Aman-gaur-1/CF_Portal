-- Free-tier analytics aggregation. The API authenticates the teacher and
-- supplies the authoritative batch scope; this function only aggregates rows
-- in that scope and is not exposed to browser roles.
CREATE OR REPLACE FUNCTION public.cf_teacher_submission_analytics(
  p_batch_names text[],
  p_confirmed_reviewed_ids text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH scoped AS (
  SELECT
    id,
    batch,
    submitted_at,
    feedback,
    feedback_at,
    ai_status,
    ai_feedback
  FROM public.submissions
  WHERE batch = ANY (COALESCE(p_batch_names, '{}'::text[]))
),
summary AS (
  SELECT
    count(*)::integer AS total_submissions,
    count(*) FILTER (WHERE feedback IS NULL AND feedback_at IS NULL)::integer AS total_pending,
    count(*) FILTER (WHERE feedback IS NOT NULL OR feedback_at IS NOT NULL)::integer AS total_reviewed,
    count(*) FILTER (WHERE feedback IS NULL AND feedback_at IS NULL AND (ai_status = 'ready' OR ai_feedback IS NOT NULL))::integer AS ai_ready,
    count(*) FILTER (WHERE feedback IS NULL AND feedback_at IS NULL AND ai_status = 'failed')::integer AS ai_failed,
    count(*) FILTER (WHERE feedback IS NULL AND feedback_at IS NULL AND ai_status = 'processing')::integer AS ai_processing,
    count(*) FILTER (WHERE feedback IS NULL AND feedback_at IS NULL AND ai_status = 'pending')::integer AS ai_pending
  FROM scoped
),
trend AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', to_char(day_value, 'YYYY-MM-DD'),
      'label', to_char(day_value, 'Dy'),
      'submissions', (SELECT count(*) FROM scoped s WHERE s.submitted_at >= day_value AND s.submitted_at < day_value + interval '1 day')::integer
    ) ORDER BY day_value
  ) AS value
  FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') AS day_value
),
distribution AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'batch', batch_name,
      'submissions', submission_count,
      'pending', pending_count
    ) ORDER BY submission_count DESC, batch_name
  ) AS value
  FROM (
    SELECT
      COALESCE(NULLIF(batch, ''), 'Unassigned') AS batch_name,
      count(*)::integer AS submission_count,
      count(*) FILTER (WHERE feedback IS NULL AND feedback_at IS NULL AND NOT (id::text = ANY (COALESCE(p_confirmed_reviewed_ids, '{}'::text[]))))::integer AS pending_count
    FROM scoped
    GROUP BY COALESCE(NULLIF(batch, ''), 'Unassigned')
    ORDER BY submission_count DESC, batch_name
    LIMIT 8
  ) grouped
)
SELECT jsonb_build_object(
  'totalSubmissions', summary.total_submissions,
  'totalPending', summary.total_pending,
  'totalReviewed', summary.total_reviewed,
  'aiHealth', jsonb_build_object(
    'ready', summary.ai_ready,
    'failed', summary.ai_failed,
    'processing', summary.ai_processing,
    'pending', summary.ai_pending
  ),
  'sevenDayTrend', COALESCE(trend.value, '[]'::jsonb),
  'batchDistribution', COALESCE(distribution.value, '[]'::jsonb)
)
FROM summary, trend, distribution;
$$;

REVOKE ALL ON FUNCTION public.cf_teacher_submission_analytics(text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_teacher_submission_analytics(text[], text[]) TO service_role;
