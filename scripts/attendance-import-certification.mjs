import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'
const target = process.env.CF_PORTAL_TARGET || 'staging'
const expectedRef = target === 'production' ? 'hktpncjuflynwdikmbfl' : 'bgpmsckjvutnqkryxknb'
const expectedHost = `${expectedRef}.supabase.co`
const date = process.env.CF_PORTAL_ATTENDANCE_DATE || '2026-10-31'

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

const envPath = process.env.CF_PORTAL_ENV_FILE || path.resolve(root, '..', 'CF_Portal', '.env.staging.local')
const env = readEnv(envPath)
assert.match(env.NEXT_PUBLIC_SUPABASE_URL || '', new RegExp(`${expectedRef}\\.supabase\\.co$`), `${target} environment must target ${expectedRef}`)
assert.ok(!(env.NEXT_PUBLIC_SUPABASE_URL || '').includes(target === 'production' ? 'bgpmsckjvutnqkryxknb' : 'hktpncjuflynwdikmbfl'), 'environment cross-target guard')
const serviceKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey, 'server-side Supabase key is required')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const localEnv = readEnv(path.join(root, '.env.local'))
const credentials = JSON.parse(localEnv.ADMIN_CREDENTIALS || '{}')
const [adminUsername, adminPassword] = Object.entries(credentials)[0] || []
assert.ok(adminUsername && adminPassword, 'local admin credentials are required')

async function api(pathname, options = {}, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  const payload = await response.json().catch(() => ({}))
  assert.ok(expectedStatuses.includes(response.status), `${options.method || 'GET'} ${pathname} returned ${response.status}: ${payload.error || response.status}`)
  return { response, payload }
}

async function countRows(table, column = 'id', filter = null) {
  let query = db.from(table).select(column, { count: 'exact', head: true })
  if (filter) query = filter(query)
  const { count, error } = await query
  assert.ifError(error)
  return count || 0
}

async function insertOrThrow(table, payload) {
  const { data, error } = await db.from(table).insert(payload).select('*')
  assert.ifError(error)
  return data
}

