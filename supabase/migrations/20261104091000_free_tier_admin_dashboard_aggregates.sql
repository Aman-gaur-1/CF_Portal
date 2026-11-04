-- Compact admin dashboard aggregates. The server route authorizes the admin
-- before calling this service-role-only function; no submission rows leave SQL.
CREATE OR REPLACE FUNCTION public.cf_admin_dashboard_aggregates(p_student_status text DEFAULT 'active')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH selected_students AS (
  SELECT id
  FROM public.students
  WHERE p_student_status = 'all' OR status = p_student_status
),
submission_summary AS (
  SELECT
    count(*)::integer AS total_assignments,
    count(*) FILTER (WHERE feedback IS NOT NULL OR feedback_at IS NOT NULL)::integer AS total_reviewed,
    count(*) FILTER (WHERE ai_status = 'ready')::integer AS ai_ready,
    count(*) FILTER (WHERE ai_status = 'failed')::integer AS ai_failed,
    count(*) FILTER (WHERE COALESCE(feedback IS NOT NULL, false) = false AND COALESCE(feedback_at IS NOT NULL, false) = false AND ai_feedback IS NULL)::integer AS pending_queue,
    count(*) FILTER (WHERE COALESCE(ai_feedback_at, submitted_at) >= current_date AND ai_status IS NOT NULL)::integer AS today_requests,
    count(*) FILTER (WHERE COALESCE(ai_feedback_at, submitted_at) >= current_date AND ai_status = 'ready')::integer AS generated_today,
    count(*) FILTER (WHERE COALESCE(ai_feedback_at, submitted_at) >= current_date AND ai_status = 'failed')::integer AS failed_today
  FROM public.submissions
),
batch_stats AS (
  SELECT jsonb_object_agg(name, jsonb_build_object(
    'submissionCount', submission_count,
    'pendingCount', GREATEST(submission_count - reviewed_count, 0)
  )) AS value
  FROM (
    SELECT
      b.name,
      count(s.id)::integer AS submission_count,
      count(s.id) FILTER (WHERE s.feedback IS NOT NULL OR s.feedback_at IS NOT NULL)::integer AS reviewed_count
    FROM public.batches b
    LEFT JOIN public.submissions s ON s.batch = b.name
    GROUP BY b.name
  ) grouped
),
student_counts AS (
  SELECT jsonb_object_agg(ss.id::text, COALESCE(counts.submission_count, 0)) AS value
  FROM selected_students ss
  LEFT JOIN (
    SELECT student_id, count(*)::integer AS submission_count
    FROM public.submissions
    GROUP BY student_id
  ) counts ON counts.student_id = ss.id
)
SELECT jsonb_build_object(
  'metrics', jsonb_build_object(
    'totalAssignments', submission_summary.total_assignments,
    'totalReviewed', submission_summary.total_reviewed,
    'pendingReviews', GREATEST(submission_summary.total_assignments - submission_summary.total_reviewed, 0),
    'reviewCompletionRate', CASE WHEN submission_summary.total_assignments > 0 THEN round((submission_summary.total_reviewed::numeric / submission_summary.total_assignments) * 100)::integer ELSE 0 END,
    'aiReady', submission_summary.ai_ready,
    'aiFailed', submission_summary.ai_failed,
    'aiFinished', submission_summary.ai_ready + submission_summary.ai_failed,
    'successRate', CASE WHEN submission_summary.ai_ready + submission_summary.ai_failed > 0 THEN round((submission_summary.ai_ready::numeric / (submission_summary.ai_ready + submission_summary.ai_failed)) * 100)::integer ELSE NULL END,
    'todayRequests', submission_summary.today_requests,
    'generatedToday', submission_summary.generated_today,
    'failedToday', submission_summary.failed_today,
    'pendingQueue', submission_summary.pending_queue
  ),
  'batchStats', COALESCE(batch_stats.value, '{}'::jsonb),
  'studentSubmissionCounts', COALESCE(student_counts.value, '{}'::jsonb)
)
FROM submission_summary, batch_stats, student_counts;
$$;

REVOKE ALL ON FUNCTION public.cf_admin_dashboard_aggregates(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cf_admin_dashboard_aggregates(text) TO service_role;
