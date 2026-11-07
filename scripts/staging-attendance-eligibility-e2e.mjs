import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { hashStudentPasswordSecure } from '../lib/student-auth.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'
const tag = `ATTENDANCE-ELIGIBILITY-${Date.now()}`
const batch = `${tag}-INITIAL`
const batchWithJoinDate = `${tag}-JOIN-DATE`
const transferBatch = `${tag}-TRANSFER`
const batchStart = '2026-11-02'
const explicitJoinDate = '2026-11-04'

function readEnv(filePath) {
  const values = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
}

const localEnv = readEnv(path.join(root, '.env.local'))
const stagingEnvPath = process.env.CF_PORTAL_STAGING_ENV_FILE || path.resolve(root, '..', 'CF_Portal', '.env.staging.local')
const stagingEnv = readEnv(stagingEnvPath)
assert.match(stagingEnv.NEXT_PUBLIC_SUPABASE_URL || '', /bgpmsckjvutnqkryxknb\.supabase\.co$/)
const serviceKey = stagingEnv.SUPABASE_SERVICE_KEY || stagingEnv.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey, 'staging service key is required')
const db = createClient(stagingEnv.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  const payload = await response.json().catch(() => ({}))
  assert.ok(response.ok, `${options.method || 'GET'} ${pathname} failed: ${payload.error || response.status}`)
  return { response, payload }
}

const adminCredentials = JSON.parse(localEnv.ADMIN_CREDENTIALS || '{}')
const [adminUsername, adminPassword] = Object.entries(adminCredentials)[0] || []
assert.ok(adminUsername && adminPassword, 'local admin credentials are required')

let studentId = null
let joinDateStudentId = null
let transferStudentId = null
let attendanceId = null
let sessionId = null
const cleanupErrors = []

async function removeRows(table, configure) {
  let query = db.from(table).delete()
  query = configure(query)
  const { error } = await query
  if (error) cleanupErrors.push(`${table}: ${error.message}`)
}

async function cleanup() {
  if (studentId) await removeRows('student_attendance', query => query.eq('student_id', studentId))
  if (joinDateStudentId) await removeRows('student_attendance', query => query.eq('student_id', joinDateStudentId))
  if (transferStudentId) await removeRows('student_attendance', query => query.eq('student_id', transferStudentId))
  await removeRows('attendance_sessions', query => query.in('batch', [batch, batchWithJoinDate, transferBatch]))
  if (studentId) await removeRows('student_identity_aliases', query => query.eq('student_id', studentId))
  if (joinDateStudentId) await removeRows('student_identity_aliases', query => query.eq('student_id', joinDateStudentId))
  if (studentId) await removeRows('student_batch_memberships', query => query.eq('student_id', studentId))
  if (joinDateStudentId) await removeRows('student_batch_memberships', query => query.eq('student_id', joinDateStudentId))
  if (transferStudentId) await removeRows('student_batch_memberships', query => query.eq('student_id', transferStudentId))
  if (studentId) await removeRows('students', query => query.eq('id', studentId))
  if (joinDateStudentId) await removeRows('students', query => query.eq('id', joinDateStudentId))
  if (transferStudentId) await removeRows('students', query => query.eq('id', transferStudentId))
  await removeRows('student_roster_imports', query => query.in('batch', [batch, batchWithJoinDate, transferBatch]))
  await removeRows('activity_log', query => query.or(`description.ilike.%${tag}%,metadata->>batch.eq.${batch},metadata->>batch.eq.${batchWithJoinDate},metadata->>batch.eq.${transferBatch}`))
  await removeRows('batches', query => query.in('name', [batch, batchWithJoinDate, transferBatch]))
}

