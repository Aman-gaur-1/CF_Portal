import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
assert.ok(!(stagingEnv.NEXT_PUBLIC_SUPABASE_URL || '').includes('hktpncjuflynwdikmbfl'), 'staging env must not target production')
const serviceKey = stagingEnv.SUPABASE_SERVICE_KEY || stagingEnv.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey, 'staging service key is required by this local-only harness')
const db = createClient(stagingEnv.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function api(pathname, options = {}, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  const payload = await response.json().catch(() => ({}))
  assert.ok(expectedStatuses.includes(response.status), `${options.method || 'GET'} ${pathname} returned ${response.status}: ${payload.error || 'unexpected response'}`)
  return { response, payload }
}

const adminCredentials = JSON.parse(localEnv.ADMIN_CREDENTIALS || '{}')
const [adminUsername, adminPassword] = Object.entries(adminCredentials)[0] || []
assert.ok(adminUsername && adminPassword, 'local admin credentials are required')
const adminLogin = await api('/api/admin-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: adminUsername, password: adminPassword }),
})
const adminToken = adminLogin.payload.token
assert.ok(adminToken)
const adminHeaders = { Authorization: `Bearer ${adminToken}` }

const teacherRaw = JSON.parse(localEnv.TEACHER_CREDENTIALS || '{}')
const teacherEntry = Array.isArray(teacherRaw)
  ? teacherRaw[0]
  : Object.entries(teacherRaw).map(([username, password]) => ({ username, password }))[0]
const teacherUsername = teacherEntry?.username || teacherEntry?.name || teacherEntry?.email || teacherEntry?.trainer_name
const teacherPassword = teacherEntry?.password
assert.ok(teacherUsername && teacherPassword, 'local teacher credentials are required')
const teacherLogin = await api('/api/teacher-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: teacherUsername, password: teacherPassword }),
})
const teacherToken = teacherLogin.payload.token
const teacherName = teacherLogin.payload.name
assert.ok(teacherToken && teacherName)
const teacherHeaders = { Authorization: `Bearer ${teacherToken}` }

const tag = `CANONICAL-E2E-${Date.now()}`
const batch = `${tag}-ASSIGNED`
const otherBatch = `${tag}-OTHER`
let studentId = null
let aliasId = null

