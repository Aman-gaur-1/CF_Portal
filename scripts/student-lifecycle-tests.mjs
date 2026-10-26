import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const studentView = read('components/student/StudentView.jsx')
const adminCurriculum = read('components/admin/CurriculumPanel.jsx')
const teacherCurriculum = read('components/teacher/StudentHealthPanel.jsx')
const loginRoute = read('app/api/student-login/route.js')
const adminLifecycle = read('app/api/admin-student-lifecycle/route.js')
const teacherLifecycle = read('app/api/teacher-student-lifecycle/route.js')
const migration = read('supabase/migrations/20261025120000_student_lifecycle_management.sql')

assert(studentView.includes('selectedType') && studentView.includes('selectedPhaseFilter') && studentView.includes('visibleCoursework'), 'student type → phase → coursework filtering is missing')
assert(studentView.includes('No active assignments are available for your batch yet.') && studentView.includes('No active projects are available for your batch yet.'), 'type-specific student empty states are missing')
assert(adminCurriculum.includes('releasePhase') && adminCurriculum.includes('releaseType') && adminCurriculum.includes('Bulk Release Coursework') && adminCurriculum.includes('Preview Release'), 'admin bulk batch/phase/type activation UX is missing')
assert(teacherCurriculum.includes('activationPhase') && teacherCurriculum.includes('activationType') && teacherCurriculum.includes('Activate selected'), 'teacher batch/phase/type activation UX is missing')
assert(loginRoute.includes("status === 'inactive'") && loginRoute.includes('Your student account is inactive. Please contact your trainer or administrator.'), 'inactive login guard is missing')
assert(adminLifecycle.includes("action === 'reactivate'") && adminLifecycle.includes("confirmation || '') !== 'DELETE'") || adminLifecycle.includes('Type DELETE to permanently remove this student.'), 'admin lifecycle controls are incomplete')
assert(adminLifecycle.includes('cf_delete_zero_history_student') && adminLifecycle.includes('This student has historical coursework or attendance records. Deactivate the student instead.'), 'admin guarded delete path is missing')
assert(teacherLifecycle.includes('getTeacherScope') && teacherLifecycle.includes("action !== 'deactivate'") && !teacherLifecycle.includes('export async function DELETE'), 'teacher lifecycle scope/delete boundary is missing')
assert(migration.includes('students_status_check') && migration.includes('cf_delete_zero_history_student'), 'student lifecycle migration is incomplete')
assert(migration.includes("PARTITION BY bm.status") && migration.includes("bm.status = 'active'"), 'inactive leaderboard exclusion is missing')

console.log('Student lifecycle regression tests passed.')
