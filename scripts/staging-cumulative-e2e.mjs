import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'
const tag = `CUMULATIVE-E2E-${Date.now()}`
const batch = tag

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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localEnv = readEnv(path.join(root, '.env.local'))
const stagingEnvPath = process.env.CF_PORTAL_STAGING_ENV_FILE || path.resolve(root, '..', 'CF_Portal', '.env.staging.local')
const stagingEnv = readEnv(stagingEnvPath)
assert.match(stagingEnv.NEXT_PUBLIC_SUPABASE_URL || '', /bgpmsckjvutnqkryxknb\.supabase\.co$/)
const serviceKey = stagingEnv.SUPABASE_SERVICE_KEY || stagingEnv.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey, 'staging service key is required by this test harness')
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
const adminLogin = await api('/api/admin-login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: adminUsername, password: adminPassword }),
})
const adminToken = adminLogin.payload.token
assert.ok(adminToken)
const authHeaders = { Authorization: `Bearer ${adminToken}` }

let studentId = null
const cleanupErrors = []
async function cleanupRows(table, configure) {
  let query = db.from(table).delete()
  query = configure(query)
  const { error } = await query
  if (error) cleanupErrors.push(`${table}: ${error.message}`)
}

try {
const { error: batchError } = await db.from('batches').insert({ name: batch, created_by: 'staging-validation', created_at: new Date().toISOString() })
assert.ifError(batchError)

const syntheticPhone = `900${String(Date.now()).slice(-7)}`
const rosterCsv = `Student Name,Email,Phone,External Student ID\n${tag} Student,${tag.toLowerCase()}@example.invalid,${syntheticPhone},${tag}-STUDENT`
const previewForm = new FormData()
previewForm.append('batch', batch)
previewForm.append('action', 'preview')
previewForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
const previewResponse = await api('/api/admin-roster', { method: 'POST', headers: authHeaders, body: previewForm })
assert.equal(previewResponse.payload.summary.new, 1)
const commitForm = new FormData()
commitForm.append('batch', batch)
commitForm.append('action', 'commit-new')
commitForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
const commitResponse = await api('/api/admin-roster', { method: 'POST', headers: authHeaders, body: commitForm })
assert.equal(commitResponse.payload.summary.created, 1)
const credential = commitResponse.payload.credentials[0]
assert.ok(credential.loginId && credential.password)
const exportedCredentialsCsv = ['Name,Batch,Login ID,Password', [credential.name, credential.batch, credential.loginId, credential.password].map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')].join('\n')
assert.match(exportedCredentialsCsv, /Password/)
const duplicateForm = new FormData()
duplicateForm.append('batch', batch)
duplicateForm.append('action', 'commit-new')
duplicateForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
const duplicateResponse = await api('/api/admin-roster', { method: 'POST', headers: authHeaders, body: duplicateForm })
assert.equal(duplicateResponse.payload.summary.created, 0)
assert.equal(duplicateResponse.payload.summary.existing, 1)

const { data: student, error: studentError } = await db.from('students').select('id,name,batch,login_id,password_hash').eq('login_id', credential.loginId).single()
assert.ifError(studentError)
studentId = student.id
assert.equal(student.batch, batch)
assert.ok(student.password_hash && !student.password_hash.includes(credential.password))

const curriculum = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: authHeaders })
const canonicalItems = curriculum.payload.canonicalItems.filter(item => item.catalog_status === 'canonical' && item.active && item.batch == null)
const phaseItems = (phase, itemType) => canonicalItems.filter(item => item.phase === phase && item.item_type === itemType).sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
const pythonAssignments = phaseItems('Python', 'assignment')
const dataAssignments = phaseItems('Data Analytics', 'assignment')
const sqlAssignments = phaseItems('SQL', 'assignment')
const sqlProjects = phaseItems('SQL', 'project')
assert.ok(pythonAssignments.length >= 4 && dataAssignments.length >= 2 && sqlAssignments.length >= 5 && sqlProjects.length >= 1)
const p1 = pythonAssignments[0]
const p2 = pythonAssignments[1]
const p3 = pythonAssignments[2]
const d1 = dataAssignments[0]
const d2 = dataAssignments[1]
const s1 = sqlAssignments[0]
const s2 = sqlAssignments[1]
const s3 = sqlAssignments[2]
const s4 = sqlAssignments[3]
const s5 = sqlAssignments[4]
const project = sqlProjects[0]
const item = (phase, itemType, title) => ({
  Python: { assignment: { P1: p1, P2: p2, P3: p3 } },
  'Data Analytics': { assignment: { D1: d1, D2: d2 } },
  SQL: { assignment: { S1: s1, S2: s2, S3: s3, S4: s4 }, project: { 'SQL Project 1': project } },
}[phase][itemType][title])
const release = async (phase, itemType, title) => api('/api/admin-curriculum', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-progress', batch, phase, itemType, coveredThroughCourseworkItemId: item(phase, itemType, title).id }) })
await release('Python', 'assignment', 'P3')
await release('Data Analytics', 'assignment', 'D2')
await release('SQL', 'assignment', 'S2')
await release('SQL', 'project', 'SQL Project 1')
const afterRelease = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: authHeaders })
const activeIds = new Set(afterRelease.payload.activations.filter(row => row.active).map(row => row.coursework_item_id))
assert.deepEqual([...activeIds].sort(), [p1.id, p2.id, p3.id, d1.id, d2.id, s1.id, s2.id, project.id].sort())
assert.ok(!activeIds.has(s3.id) && !activeIds.has(s4.id) && !activeIds.has(s5.id))

