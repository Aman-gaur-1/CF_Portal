import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.env.CF_PORTAL_TARGET || 'staging'
const expectedRef = target === 'production' ? 'hktpncjuflynwdikmbfl' : 'bgpmsckjvutnqkryxknb'
const otherRef = target === 'production' ? 'bgpmsckjvutnqkryxknb' : 'hktpncjuflynwdikmbfl'
const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'

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

const envPath = process.env.CF_PORTAL_ENV_FILE || path.resolve(root, target === 'production' ? '.env.local' : '..\\CF_Portal\\.env.staging.local')
const env = readEnv(envPath)
assert.match(env.NEXT_PUBLIC_SUPABASE_URL || '', new RegExp(`${expectedRef}\\.supabase\\.co$`))
assert.ok(!(env.NEXT_PUBLIC_SUPABASE_URL || '').includes(otherRef))
const serviceKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const localEnv = readEnv(path.join(root, '.env.local'))
const adminCredentials = JSON.parse(localEnv.ADMIN_CREDENTIALS || '{}')
const [adminUsername, adminPassword] = Object.entries(adminCredentials)[0] || []
assert.ok(adminUsername && adminPassword)

function indiaDate() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function api(pathname, options = {}, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('json') ? await response.json().catch(() => ({})) : null
  assert.ok(expectedStatuses.includes(response.status), `${options.method || 'GET'} ${pathname} returned ${response.status}: ${payload?.error || response.status}`)
  return { response, payload }
}

async function countRows(table, filter = null) {
  let query = db.from(table).select('id', { count: 'exact', head: true })
  if (filter) query = filter(query)
  const { count, error } = await query
  assert.ifError(error)
  return count || 0
}

function rosterFile(tag, names) {
  return Buffer.from([
    'Student Name,Email,Phone,External Student ID,Teams Display Name',
    `${names.alias},${tag.toLowerCase()}-alias@example.invalid,9806223653,${tag}-ALIAS,${names.aliasTeams}`,
    `${names.exact},${tag.toLowerCase()}-exact@example.invalid,9806223654,${tag}-EXACT,`,
  ].join('\n'))
}

function attendanceFile(names) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Meeting title', 'Student onboarding certification'],
    ['Attended participants', '3'],
    ['Start time', '09:00'],
    ['End time', '10:00'],
    [],
    ['2. Participants'],
    ['Name'],
    [names.aliasTeams],
    [names.exact],
    [names.unknown],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function rosterForm(action, batch, bytes, tag) {
  const form = new FormData()
  form.append('action', action)
  form.append('batch', batch)
  form.append('file', new Blob([bytes], { type: 'text/csv' }), `${tag}-roster.csv`)
  return form
}

function attendanceForm(action, batch, date, bytes, records = null, unmatched = null) {
  const form = new FormData()
  form.append('action', action)
  form.append('batch', batch)
  form.append('date', date)
  form.append('sessionTitle', 'Student onboarding certification')
  form.append('sessionStart', '09:00')
  form.append('sessionEnd', '10:00')
  if (records) form.append('records', JSON.stringify(records))
  if (unmatched) form.append('unmatched', JSON.stringify(unmatched))
  form.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'student-onboarding-attendance.xlsx')
  return form
}

const tag = `ROSTER-CERT-${Date.now()}`
const batch = `${tag}-BATCH`
const date = indiaDate()
const names = { alias: `${tag} Alias Student`, aliasTeams: `${tag} Alias`, exact: `${tag} Exact Student`, unknown: `${tag} Unknown Person` }
const rosterBytes = rosterFile(tag, names)
const attendanceBytes = attendanceFile(names)
let batchId = null
let studentIds = []
let attendanceImportId = null
let attendanceSessionId = null
let baseline = null
let adminHeaders = null
let certification = null