function teamsFile() {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet([
    { Name: 'Exact Attendance Student' },
    { Name: 'Alias Attendance Student (External)' },
    { Name: 'Unregistered Teams Person' },
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function formFor(action, batch, fileBytes, records = null, unmatched = null) {
  const form = new FormData()
  form.append('action', action)
  form.append('batch', batch)
  form.append('date', date)
  form.append('sessionTitle', 'Attendance UX certification')
  form.append('sessionStart', '09:00')
  form.append('sessionEnd', '10:00')
  if (records) form.append('records', JSON.stringify(records))
  if (unmatched) form.append('unmatched', JSON.stringify(unmatched))
  form.append('file', new Blob([fileBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'attendance-ux-certification.xlsx')
  return form
}

async function healthCard(studentId) {
  const { data, error } = await db.rpc('cf_get_student_health_card', { p_student_id: studentId, p_as_of_date: date })
  assert.ifError(error)
  return data
}

const tag = `ATTENDANCE-UX-CERT-${Date.now()}`
const batch = `${tag}-BATCH`
const names = {
  exact: 'Exact Attendance Student',
  alias: 'Alias Attendance Student',
  unknown: 'Unregistered Teams Person',
  resolve: 'Resolution Attendance Student',
}
let batchId = null
let studentIds = []
let aliasId = null
let importId = null
let sessionId = null
let unlinkedId = null
let baseline = null
let final = null

try {
  baseline = {
    students: await countRows('students'),
    attendance: await countRows('student_attendance'),
    sessions: await countRows('attendance_sessions'),
    imports: await countRows('attendance_imports'),
    unlinked: await countRows('unlinked_attendance'),
  }

  const { data: batchRow, error: batchError } = await db.from('batches').insert({ name: batch, created_by: 'attendance-ux-certification', created_at: new Date().toISOString() }).select('id,name').single()
  assert.ifError(batchError)
  batchId = batchRow.id

  const studentRows = [names.exact, names.alias, names.resolve].map((name, index) => ({
    name,
    batch,
    password_hash: 'SMOKE_UNUSED_NOT_A_PASSWORD',
    login_id: `${tag}-${index + 1}`,
    external_student_id: `${tag}-STUDENT-${index + 1}`,
    status: 'active',
    must_change_password: false,
  }))
  const { data: insertedStudents, error: studentError } = await db.from('students').insert(studentRows).select('id,name,batch')
  assert.ifError(studentError)
  studentIds = insertedStudents.map(row => row.id)
  const { data: existingMemberships, error: membershipLookupError } = await db.from('student_batch_memberships').select('student_id,batch,starts_on').in('student_id', studentIds).eq('batch', batch)
  assert.ifError(membershipLookupError)
  const membershipKeys = new Set((existingMemberships || []).map(row => `${row.student_id}|${row.batch}|${row.starts_on}`))
  const missingMemberships = studentIds
    .map(student_id => ({ student_id, batch, starts_on: date }))
    .filter(row => !membershipKeys.has(`${row.student_id}|${row.batch}|${row.starts_on}`))
  if (missingMemberships.length) {
    const { error: membershipError } = await db.from('student_batch_memberships').insert(missingMemberships)
    assert.ifError(membershipError)
  }
  const { data: aliasRows, error: aliasError } = await db.from('student_identity_aliases').insert({
    student_id: studentIds[1],
    batch,
    alias: 'Alias Attendance Student',
    normalized_alias: 'alias attendance student',
    source: 'manual_resolution',
    created_by_role: 'admin',
    created_by_name: 'attendance-ux-certification',
    active: true,
  }).select('id').single()
  assert.ifError(aliasError)
  aliasId = aliasRows.id

  const login = await api('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  })
  assert.equal(login.payload.success, true)
  const adminHeaders = { Authorization: `Bearer ${login.payload.token}` }
  const fileBytes = teamsFile()

  const beforePreview = {
    attendance: await countRows('student_attendance', 'id', query => query.eq('batch', batch)),
    imports: await countRows('attendance_imports', 'id', query => query.eq('batch', batch)),
    sessions: await countRows('attendance_sessions', 'id', query => query.eq('batch', batch)),
    unlinked: await countRows('unlinked_attendance', 'id', query => query.eq('batch', batch)),
  }
  const preview = await api('/api/attendance-upload', { method: 'POST', headers: adminHeaders, body: formFor('preview', batch, fileBytes) })
  assert.equal(preview.payload.preview.matched.length, 2)
  assert.equal(preview.payload.preview.matched.find(row => row.studentId === studentIds[1])?.confidence, 'alias')
  assert.equal(preview.payload.preview.uncertain.length, 0)
  assert.equal(preview.payload.preview.unmatched.length, 1)
  assert.equal(preview.payload.preview.summary.willCreate, 2)
  assert.equal(preview.payload.preview.summary.noMatch, 1)
  assert.deepEqual({
    attendance: await countRows('student_attendance', 'id', query => query.eq('batch', batch)),
    imports: await countRows('attendance_imports', 'id', query => query.eq('batch', batch)),
    sessions: await countRows('attendance_sessions', 'id', query => query.eq('batch', batch)),
    unlinked: await countRows('unlinked_attendance', 'id', query => query.eq('batch', batch)),
  }, beforePreview)
  const beforeHealth = await healthCard(studentIds[0])

  const matchedRecords = preview.payload.preview.matched.map(row => ({ studentId: row.studentId, fileName: row.fileName, participantName: row.fileName, matchType: row.type }))
  const unmatchedPayload = [{ participantName: 'Unregistered Teams Person', similarity: 0, type: 'unmatched', reason: 'No registered student is a safe match.' }]
  const confirmed = await api('/api/attendance-upload', { method: 'POST', headers: adminHeaders, body: formFor('confirm', batch, fileBytes, matchedRecords, unmatchedPayload) })
  assert.equal(confirmed.payload.result.created, 2)
  assert.equal(confirmed.payload.result.savedUnlinked, 1)
  importId = confirmed.payload.result.importId
  sessionId = confirmed.payload.result.sessionId
  assert.ok(importId && sessionId)

  const { data: attendanceRows, error: attendanceError } = await db.from('student_attendance').select('id,student_id,status,session_id,import_id,source').eq('batch', batch)
  assert.ifError(attendanceError)
  assert.equal(attendanceRows.length, 2)
  assert.ok(attendanceRows.every(row => row.status === 'approved' && row.session_id === sessionId && row.import_id === importId && row.source === 'teams_report'))
  const { data: sessionRows, error: sessionError } = await db.from('attendance_sessions').select('id,import_id,source').eq('batch', batch)
  assert.ifError(sessionError)
  assert.equal(sessionRows.length, 1)
  assert.equal(sessionRows[0].id, sessionId)
  assert.equal(sessionRows[0].import_id, importId)
  const { data: importRows, error: importError } = await db.from('attendance_imports').select('id,original_filename,matched_count,needs_matching_count,already_marked_count,uploaded_by_name').eq('id', importId).single()
  assert.ifError(importError)
  assert.deepEqual({ matched: importRows.matched_count, needs: importRows.needs_matching_count, existing: importRows.already_marked_count }, { matched: 2, needs: 1, existing: 0 })
  const { data: waitingRows, error: waitingError } = await db.from('unlinked_attendance').select('id,status,session_id,import_id,original_participant_name').eq('batch', batch).eq('status', 'waiting')
  assert.ifError(waitingError)
  assert.equal(waitingRows.length, 1)
  unlinkedId = waitingRows[0].id
  assert.equal(waitingRows[0].session_id, sessionId)
  assert.equal(waitingRows[0].import_id, importId)

  const duplicate = await api('/api/attendance-upload', { method: 'POST', headers: adminHeaders, body: formFor('confirm', batch, fileBytes, matchedRecords, unmatchedPayload) }, [409])
  assert.match(duplicate.payload.error || '', /already imported/i)
  assert.equal(await countRows('student_attendance', 'id', query => query.eq('batch', batch)), 2)
  assert.equal(await countRows('attendance_imports', 'id', query => query.eq('batch', batch)), 1)

  const history = await api(`/api/attendance-imports?batch=${encodeURIComponent(batch)}&date=${date}`, { headers: adminHeaders })
  assert.equal(history.payload.imports.length, 1)
  assert.equal(history.payload.imports[0].original_filename, 'attendance-ux-certification.xlsx')
  assert.equal(history.payload.imports[0].matched_count, 2)
  assert.equal(history.payload.imports[0].needs_matching_count, 1)
  const detail = await api(`/api/attendance-imports/${importId}`, { headers: adminHeaders })
  assert.equal(detail.payload.attendance.length, 2)
  assert.equal(detail.payload.unlinked.length, 1)

  const needs = await api(`/api/admin-attendance/unlinked?batch=${encodeURIComponent(batch)}&date=${date}`, { headers: adminHeaders })
  assert.equal(needs.payload.unlinked.length, 1)
  const resolved = await api('/api/admin-attendance/unlinked', {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'link', id: unlinkedId, studentId: studentIds[2], correctedDisplayName: names.resolve, rememberAlias: false }),
  })
  assert.equal(resolved.payload.success, true)
  assert.equal(await countRows('student_attendance', 'id', query => query.eq('batch', batch)), 3)
  const { data: resolvedRows, error: resolvedError } = await db.from('unlinked_attendance').select('status,linked_student_id,session_id,import_id,resolved_by_role,resolved_at').eq('id', unlinkedId).single()
  assert.ifError(resolvedError)
  assert.equal(resolvedRows.status, 'linked')
  assert.equal(resolvedRows.linked_student_id, studentIds[2])
  assert.equal(resolvedRows.session_id, sessionId)
  assert.equal(resolvedRows.import_id, importId)
  assert.equal(resolvedRows.resolved_by_role, 'admin')
  assert.ok(resolvedRows.resolved_at)

  const afterHealth = await healthCard(studentIds[0])
  const beforeMetrics = beforeHealth.metrics || {}
  const afterMetrics = afterHealth.metrics || {}
  assert.equal(Number(afterMetrics.attendancePoints), Number(beforeMetrics.attendancePoints) + 1)
  assert.equal(Number(afterMetrics.courseworkPoints), Number(beforeMetrics.courseworkPoints))
  assert.equal(afterMetrics.isRanked, beforeMetrics.isRanked)

  console.log(JSON.stringify({
    target,
    preview: { exact: true, alias: true, unmatched: true, noWrites: true },
    confirm: { approved: 2, sessionLinked: true, importLinked: true, unmatchedSaved: true },
    duplicateBlocked: true,
    history: true,
    resolution: { createdExactlyOnce: true, unlinkedRetained: true },
    healthCard: { attendancePointIncreased: true, courseworkUnchanged: true, rankUnchanged: true },
    baseline,
  }))
} finally {
  const cleanupErrors = []
  async function cleanup(table, filter) {
    const { error } = await filter(db.from(table).delete())
    if (error) cleanupErrors.push(`${table}: ${error.message}`)
  }
  await cleanup('student_identity_aliases', query => query.in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']))
  await cleanup('unlinked_attendance', query => query.eq('batch', batch))
  await cleanup('student_attendance', query => query.eq('batch', batch))
  await cleanup('attendance_sessions', query => query.eq('batch', batch))
  await cleanup('attendance_imports', query => query.eq('batch', batch))
  await cleanup('student_batch_memberships', query => query.in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']))
  await cleanup('students', query => query.in('id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']))
  await cleanup('batches', query => query.eq('id', batchId || -1))
  final = {
    students: await countRows('students'),
    attendance: await countRows('student_attendance'),
    sessions: await countRows('attendance_sessions'),
    imports: await countRows('attendance_imports'),
    unlinked: await countRows('unlinked_attendance'),
    syntheticStudents: await countRows('students', 'id', query => query.in('id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000'])),
    syntheticAttendance: await countRows('student_attendance', 'id', query => query.eq('batch', batch)),
    syntheticSessions: await countRows('attendance_sessions', 'id', query => query.eq('batch', batch)),
    syntheticImports: await countRows('attendance_imports', 'id', query => query.eq('batch', batch)),
    syntheticUnlinked: await countRows('unlinked_attendance', 'id', query => query.eq('batch', batch)),
  }
  console.log(JSON.stringify({ cleanup: final, cleanupErrors }))
  if (cleanupErrors.length || final.syntheticStudents !== 0 || final.syntheticAttendance !== 0 || final.syntheticSessions !== 0 || final.syntheticImports !== 0 || final.syntheticUnlinked !== 0) process.exitCode = 1
}