const historicalRows = [p1, p2].map((row, index) => ({
  student_id: student.id, student_name: student.name, batch, topic: `${tag} P${index + 1}`,
  submission_type: 'assignment', phase: 'Python', submitted_at: `2026-09-${15 + index}T10:00:00+05:30`,
  workflow_status: 'submitted', ai_workflow_state: 'pending', phase_detection_warning: false,
}))
const { data: insertedHistorical, error: historyError } = await db.from('submissions').insert(historicalRows).select('id,topic')
assert.ifError(historyError)
const { error: reconciliationError } = await db.from('student_coursework_reconciliations').insert([
  { student_id: student.id, batch, coursework_item_id: p1.id, source_submission_id: String(insertedHistorical[0].id), source_topic: `${tag} P1`, phase: 'Python', item_type: 'assignment', confidence: 'high_confidence', status: 'confirmed', counts_for_progress: true, counts_for_points: false, confirmed_by: 'staging-validation', confirmed_at: new Date().toISOString() },
  { student_id: student.id, batch, coursework_item_id: p2.id, source_submission_id: String(insertedHistorical[1].id), source_topic: `${tag} P2`, phase: 'Python', item_type: 'assignment', confidence: 'high_confidence', status: 'confirmed', counts_for_progress: true, counts_for_points: false, confirmed_by: 'staging-validation', confirmed_at: new Date().toISOString() },
])
assert.ifError(reconciliationError)

