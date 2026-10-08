import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.NODE_ENV = 'test'
process.env.STUDENT_SESSION_SECRET = 'student-test-secret'
process.env.TEACHER_SESSION_SECRET = 'teacher-test-secret'
process.env.ADMIN_SESSION_SECRET = 'admin-test-secret'

const studentAuth = await import('../lib/student-auth.js')
const teacherAuth = await import('../lib/teacher-auth.js')
const adminAuth = await import('../lib/admin-auth.js')

const profile = { id: 'student-1', name: 'Student One', batch: 'Batch A' }
const originalNow = Date.now
const issuedAt = 2_000_000_000_000
Date.now = () => issuedAt

const access = studentAuth.createStudentToken(profile)
const refresh = studentAuth.createStudentRefreshToken(profile)
assert.deepEqual(studentAuth.verifyStudentToken(access), profile)
assert.deepEqual(studentAuth.verifyStudentRefreshToken(refresh), profile)
assert.equal(studentAuth.verifyStudentToken(refresh), null)
assert.equal(studentAuth.verifyStudentRefreshToken(access), null)
const requestWith = token => ({ headers: new Headers({ Authorization: `Bearer ${token}` }) })
assert.deepEqual(studentAuth.getStudentFromRequest(requestWith(access)), profile, 'fresh protected request is authorized')

process.env.STUDENT_ACCESS_TOKEN_TTL_SECONDS = '60'
const shortAccess = studentAuth.createStudentToken(profile)
const shortPayload = JSON.parse(Buffer.from(shortAccess.split('.')[0], 'base64url').toString('utf8'))
assert.equal(shortPayload.exp - issuedAt, 60_000, 'configured student access TTL is applied')
delete process.env.STUDENT_ACCESS_TOKEN_TTL_SECONDS

Date.now = () => issuedAt + 13 * 60 * 60 * 1000
assert.equal(studentAuth.verifyStudentToken(access), null, 'expired access token must remain unauthorized')
assert.equal(studentAuth.getStudentFromRequest(requestWith(access)), null, 'protected request rejects expired access')
assert.deepEqual(studentAuth.verifyStudentRefreshToken(refresh), profile, 'refresh session survives access expiry')
const refreshedAccess = studentAuth.createStudentToken(profile)
assert.deepEqual(studentAuth.getStudentFromRequest(requestWith(refreshedAccess)), profile, 'protected request accepts refreshed access')

function createLegacyToken(exp) {
  const encoded = Buffer.from(JSON.stringify({ ...profile, role: 'student', exp })).toString('base64url')
  const signature = crypto.createHmac('sha256', process.env.STUDENT_SESSION_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

const legacy = createLegacyToken(issuedAt + 12 * 60 * 60 * 1000)
assert.equal(studentAuth.verifyStudentToken(legacy), null)
assert.deepEqual(studentAuth.verifyLegacyStudentTokenForRefresh(legacy), profile)
Date.now = () => issuedAt + 31 * 24 * 60 * 60 * 1000
assert.equal(studentAuth.verifyLegacyStudentTokenForRefresh(legacy), null, 'legacy migration window is bounded')

Date.now = () => issuedAt
const teacher = teacherAuth.createTeacherToken('Teacher One')
const admin = adminAuth.createAdminToken('Admin One')
assert.deepEqual(teacherAuth.verifyTeacherToken(teacher), { name: 'Teacher One' })
assert.deepEqual(adminAuth.verifyAdminToken(admin), { name: 'Admin One' })
assert.equal(studentAuth.verifyStudentToken(teacher), null)
assert.equal(studentAuth.verifyStudentToken(admin), null)

Date.now = originalNow
console.log('Authentication session tests passed')
