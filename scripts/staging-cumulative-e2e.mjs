import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'
const batch = 'CUMULATIVE-TEST-20261025'
const tag = 'CUMULATIVE-TEST-20261025'

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

const rosterCsv = `Student Name,Email,Phone,External Student ID\nCumulative Test Student,cumulative-test@example.invalid,,${tag}-STUDENT`
const previewForm = new FormData()
previewForm.append('batch', batch)
previewForm.append('action', 'preview')
previewForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
const previewResponse = await api('/api/admin-roster', { method: 'POST', headers: authHeaders, body: previewForm })
assert.equal(previewResponse.payload.summary.new, 1)
const commitForm = new FormData()
commitForm.append('batch', batch)
commitForm.append('action', 'commit')
commitForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
const commitResponse = await api('/api/admin-roster', { method: 'POST', headers: authHeaders, body: commitForm })
assert.equal(commitResponse.payload.summary.created, 1)
const credential = commitResponse.payload.credentials[0]
assert.ok(credential.loginId && credential.temporaryPassword)
const exportedCredentialsCsv = ['Name,Batch,Login ID,Temporary Password', [credential.name, credential.batch, credential.loginId, credential.temporaryPassword].map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')].join('\n')
assert.match(exportedCredentialsCsv, /Temporary Password/)
const duplicateForm = new FormData()
duplicateForm.append('batch', batch)
duplicateForm.append('action', 'commit')
duplicateForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
const duplicateResponse = await api('/api/admin-roster', { method: 'POST', headers: authHeaders, body: duplicateForm })
assert.equal(duplicateResponse.payload.summary.created, 0)
assert.equal(duplicateResponse.payload.summary.existing, 1)

const { data: student, error: studentError } = await db.from('students').select('id,name,batch,login_id,password_hash').eq('login_id', credential.loginId).single()
assert.ifError(studentError)
assert.equal(student.batch, batch)
assert.ok(student.password_hash && !student.password_hash.includes(credential.temporaryPassword))

const specs = [
  ['assignment', 'Python', 'P1', 10], ['assignment', 'Python', 'P2', 20], ['assignment', 'Python', 'P3', 30],
  ['assignment', 'Data Analytics', 'D1', 10], ['assignment', 'Data Analytics', 'D2', 20],
  ['assignment', 'SQL', 'S1', 10], ['assignment', 'SQL', 'S2', 20], ['assignment', 'SQL', 'S3', 30], ['assignment', 'SQL', 'S4', 40],
  ['project', 'SQL', 'SQL Project 1', 10],
]
for (const [itemType, phase, title, sortOrder] of specs) {
  await api('/api/admin-curriculum', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `${tag} ${title}`, itemType, phase, sortOrder, active: true }) })
}

const curriculum = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: authHeaders })
const testItems = curriculum.payload.items.filter(item => item.title.startsWith(tag))
assert.equal(testItems.length, specs.length)
const item = (phase, itemType, title) => testItems.find(row => row.phase === phase && row.item_type === itemType && row.title === `${tag} ${title}`)
const release = async (phase, itemType, title) => api('/api/admin-curriculum', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-progress', batch, phase, itemType, coveredThroughCourseworkItemId: item(phase, itemType, title).id }) })
await release('Python', 'assignment', 'P3')
await release('Data Analytics', 'assignment', 'D2')
await release('SQL', 'assignment', 'S2')
await release('SQL', 'project', 'SQL Project 1')
const afterRelease = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: authHeaders })
const activeTitles = new Set(afterRelease.payload.activations.filter(row => row.active && row.item?.title?.startsWith(tag)).map(row => row.item.title))
assert.deepEqual([...activeTitles].sort(), [`${tag} D1`, `${tag} D2`, `${tag} P1`, `${tag} P2`, `${tag} P3`, `${tag} S1`, `${tag} S2`, `${tag} SQL Project 1`].sort())
assert.ok(!activeTitles.has(`${tag} S3`) && !activeTitles.has(`${tag} S4`))

const { data: p1, error: p1Error } = await db.from('coursework_items').select('id').eq('title', `${tag} P1`).single()
const { data: p2, error: p2Error } = await db.from('coursework_items').select('id').eq('title', `${tag} P2`).single()
assert.ifError(p1Error); assert.ifError(p2Error)
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

const studentLogin = await api('/api/student-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: credential.loginId, password: credential.temporaryPassword }) })
assert.equal(studentLogin.payload.success, true)
const studentToken = studentLogin.payload.student.token
const cookieHeader = studentLogin.response.headers.get('set-cookie')?.split(';')[0] || ''
assert.ok(cookieHeader)
const session = await api('/api/student-session', { method: 'POST', headers: { Authorization: `Bearer ${studentToken}`, Cookie: cookieHeader } })
assert.equal(session.payload.success, true)
const studentCoursework = await api('/api/student-coursework', { headers: { Authorization: `Bearer ${studentToken}` } })
const visibleTitles = new Set(studentCoursework.payload.coursework.filter(row => row.title.startsWith(tag)).map(row => row.title))
assert.ok(visibleTitles.has(`${tag} P1`) && visibleTitles.has(`${tag} P2`) && visibleTitles.has(`${tag} P3`))
assert.ok(visibleTitles.has(`${tag} D1`) && visibleTitles.has(`${tag} D2`) && visibleTitles.has(`${tag} S1`) && visibleTitles.has(`${tag} S2`) && visibleTitles.has(`${tag} SQL Project 1`))
assert.ok(!visibleTitles.has(`${tag} S3`) && !visibleTitles.has(`${tag} S4`))
assert.equal(studentCoursework.payload.coursework.find(row => row.title === `${tag} P1`).status, 'completed')
assert.equal(studentCoursework.payload.coursework.find(row => row.title === `${tag} P3`).status, 'pending')

const submit = async (courseworkItemId, text) => api('/api/student-submissions', { method: 'POST', headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ coursework_item_id: courseworkItemId, code_text: text, file_name: `${text}.py` }) })
const s1 = item('SQL', 'assignment', 'S1')
const project = item('SQL', 'project', 'SQL Project 1')
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
assert.equal(Number(metrics.assignmentPoints), 5)
assert.equal(Number(metrics.projectPoints), 10)
assert.equal(Number(metrics.courseworkPoints), 15)
assert.equal(Number(metrics.assignmentCompleted), 3)
assert.equal(Number(metrics.assignmentPending), 4)
assert.equal(Number(metrics.projectCompleted), 1)
assert.equal(Number(metrics.projectPending), 0)
const leaderboard = health.payload.healthCard?.leaderboard || health.payload.leaderboard || {}
assert.ok(leaderboard.current)
assert.equal(Number(leaderboard.current.totalPoints), 15)

console.log(JSON.stringify({
  stagingProjectRef: 'bgpmsckjvutnqkryxknb', batch, studentName: student.name,
  loginId: credential.loginId, credentialExport: `${batch}-student-credentials.csv`,
  roster: 'PASS', duplicateImport: 'PASS', cumulativeRelease: 'PASS', historicalReconciliation: 'PASS',
  login: 'PASS', sessionRefresh: 'PASS', studentCoursework: 'PASS', directLinkage: 'PASS',
  scoring: { assignmentPoints: Number(metrics.assignmentPoints), projectPoints: Number(metrics.projectPoints), courseworkPoints: Number(metrics.courseworkPoints), leaderboardPoints: Number(leaderboard.current.totalPoints) },
}, null, 2))