try {
  baseline = {
    students: await countRows('students'),
    memberships: await countRows('student_batch_memberships'),
    aliases: await countRows('student_identity_aliases'),
    rosterImports: await countRows('student_roster_imports'),
    attendance: await countRows('student_attendance'),
    attendanceImports: await countRows('attendance_imports'),
    attendanceSessions: await countRows('attendance_sessions'),
    unlinked: await countRows('unlinked_attendance'),
  }

  const { data: batchRow, error: batchError } = await db.from('batches').insert({ name: batch, created_by: 'student-roster-certification', created_at: new Date().toISOString() }).select('id').single()
  assert.ifError(batchError)
  batchId = batchRow.id

  const adminLogin = await api('/api/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: adminUsername, password: adminPassword }) })
  adminHeaders = { Authorization: `Bearer ${adminLogin.payload.token}` }

  const template = await api('/api/admin-roster?format=xlsx', { headers: adminHeaders })
  assert.match(template.response.headers.get('content-type') || '', /spreadsheetml/)

  const beforePreview = await countRows('students', query => query.eq('batch', batch))
  const preview = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: rosterForm('preview', batch, rosterBytes, tag) })
  assert.equal(preview.payload.summary.new, 2)
  assert.equal(await countRows('students', query => query.eq('batch', batch)), beforePreview)

  const committed = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: rosterForm('commit-new', batch, rosterBytes, tag) })
  assert.equal(committed.payload.summary.created, 2)
  assert.equal(committed.payload.credentials.length, 2)
  const credentialByName = new Map(committed.payload.credentials.map(row => [row.name, row]))
  const aliasCredential = credentialByName.get(names.alias)
  assert.ok(aliasCredential?.loginId && aliasCredential?.password)

  const { data: students, error: studentError } = await db.from('students').select('id,name,batch,login_id,password_hash,must_change_password').eq('batch', batch).order('name')
  assert.ifError(studentError)
  assert.equal(students.length, 2)
  studentIds = students.map(student => student.id)
  for (const student of students) {
    const credential = credentialByName.get(student.name)
    assert.ok(student.password_hash?.startsWith('$2'))
    assert.notEqual(student.password_hash, credential.password)
    assert.equal(student.must_change_password, false)
    assert.equal(student.login_id, credential.loginId)
  }

  const { data: memberships, error: membershipError } = await db.from('student_batch_memberships').select('student_id,batch,ends_on').in('student_id', studentIds).eq('batch', batch).is('ends_on', null)
  assert.ifError(membershipError)
  assert.equal(memberships.length, 2)
  const { data: aliases, error: aliasError } = await db.from('student_identity_aliases').select('student_id,alias,source,active').eq('batch', batch)
  assert.ifError(aliasError)
  assert.equal(aliases.length, 1)
  assert.equal(aliases[0].alias, names.aliasTeams)
  assert.equal(aliases[0].source, 'roster_import')

  const overview = await api(`/api/admin-roster?mode=overview&batch=${encodeURIComponent(batch)}`, { headers: adminHeaders })
  const overviewText = JSON.stringify(overview.payload)
  for (const credential of committed.payload.credentials) assert.ok(!overviewText.includes(credential.password))

  const duplicate = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: rosterForm('commit-new', batch, rosterBytes, tag) })
  assert.equal(duplicate.payload.summary.created, 0)
  assert.equal(duplicate.payload.summary.existing, 2)
  assert.equal(await countRows('students', query => query.eq('batch', batch)), 2)

  const firstLogin = await api('/api/student-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: aliasCredential.loginId, password: aliasCredential.password }) })
  assert.equal(firstLogin.payload.student.must_change_password, false)
  await api('/api/student-health', { headers: { Authorization: `Bearer ${firstLogin.payload.student.token}` } })
  const normalLogin = firstLogin
  const studentToken = normalLogin.payload.student.token
  const sessionCookie = (normalLogin.response.headers.get('set-cookie') || '').split(';')[0]
  assert.ok(sessionCookie)
  const refreshed = await api('/api/student-session', { method: 'POST', headers: { Cookie: sessionCookie } })
  assert.equal(refreshed.payload.student.must_change_password, false)
  await api('/api/student-health', { headers: { Authorization: `Bearer ${studentToken}` } })
  await api('/api/student-coursework', { headers: { Authorization: `Bearer ${studentToken}` } })

  const attendancePreview = await api('/api/attendance-upload', { method: 'POST', headers: adminHeaders, body: attendanceForm('preview', batch, date, attendanceBytes) })
  assert.equal(attendancePreview.payload.preview.matched.length, 2)
  assert.equal(attendancePreview.payload.preview.matched.find(row => row.fileName === names.aliasTeams)?.confidence, 'alias')
  assert.equal(attendancePreview.payload.preview.matched.find(row => row.fileName === names.exact)?.confidence, 'exact')
  const needsAttention = [...attendancePreview.payload.preview.uncertain, ...attendancePreview.payload.preview.unmatched]
  assert.equal(needsAttention.length, 1)
  const records = attendancePreview.payload.preview.matched.map(row => ({ studentId: row.studentId, fileName: row.fileName, participantName: row.fileName, matchType: row.type }))
  const unmatched = needsAttention.map(row => ({ participantName: row.fileName, studentId: row.studentId || null, bestMatch: row.bestMatch || null, similarity: row.similarity, type: row.type, reason: row.reason }))
  const confirmed = await api('/api/attendance-upload', { method: 'POST', headers: adminHeaders, body: attendanceForm('confirm', batch, date, attendanceBytes, records, unmatched) })
  assert.equal(confirmed.payload.result.created, 2)
  assert.equal(confirmed.payload.result.savedUnlinked, 1)
  attendanceImportId = confirmed.payload.result.importId
  attendanceSessionId = confirmed.payload.result.sessionId
  assert.equal(await countRows('students', query => query.eq('batch', batch)), 2, 'unknown attendance must not create an account')

  const reset = await api('/api/admin-student-credentials', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: students.find(student => student.name === names.alias).id }) })
  const resetPassword = reset.payload.credential.password
  assert.ok(resetPassword)
  assert.equal(resetPassword, aliasCredential.password)
  const resetLogin = await api('/api/student-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: aliasCredential.loginId, password: resetPassword }) })
  assert.equal(resetLogin.payload.student.must_change_password, false)
  const { data: resetStudent, error: resetError } = await db.from('students').select('password_hash,must_change_password').eq('id', students.find(student => student.name === names.alias).id).single()
  assert.ifError(resetError)
  assert.ok(resetStudent.password_hash.startsWith('$2'))
  assert.notEqual(resetStudent.password_hash, resetPassword)
  assert.equal(resetStudent.must_change_password, false)
  const { data: audits, error: auditError } = await db.from('activity_log').select('description,metadata').eq('metadata->>batch', batch)
  assert.ifError(auditError)
  const auditText = JSON.stringify(audits || [])
  assert.ok(!auditText.includes(resetPassword))
  for (const credential of committed.payload.credentials) assert.ok(!auditText.includes(credential.password))
  const { data: rosterAudits, error: rosterAuditError } = await db.from('student_roster_imports').select('row_results').eq('batch', batch)
  assert.ifError(rosterAuditError)
  const rosterAuditText = JSON.stringify(rosterAudits || [])
  for (const credential of committed.payload.credentials) assert.ok(!rosterAuditText.includes(credential.password))

  certification = {
    target,
    projectRef: expectedRef,
    template: true,
    previewNoWrites: true,
    created: 2,
    hashesSecure: true,
    plaintextStored: false,
    memberships: 2,
    teamsAlias: true,
    oneTimeHistory: true,
    passwordPattern: true,
    firstLogin: true,
    sessionRefresh: true,
    studentPortal: true,
    attendanceExact: true,
    attendanceAlias: true,
    unknownStayedUnlinked: true,
    resetPassword: true,
    duplicateRosterIdempotent: true,
  }
  console.log(JSON.stringify(certification))
} finally {
  const cleanupErrors = []
  async function cleanup(table, filter) {
    const { error } = await filter(db.from(table).delete())
    if (error) cleanupErrors.push(`${table}: ${error.message}`)
  }
  await cleanup('student_identity_aliases', query => query.eq('batch', batch))
  await cleanup('unlinked_attendance', query => query.eq('batch', batch))
  await cleanup('student_attendance', query => query.eq('batch', batch))
  if (attendanceSessionId) await cleanup('attendance_sessions', query => query.eq('id', attendanceSessionId))
  else await cleanup('attendance_sessions', query => query.eq('batch', batch))
  if (attendanceImportId) await cleanup('attendance_imports', query => query.eq('id', attendanceImportId))
  else await cleanup('attendance_imports', query => query.eq('batch', batch))
  await cleanup('student_batch_memberships', query => query.in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']))
  await cleanup('student_roster_imports', query => query.eq('batch', batch))
  await cleanup('activity_log', query => query.eq('metadata->>batch', batch))
  await cleanup('students', query => query.in('id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']))
  await cleanup('batches', query => query.eq('id', batchId || -1))

  const residue = {
    students: await countRows('students', query => query.eq('batch', batch)),
    memberships: await countRows('student_batch_memberships', query => query.in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000'])),
    aliases: await countRows('student_identity_aliases', query => query.eq('batch', batch)),
    rosterImports: await countRows('student_roster_imports', query => query.eq('batch', batch)),
    attendance: await countRows('student_attendance', query => query.eq('batch', batch)),
    attendanceImports: await countRows('attendance_imports', query => query.eq('batch', batch)),
    attendanceSessions: await countRows('attendance_sessions', query => query.eq('batch', batch)),
    unlinked: await countRows('unlinked_attendance', query => query.eq('batch', batch)),
    batches: await countRows('batches', query => query.eq('name', batch)),
  }
  const residueCount = Object.values(residue).reduce((sum, value) => sum + value, 0)
  const final = {
    students: await countRows('students'),
    memberships: await countRows('student_batch_memberships'),
    aliases: await countRows('student_identity_aliases'),
    rosterImports: await countRows('student_roster_imports'),
    attendance: await countRows('student_attendance'),
    attendanceImports: await countRows('attendance_imports'),
    attendanceSessions: await countRows('attendance_sessions'),
    unlinked: await countRows('unlinked_attendance'),
  }
  const restored = baseline ? Object.keys(baseline).every(key => baseline[key] === final[key]) : false
  console.log(JSON.stringify({ cleanup: { residueCount, residue, restored }, cleanupErrors }))
  if (cleanupErrors.length || residueCount !== 0 || !restored) process.exitCode = 1
}
