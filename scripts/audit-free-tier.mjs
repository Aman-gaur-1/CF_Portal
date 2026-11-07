import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const vercel = JSON.parse(read('vercel.json'))
assert.deepEqual(vercel.regions, ['bom1'])
assert.deepEqual(vercel.crons, [
  { path: '/api/cron/auto-approval', schedule: '0 3 * * *' },
  { path: '/api/cron/notifications', schedule: '15 3 * * *' },
])

const polling = read('lib/use-adaptive-polling.js')
const student = read('components/student/StudentView.jsx')
const teacher = read('components/teacher/SubmissionsTab.jsx')
const notifications = read('components/ui/NotificationBell.jsx')
const reviewActivity = read('app/api/teacher-review-activity/route.js')
const adminCoursework = read('app/api/admin-coursework/route.js')
const studentCourseworkRoute = read('app/api/student-coursework/route.js')
const studentHealthRoute = read('app/api/student-health/route.js')

assert.match(polling, /activeMs === null \|\| activeMs === false/)
assert.match(polling, /document\.visibilityState === "hidden"/)
assert.match(polling, /inFlight = true/)
assert.match(student, /activeMs: null/)
assert.match(student, /activeMs: 5 \* 60 \* 1000/)
assert.match(teacher, /REVIEW_REFRESH_MS = 5 \* 60 \* 1000/)
assert.match(teacher, /enabled: Boolean\(teacherToken\) && activeSubmissionId !== null && reviewSessionActive/)
assert.match(notifications, /15 \* 60 \* 1000/)
assert.match(notifications, /5 \* 60 \* 1000/)
assert.match(reviewActivity, /assertSubmissionInTeacherScope/)
assert.match(adminCoursework, /submissions\(count\)/)
assert.doesNotMatch(adminCoursework, /select\(['"]\*['"]\)/)
assert.match(studentCourseworkRoute, /abortSignal\(request\.signal\)/)
assert.match(studentHealthRoute, /abortSignal\(request\.signal\)/)

console.log('free-tier static audit passed; no production traffic was generated')