const studentLogin = await api('/api/student-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: credential.loginId, password: credential.password }) })
assert.equal(studentLogin.payload.success, true)
const studentToken = studentLogin.payload.student.token
const cookieHeader = studentLogin.response.headers.get('set-cookie')?.split(';')[0] || ''
assert.ok(cookieHeader)
const session = await api('/api/student-session', { method: 'POST', headers: { Authorization: `Bearer ${studentToken}`, Cookie: cookieHeader } })
assert.equal(session.payload.success, true)
const studentCoursework = await api('/api/student-coursework', { headers: { Authorization: `Bearer ${studentToken}` } })
const visibleIds = new Set(studentCoursework.payload.coursework.map(row => row.id))
assert.deepEqual([...visibleIds].sort(), [p1.id, p2.id, p3.id, d1.id, d2.id, s1.id, s2.id, project.id].sort())
assert.ok(!visibleIds.has(s3.id) && !visibleIds.has(s4.id) && !visibleIds.has(s5.id))
assert.equal(studentCoursework.payload.coursework.find(row => row.id === p1.id).status, 'completed')
assert.equal(studentCoursework.payload.coursework.find(row => row.id === p3.id).status, 'pending')

const submit = async (courseworkItemId, text) => api('/api/student-submissions', { method: 'POST', headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ coursework_item_id: courseworkItemId, code_text: text, file_name: `${text}.py` }) })
const firstSubmission = await submit(s1.id, 'select 1;')
const secondSubmission = await submit(s1.id, 'select 1; -- resubmission')
const projectSubmission = await submit(project.id, 'select count(*) from sales;')
assert.ok(firstSubmission.payload.submission?.id && secondSubmission.payload.submission?.id && projectSubmission.payload.submission?.id)
const { data: linkedRows, error: linkedError } = await db.from('submissions').select('coursework_item_id').eq('student_id', student.id).in('coursework_item_id', [s1.id, project.id])
assert.ifError(linkedError)
assert.equal(linkedRows.filter(row => row.coursework_item_id === s1.id).length, 2)
assert.equal(linkedRows.filter(row => row.coursework_item_id === project.id).length, 1)

const health = await api('/api/student-health', { headers: { Authorization: `Bearer ${studentToken}` } })
const metrics = health.payload.healthCard?.metrics || health.payload.metrics || {}
assert.equal(Number(metrics.assignmentPoints), 15)
assert.equal(Number(metrics.projectPoints), 10)
assert.equal(Number(metrics.courseworkPoints), 25)
assert.equal(Number(metrics.assignmentCompleted), 3)
assert.equal(Number(metrics.assignmentPending), 4)
assert.equal(Number(metrics.projectCompleted), 1)
assert.equal(Number(metrics.projectPending), 0)
const leaderboard = health.payload.healthCard?.leaderboard || health.payload.leaderboard || {}
assert.ok(leaderboard.current)
assert.equal(Number(leaderboard.current.totalPoints), 25)

console.log(JSON.stringify({
  stagingProjectRef: 'bgpmsckjvutnqkryxknb', batch, studentName: student.name,
  credentialExport: `${batch}-student-credentials.csv`,
  roster: 'PASS', duplicateImport: 'PASS', cumulativeRelease: 'PASS', historicalReconciliation: 'PASS',
  login: 'PASS', sessionRefresh: 'PASS', studentCoursework: 'PASS', directLinkage: 'PASS',
  scoring: { assignmentPoints: Number(metrics.assignmentPoints), projectPoints: Number(metrics.projectPoints), courseworkPoints: Number(metrics.courseworkPoints), leaderboardPoints: Number(leaderboard.current.totalPoints) },
}, null, 2))
} finally {
  await cleanupRows('student_coursework_reconciliations', query => query.eq('batch', batch))
  await cleanupRows('submissions', query => query.eq('batch', batch))
  await cleanupRows('student_batch_memberships', query => query.eq('batch', batch))
  await cleanupRows('students', query => query.eq('batch', batch))
  await cleanupRows('batch_coursework_assignments', query => query.eq('batch', batch))
  await cleanupRows('student_roster_imports', query => query.eq('batch', batch))
  await cleanupRows('batch_curriculum_progress', query => query.eq('batch', batch))
  const { data: createdItems, error: itemLookupError } = await db.from('coursework_items').select('id').like('title', `${tag}%`)
  if (itemLookupError) cleanupErrors.push(`coursework_items lookup: ${itemLookupError.message}`)
  const itemIds = (createdItems || []).map(row => row.id)
  if (itemIds.length) await cleanupRows('coursework_items', query => query.in('id', itemIds))
  await cleanupRows('batches', query => query.eq('name', batch))
  if (cleanupErrors.length) throw new Error(`staging cumulative cleanup failed: ${cleanupErrors.join('; ')}`)
}