try {
  const adminLogin = await api('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  })
  const adminToken = adminLogin.payload.token
  assert.ok(adminToken)
  const adminHeaders = { Authorization: `Bearer ${adminToken}` }

  const { error: batchError } = await db.from('batches').insert([
    { name: batch, created_by: 'staging-attendance-e2e', starts_on: batchStart, created_at: new Date().toISOString() },
    { name: batchWithJoinDate, created_by: 'staging-attendance-e2e', starts_on: batchStart, created_at: new Date().toISOString() },
  ])
  assert.ifError(batchError)

  const syntheticPhone = `900${String(Date.now()).slice(-7)}`
  const joinPhone = `901${String(Date.now()).slice(-7)}`
  const rosterCsv = [
    'Student Name,Email,Phone,External Student ID,Join Date',
    `${tag} Student,${tag.toLowerCase()}@example.invalid,${syntheticPhone},${tag}-STUDENT,`,
  ].join('\n')
  const joinRosterCsv = [
    'Student Name,Email,Phone,External Student ID,Join Date',
    `${tag} Join Date,${tag.toLowerCase()}-join@example.invalid,${joinPhone},${tag}-JOIN,${explicitJoinDate}`,
  ].join('\n')

  const makeRosterForm = (selectedBatch, action, csv, filename) => {
    const form = new FormData()
    form.append('batch', selectedBatch)
    form.append('action', action)
    form.append('file', new Blob([csv], { type: 'text/csv' }), filename)
    return form
  }

  const preview = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: makeRosterForm(batch, 'preview', rosterCsv, `${tag}.csv`) })
  assert.equal(preview.payload.summary.new, 1)
  const committed = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: makeRosterForm(batch, 'commit-new', rosterCsv, `${tag}.csv`) })
  assert.equal(committed.payload.summary.created, 1)
  const credential = committed.payload.credentials[0]
  assert.ok(credential.loginId && credential.password)

  const joinCommitted = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: makeRosterForm(batchWithJoinDate, 'commit-new', joinRosterCsv, `${tag}-join.csv`) })
  assert.equal(joinCommitted.payload.summary.created, 1)
  const joinCredential = joinCommitted.payload.credentials[0]
  assert.ok(joinCredential.loginId && joinCredential.password)

  const duplicate = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: makeRosterForm(batch, 'commit-new', rosterCsv, `${tag}.csv`) })
  assert.equal(duplicate.payload.summary.created, 0)
  assert.equal(duplicate.payload.summary.existing, 1)

  const { data: student, error: studentError } = await db.from('students').select('id,name,batch,login_id,password_hash').eq('login_id', credential.loginId).single()
  assert.ifError(studentError)
  studentId = student.id
  assert.ok(student.password_hash && !student.password_hash.includes(credential.password))
  const { data: joinStudent, error: joinStudentError } = await db.from('students').select('id,name,batch,login_id,password_hash').eq('login_id', joinCredential.loginId).single()
  assert.ifError(joinStudentError)
  joinDateStudentId = joinStudent.id
  assert.ok(joinStudent.password_hash && !joinStudent.password_hash.includes(joinCredential.password))

  const { data: memberships, error: membershipsError } = await db.from('student_batch_memberships').select('student_id,batch,starts_on,ends_on,membership_source').in('student_id', [studentId, joinDateStudentId]).order('student_id')
  assert.ifError(membershipsError)
  const initialMembership = memberships.find(row => row.student_id === studentId && row.batch === batch && !row.ends_on)
  const explicitMembership = memberships.find(row => row.student_id === joinDateStudentId && row.batch === batchWithJoinDate && !row.ends_on)
  assert.deepEqual({ starts_on: initialMembership.starts_on, membership_source: initialMembership.membership_source }, { starts_on: batchStart, membership_source: 'batch_start' })
  assert.deepEqual({ starts_on: explicitMembership.starts_on, membership_source: explicitMembership.membership_source }, { starts_on: explicitJoinDate, membership_source: 'explicit_join_date' })

  const curriculum = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: adminHeaders })
  assert.equal(curriculum.response.status, 200)

  const { data: session, error: sessionError } = await db.from('attendance_sessions').insert({
    batch,
    session_date: batchStart,
    title: `${tag} attendance session`,
    source: 'teams_report',
    created_by_role: 'admin',
    created_by_name: 'staging-attendance-e2e',
  }).select('id').single()
  assert.ifError(sessionError)
  sessionId = session.id
  const { data: attendance, error: attendanceError } = await db.from('student_attendance').insert({
    student_id: studentId,
    batch,
    attendance_date: batchStart,
    status: 'approved',
    session_id: sessionId,
    source: 'teams_report',
    reviewed_at: new Date().toISOString(),
    reviewed_by: 'staging-attendance-e2e',
  }).select('id').single()
  assert.ifError(attendanceError)
  attendanceId = attendance.id

  const login = await api('/api/student-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: credential.loginId, password: credential.password }),
  })
  assert.equal(login.payload.success, true)
  const studentToken = login.payload.student.token
  assert.ok(studentToken)
  assert.equal(login.payload.student.batch, batch)

  const health = await api('/api/student-health', { headers: { Authorization: `Bearer ${studentToken}` } })
  assert.match(health.response.headers.get('content-type') || '', /application\/json/i)
  const metrics = health.payload.healthCard?.metrics || {}
  const leaderboard = health.payload.healthCard?.leaderboard || {}
  console.log(`HEALTH_METRIC_KEYS=${Object.keys(metrics).sort().join(',')}`)
  const value = (...keys) => keys.map(key => metrics[key]).find(candidate => candidate !== undefined)
  assert.equal(Number(value('eligibleWorkingDays', 'eligible_working_days')), 1)
  assert.equal(Number(value('approvedAttendanceDays', 'approved_attendance_days')), 1)
  assert.equal(Number(value('attendancePoints', 'attendance_points')), 1)
  assert.equal(Number(value('courseworkPoints', 'currentCourseworkPoints', 'coursework_points')), 0)
  assert.equal(Number(value('totalPoints', 'total_points')), 1)
  assert.equal(metrics.isRanked, false)
  assert.equal(metrics.rank, null)
  assert.equal(leaderboard.isRanked, false)
  assert.equal(leaderboard.current?.isRanked, false)

  const { error: transferBatchError } = await db.from('batches').insert({ name: transferBatch, created_by: 'staging-attendance-e2e', starts_on: batchStart, created_at: new Date().toISOString() })
  assert.ifError(transferBatchError)
  const { data: transferStudent, error: transferStudentError } = await db.from('students').insert({
    name: `${tag} Transfer Student`,
    batch,
    login_id: `${tag.toLowerCase()}-transfer`,
    password_hash: await hashStudentPasswordSecure('Transfer@123#'),
    created_at: '2026-11-05T10:00:00.000Z',
  }).select('id').single()
  assert.ifError(transferStudentError)
  transferStudentId = transferStudent.id
  const { error: transferError } = await db.from('students').update({ batch: transferBatch }).eq('id', transferStudentId)
  assert.ifError(transferError)
  const { data: transferMembership, error: transferMembershipError } = await db.from('student_batch_memberships').select('starts_on,membership_source').eq('student_id', transferStudentId).eq('batch', transferBatch).is('ends_on', null).single()
  assert.ifError(transferMembershipError)
  assert.equal(transferMembership.membership_source, 'transfer')
  assert.equal(transferMembership.starts_on, '2026-11-07')
  const { error: simulatedTransferDateError } = await db.from('student_batch_memberships')
    .update({ starts_on: '2026-11-20', updated_at: new Date().toISOString() })
    .eq('student_id', transferStudentId)
    .eq('batch', transferBatch)
    .is('ends_on', null)
  assert.ifError(simulatedTransferDateError)
  const transferSessionRows = []
  for (const sessionDate of ['2026-11-02', '2026-11-10', '2026-11-20', '2026-11-21']) {
    const { data: transferSession, error: transferSessionError } = await db.from('attendance_sessions').insert({ batch: transferBatch, session_date: sessionDate, title: `${tag} transfer ${sessionDate}`, source: 'teams_report' }).select('id').single()
    assert.ifError(transferSessionError)
    transferSessionRows.push({ id: transferSession.id, sessionDate })
  }
  const { error: transferAttendanceError } = await db.from('student_attendance').insert(transferSessionRows.map(row => ({
    student_id: transferStudentId,
    batch: transferBatch,
    attendance_date: row.sessionDate,
    status: 'approved',
    session_id: row.id,
    source: 'teams_report',
  })))
  assert.ifError(transferAttendanceError)
  const { data: transferHealth, error: transferHealthError } = await db.rpc('cf_health_card_leaderboard', { p_batch: transferBatch, p_as_of_date: '2026-11-21' })
  assert.ifError(transferHealthError)
  const transferScore = (transferHealth || []).find(row => row.student_id === transferStudentId)
  assert.equal(Number(transferScore.eligible_working_days), 2)
  assert.equal(Number(transferScore.approved_attendance_days), 2)
  assert.equal(Number(transferScore.attendance_points), 2)
  console.log('STAGING_TRANSFER_E2E=PASS')

  console.log('STAGING_ATTENDANCE_ELIGIBILITY_E2E=PASS')
} finally {
  await cleanup()
  const [{ count: remainingStudents }, { count: remainingBatches }, { count: remainingSessions }, { count: remainingImports }] = await Promise.all([
    db.from('students').select('id', { count: 'exact', head: true }).or(`name.ilike.%${tag}%,external_student_id.ilike.%${tag}%`),
    db.from('batches').select('id', { count: 'exact', head: true }).in('name', [batch, batchWithJoinDate, transferBatch]),
    db.from('attendance_sessions').select('id', { count: 'exact', head: true }).in('batch', [batch, batchWithJoinDate, transferBatch]),
    db.from('student_roster_imports').select('id', { count: 'exact', head: true }).in('batch', [batch, batchWithJoinDate, transferBatch]),
  ])
  assert.equal(remainingStudents || 0, 0)
  assert.equal(remainingBatches || 0, 0)
  assert.equal(remainingSessions || 0, 0)
  assert.equal(remainingImports || 0, 0)
  assert.equal(cleanupErrors.length, 0, cleanupErrors.join('; '))
  console.log('STAGING_SYNTHETIC_RESIDUE=0')
}