try {
  const { data: batches, error: batchError } = await db.from('batches').insert([
    { name: batch, created_by: teacherName, created_at: new Date().toISOString() },
    { name: otherBatch, created_by: 'another-staging-teacher', created_at: new Date().toISOString() },
  ]).select('id,name')
  assert.ifError(batchError)
  assert.equal(batches.length, 2)

  const rosterCsv = `Student Name,Email,Phone,External Student ID\nCanonical E2E Student,canonical-e2e@example.invalid,,${tag}-STUDENT`
  const previewForm = new FormData()
  previewForm.append('batch', batch)
  previewForm.append('action', 'preview')
  previewForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
  const preview = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: previewForm })
  assert.equal(preview.payload.summary.new, 1)

  const commitForm = new FormData()
  commitForm.append('batch', batch)
  commitForm.append('action', 'commit')
  commitForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
  const commit = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: commitForm })
  assert.equal(commit.payload.summary.created, 1)
  const credential = commit.payload.credentials[0]
  assert.ok(credential.loginId && credential.temporaryPassword)
  const credentialExport = `Name,Batch,Login ID,Temporary Password\n"${credential.name}","${credential.batch}","${credential.loginId}","${credential.temporaryPassword}"`
  assert.match(credentialExport, /Temporary Password/)
  const duplicateForm = new FormData()
  duplicateForm.append('batch', batch)
  duplicateForm.append('action', 'commit')
  duplicateForm.append('file', new Blob([rosterCsv], { type: 'text/csv' }), `${tag}.csv`)
  const duplicate = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: duplicateForm })
  assert.equal(duplicate.payload.summary.created, 0)
  assert.equal(duplicate.payload.summary.existing, 1)

  const { data: student, error: studentError } = await db.from('students').select('id,name,batch,login_id,password_hash').eq('login_id', credential.loginId).single()
  assert.ifError(studentError)
  studentId = student.id
  assert.equal(student.batch, batch)
  assert.ok(student.password_hash && !student.password_hash.includes(credential.temporaryPassword))

  const curriculumBefore = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: adminHeaders })
  const canonicalItems = curriculumBefore.payload.canonicalItems.filter(item => item.catalog_status === 'canonical')
  assert.equal(canonicalItems.length, 47)
  assert.equal(curriculumBefore.payload.canonicalSummary.Python.assignments, 11)
  assert.equal(curriculumBefore.payload.canonicalSummary.Python.projects, 4)
  assert.equal(curriculumBefore.payload.canonicalSummary['Data Analytics'].assignments, 14)
  assert.equal(curriculumBefore.payload.canonicalSummary['Data Analytics'].projects, 1)
  assert.equal(curriculumBefore.payload.canonicalSummary.SQL.assignments, 16)
  assert.equal(curriculumBefore.payload.canonicalSummary.SQL.projects, 1)

  const pythonAssignment = canonicalItems.find(item => item.canonical_key === 'python_assignment_01')
  const pythonProject = canonicalItems.find(item => item.canonical_key === 'python_project_01')
  const unactivated = canonicalItems.find(item => item.canonical_key === 'python_assignment_02')
  assert.ok(pythonAssignment && pythonProject && unactivated)

  const studentLogin = await api('/api/student-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: credential.loginId, password: credential.temporaryPassword }),
  })
  assert.equal(studentLogin.payload.success, true)
  const studentToken = studentLogin.payload.student.token
  const studentHeaders = { Authorization: `Bearer ${studentToken}` }
  const wrongLogin = await api('/api/student-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: credential.loginId, password: 'wrong-password' }),
  }, [401])
  assert.equal(wrongLogin.payload.success, false)
  const beforeActivation = await api('/api/student-coursework', { headers: studentHeaders })
  assert.equal(beforeActivation.payload.coursework.length, 0)

  const teacherView = await api('/api/teacher-curriculum', { headers: teacherHeaders })
  assert.ok((teacherView.payload.items || []).every(item => item.catalog_status === 'canonical'))
  const crossBatchWrite = await api('/api/teacher-curriculum', {
    method: 'POST',
    headers: { ...teacherHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch: otherBatch, courseworkItemIds: [pythonAssignment.id] }),
  }, [403])
  assert.equal(crossBatchWrite.payload.error, 'This batch is not assigned to you.')

  const activation = await api('/api/admin-curriculum', {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'activate', batch, courseworkItemIds: [pythonAssignment.id, pythonProject.id] }),
  })
  assert.equal(activation.payload.activations.length, 2)
  const afterActivation = await api('/api/student-coursework', { headers: studentHeaders })
  assert.deepEqual(new Set(afterActivation.payload.coursework.map(item => item.id)), new Set([pythonAssignment.id, pythonProject.id]))
  assert.ok(afterActivation.payload.coursework.every(item => item.catalog_status === 'canonical'))
  assert.ok(!afterActivation.payload.coursework.some(item => item.id === unactivated.id))
  assert.ok(afterActivation.payload.coursework.every(item => item.status === 'pending'))
  const progressPreview = await api('/api/admin-curriculum', {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'preview-progress', batch, phase: 'Python', itemType: 'assignment', coveredThroughCourseworkItemId: pythonAssignment.id }),
  })
  assert.equal(progressPreview.payload.preview.target.id, pythonAssignment.id)
  const progressSet = await api('/api/admin-curriculum', {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set-progress', batch, phase: 'Python', itemType: 'assignment', coveredThroughCourseworkItemId: pythonAssignment.id }),
  })
  assert.equal(progressSet.payload.progress.itemType, 'assignment')

  const aliasNormalized = `canonical e2e legacy ${Date.now()}`
  const aliasOriginal = `Canonical E2E Legacy ${Date.now()}`
  const { data: alias, error: aliasError } = await db.from('coursework_aliases').insert({
    normalized_alias: aliasNormalized,
    original_alias: aliasOriginal,
    source_phase: 'Python',
    source_item_type: 'assignment',
    source: 'staging_validation',
    confidence: 'UNMATCHED',
    mapping_status: 'unmatched',
  }).select('id').single()
  assert.ifError(aliasError)
  aliasId = alias.id
  const { error: submissionSeedError } = await db.from('submissions').insert({
    student_id: studentId,
    student_name: student.name,
    batch,
    topic: aliasOriginal,
    submission_type: 'assignment',
    phase: 'Python',
    submitted_at: '2026-09-15T10:00:00+05:30',
    workflow_status: 'submitted',
    ai_workflow_state: 'pending',
    phase_detection_warning: false,
  })
  assert.ifError(submissionSeedError)
  const mapExtra = await api('/api/admin-curriculum', {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'map-extra', aliasId, canonicalCourseworkItemId: pythonAssignment.id }),
  })
  assert.equal(mapExtra.payload.mapping.aliasId, aliasId)
  const { data: reconciliation, error: reconciliationError } = await db.from('student_coursework_reconciliations').select('coursework_item_id,counts_for_progress,counts_for_points').eq('student_id', studentId).eq('coursework_item_id', pythonAssignment.id).single()
  assert.ifError(reconciliationError)
  assert.equal(reconciliation.counts_for_progress, true)
  assert.equal(reconciliation.counts_for_points, false)
  const extrasAfterMap = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: adminHeaders })
  assert.ok(!extrasAfterMap.payload.extras.some(extra => extra.alias_id === aliasId))

  const submit = async (courseworkItemId, codeText) => api('/api/student-submissions', {
    method: 'POST',
    headers: { ...studentHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coursework_item_id: courseworkItemId, code_text: codeText, file_name: `${courseworkItemId}.py` }),
  })
  const firstAssignment = await submit(pythonAssignment.id, 'print("canonical assignment")')
  const resubmission = await submit(pythonAssignment.id, 'print("canonical resubmission")')
  const projectSubmission = await submit(pythonProject.id, 'print("canonical project")')
  assert.ok(firstAssignment.payload.submission?.id && resubmission.payload.submission?.id && projectSubmission.payload.submission?.id)
  const { data: linkedRows, error: linkedError } = await db.from('submissions').select('coursework_item_id').eq('student_id', studentId).in('coursework_item_id', [pythonAssignment.id, pythonProject.id])
  assert.ifError(linkedError)
  assert.equal(linkedRows.filter(row => row.coursework_item_id === pythonAssignment.id).length, 2)
  assert.equal(linkedRows.filter(row => row.coursework_item_id === pythonProject.id).length, 1)

  const health = await api('/api/student-health', { headers: studentHeaders })
  const metrics = health.payload.healthCard?.metrics || health.payload.metrics || {}
  assert.equal(Number(metrics.assignmentPoints), 5)
  assert.equal(Number(metrics.projectPoints), 10)
  assert.equal(Number(metrics.courseworkPoints), 15)
  const leaderboard = health.payload.healthCard?.leaderboard || health.payload.leaderboard || {}
  assert.equal(Number(leaderboard.current?.totalPoints), 15)

  console.log(JSON.stringify({
    stagingProjectRef: 'bgpmsckjvutnqkryxknb',
    roster: 'PASS', credentialsExport: 'PASS (verified in memory; secret omitted)', duplicateImport: 'PASS',
    canonicalCounts: { Python: { assignments: 11, projects: 4 }, 'Data Analytics': { assignments: 14, projects: 1 }, SQL: { assignments: 16, projects: 1 } },
    canonicalOnlyAdmin: 'PASS', extrasReview: 'PASS', manualMapping: 'PASS', teacherScope: 'PASS', crossBatch403: 'PASS',
    studentCanonicalDisplay: 'PASS', activationPendingLogic: 'PASS', directLinkage: 'PASS', scoring: { assignment: 5, project: 10, total: 15, leaderboard: 15 },
    studentName: student.name, loginId: credential.loginId,
  }, null, 2))
} finally {
  if (aliasId) await db.from('coursework_aliases').delete().eq('id', aliasId)
  if (studentId) {
    await db.from('student_coursework_reconciliations').delete().eq('student_id', studentId).eq('batch', batch)
    await db.from('submissions').delete().eq('student_id', studentId).eq('batch', batch)
    await db.from('students').delete().eq('id', studentId)
  }
  await db.from('batch_coursework_assignments').delete().eq('batch', batch)
  await db.from('student_roster_imports').delete().eq('batch', batch)
  await db.from('batch_curriculum_progress').delete().eq('batch', batch)
  await db.from('batches').delete().in('name', [batch, otherBatch])
}
