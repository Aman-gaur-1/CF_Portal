import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const polling = read('lib/use-adaptive-polling.js')
const student = read('components/student/StudentView.jsx')
const teacherReviews = read('components/teacher/SubmissionsTab.jsx')
const teacherAnalytics = read('app/api/teacher-analytics/route.js')
const teacherData = read('app/api/teacher-data/route.js')
const notificationsRoute = read('app/api/notifications/route.js')
const notifications = read('lib/notifications.js')
const notificationBell = read('components/ui/NotificationBell.jsx')
const settings = read('lib/system-settings.js')
const adminRoute = read('app/api/admin-dashboard/route.js')
const adminDetailRoute = read('app/api/admin-student-submissions/route.js')
const cronNotifications = read('app/api/cron/notifications/route.js')
const vercel = read('vercel.json')
const reviewActivity = read('app/api/teacher-review-activity/route.js')
const extraction = read('lib/ai/extract.js')

// 1-3: polling safety invariants
assert.match(polling, /document\.visibilityState === "hidden"/)
assert.match(polling, /document\.visibilityState === "hidden"\) return/)
assert.match(polling, /inFlight = true/)
assert.match(polling, /refreshOnResume/)
assert.match(polling, /refreshOnOnline/)

// 4-7: student coursework and AI/query cadence
assert.doesNotMatch(student, /activeMs: 15000/)
assert.match(student, /activeMs: null/)
assert.match(student, /PENDING_AI_BACKOFF_MS = \[7000, 15000, 30000, 60000\]/)
assert.match(student, /enabled: needsSubmissionPolling/)
assert.match(student, /activeMs: 5 \* 60 \* 1000/)

// 8-12: teacher review data is decoupled from supporting endpoints
assert.match(teacherReviews, /includeSupporting = true/)
assert.match(teacherReviews, /includeSupporting: false/)
assert.match(teacherReviews, /REVIEW_REFRESH_MS = 5 \* 60 \* 1000/)
assert.match(teacherReviews, /fetch\("\/api\/assignment-phases"/)
assert.match(teacherReviews, /document\.addEventListener\("visibilitychange"/)

// 13-16: aggregate analytics and scope enforcement
assert.match(teacherAnalytics, /rpc\('cf_teacher_submission_analytics'/)
assert.doesNotMatch(teacherAnalytics, /limit\(5000\)/)
assert.match(teacherAnalytics, /getTeacherScope\(supabase, teacher\.name\)/)
assert.match(teacherData, /getTeacherFromRequest\(request\)/)

// 17-21: notifications are read-only and analytics are opt-in
assert.doesNotMatch(notificationsRoute, /ensureOperationalNotifications\(/)
assert.doesNotMatch(notificationsRoute, /pruneExpiredNotifications\(/)
assert.match(notificationsRoute, /analyticsRequested = .*=== '1'/)
assert.match(notifications, /export async function runNotificationMaintenance/)
assert.match(cronNotifications, /runNotificationMaintenance/)

// 22-24: notification client behavior is event-led, visible-only, and cheap
assert.match(notificationBell, /analytics\", \"1\"/)
assert.match(notificationBell, /15 \* 60 \* 1000/)
assert.match(notificationBell, /5 \* 60 \* 1000/)
assert.doesNotMatch(notificationBell, /hiddenMs:/)

// 25-27: settings cache, admin aggregation, and lazy detail loading
assert.match(settings, /SETTINGS_TTL_MS/)
assert.match(settings, /settingsCaches = new WeakMap/)
assert.match(settings, /settingsCache\?\.delete\(settingKey\)/)
assert.match(adminRoute, /rpc\('cf_admin_dashboard_aggregates'/)
assert.doesNotMatch(adminRoute, /fetchAllRows\(supabase, 'submissions'/)
assert.match(adminDetailRoute, /eq\('student_id', studentId\)/)

// Business/security guardrails remain present in the optimized release.
assert.match(read('app/api/student-coursework/route.js'), /getStudentFromRequest/)
assert.match(read('lib/review-state.js'), /isReviewedSubmission/)
assert.match(read('app/api/student-health/route.js'), /cf_get_student_health_card/)
assert.match(read('app/api/attendance-upload/route.js'), /attendance/)
assert.match(read('app/api/admin-roster/route.js'), /loadUsedLoginIds/)
assert.match(vercel, /api\/cron\/notifications/)
assert.match(vercel, /"regions":\s*\[\s*"bom1"\s*\]/)
assert.match(vercel, /student-coursework\/route\.js[\s\S]*supportsCancellation/)
assert.match(vercel, /student-health\/route\.js[\s\S]*supportsCancellation/)
assert.match(reviewActivity, /assertSubmissionInTeacherScope/)
assert.match(reviewActivity, /status === 403/)

// OCR is deliberately fallback-only; cached extraction must short-circuit
// before downloading a PDF or starting Tesseract again.
assert.match(extraction, /cached-submission-text/)
assert.match(extraction, /submission\.submission_text\?\.trim\(\)/)

assert.ok(fs.existsSync(new URL('../docs/FREE_TIER_OPERATIONS.md', import.meta.url)))
assert.ok(fs.existsSync(new URL('../scripts/audit-free-tier.mjs', import.meta.url)))

console.log('free-tier performance regression checks passed')
