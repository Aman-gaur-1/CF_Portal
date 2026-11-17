import { hashStudentPasswordSecure } from '@/lib/student-auth'
import { generateStudentLoginId } from '@/lib/student-login-id'
import { buildStudentPatternPassword } from '@/lib/student-password-pattern'
import { isUniqueViolation } from '@/lib/student-health-card'
import { loadUsedLoginIds } from '@/lib/roster-import'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function cleanText(value, max = 240) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  return text.slice(0, max)
}

function cleanEmail(value) {
  const email = cleanText(value, 240).toLowerCase()
  return email || null
}

function cleanPhone(value) {
  const phone = cleanText(value, 80)
  return phone || null
}

export function normalizeManualStudentInput(body = {}) {
  return {
    name: cleanText(body.name, 160),
    email: cleanEmail(body.email),
    phone: cleanPhone(body.phone),
    externalStudentId: cleanText(body.externalStudentId || body.external_student_id, 160) || null,
    teamsDisplayName: cleanText(body.teamsDisplayName || body.teams_display_name, 160) || null,
    joinDate: cleanText(body.joinDate || body.join_date, 10) || null,
    batch: cleanText(body.batch, 240),
  }
}

export function validateJoinDate(joinDate, batchStartDate, today = new Date()) {
  if (!joinDate) return null
  if (!DATE_PATTERN.test(joinDate)) throw new Error('Join Date must use YYYY-MM-DD format.')
  const parsed = new Date(`${joinDate}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) throw new Error('Join Date is not valid.')
  if (batchStartDate && DATE_PATTERN.test(String(batchStartDate)) && joinDate < String(batchStartDate)) {
    throw new Error('Join Date cannot be earlier than the batch start date.')
  }
  const todayString = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(today)
  if (joinDate > todayString) throw new Error('Join Date cannot be in the future.')
  return joinDate
}

async function findExistingIdentity(supabase, input) {
  const checks = []
  if (input.externalStudentId) checks.push(supabase.from('students').select('id,name,batch,status,login_id,email,external_student_id').eq('external_student_id', input.externalStudentId).limit(2))
  if (input.email) checks.push(supabase.from('students').select('id,name,batch,status,login_id,email,external_student_id').ilike('email', input.email).limit(2))
  if (input.name && input.batch) checks.push(supabase.from('students').select('id,name,batch,status,login_id,email,external_student_id').eq('batch', input.batch).ilike('name', input.name).limit(2))
  if (!checks.length) return null
  const results = await Promise.all(checks)
  for (const result of results) {
    if (result.error) throw result.error
    if (result.data?.[0]) return result.data[0]
  }
  return null
}

async function ensureMembership({ supabase, student, joinDate, batchStartDate }) {
  const startsOn = joinDate || batchStartDate || new Date().toISOString().slice(0, 10)
  const { data: existing, error: lookupError } = await supabase
    .from('student_batch_memberships')
    .select('id')
    .eq('student_id', student.id)
    .eq('batch', student.batch)
    .is('ends_on', null)
    .limit(1)
    .maybeSingle()
  if (lookupError) throw lookupError

  if (existing) {
    const { error } = await supabase
      .from('student_batch_memberships')
      .update({ starts_on: startsOn, membership_source: joinDate ? 'explicit_join_date' : 'onboarding', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('student_batch_memberships').insert({
    student_id: student.id,
    batch: student.batch,
    starts_on: startsOn,
    membership_source: joinDate ? 'explicit_join_date' : 'onboarding',
  })
  if (error) throw error
}

export async function createStudentAccount({ supabase, input, actorRole, actorName, password, loginIdCandidate = '', rejectDuplicate = true }) {
  const studentInput = normalizeManualStudentInput(input)
  if (!studentInput.name) throw new Error('Student name is required.')
  if (!studentInput.phone) throw new Error('Phone number is required to create the student Login ID.')
  if (!studentInput.batch) throw new Error('Batch is required.')

  const { data: batch, error: batchError } = await supabase.from('batches').select('name,starts_on').eq('name', studentInput.batch).maybeSingle()
  if (batchError) throw batchError
  if (!batch) throw new Error('Select a valid batch.')
  const joinDate = validateJoinDate(studentInput.joinDate, batch.starts_on)

  if (rejectDuplicate) {
    const existing = await findExistingIdentity(supabase, studentInput)
    if (existing) {
      const duplicate = new Error(`Student already exists in ${existing.batch || 'another batch'}${existing.login_id ? ` (${existing.login_id})` : ''}.`)
      duplicate.status = 409
      duplicate.existing = existing
      throw duplicate
    }
  }

  const usedLoginIds = await loadUsedLoginIds(supabase)
  let candidate = loginIdCandidate || generateStudentLoginId(studentInput, usedLoginIds)
  const passwordValue = password || buildStudentPatternPassword(studentInput)
  const passwordHash = await hashStudentPasswordSecure(passwordValue)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: student, error } = await supabase.from('students').insert({
      name: studentInput.name,
      batch: studentInput.batch,
      email: studentInput.email,
      phone: studentInput.phone,
      external_student_id: studentInput.externalStudentId,
      login_id: candidate,
      password_hash: passwordHash,
      must_change_password: false,
      status: 'active',
    }).select('id,name,batch,email,phone,external_student_id,login_id,must_change_password,status,created_at').single()

    if (!error) {
      await ensureMembership({ supabase, student, joinDate, batchStartDate: batch.starts_on })
      return {
        student,
        password: passwordValue,
        loginId: student.login_id,
        batch: batch.name,
        joinDate: joinDate || batch.starts_on || null,
        actorRole,
        actorName,
      }
    }

    if (!isUniqueViolation(error) || !/login|external_student_id|email/i.test(error.message || '')) throw error
    if (/external_student_id|email/i.test(error.message || '')) {
      const existing = await findExistingIdentity(supabase, studentInput)
      const duplicate = new Error(`Student already exists in ${existing?.batch || 'another batch'}${existing?.login_id ? ` (${existing.login_id})` : ''}.`)
      duplicate.status = 409
      duplicate.existing = existing
      throw duplicate
    }
    usedLoginIds.add(candidate.toLowerCase())
    candidate = generateStudentLoginId(studentInput, usedLoginIds)
  }

  throw new Error('Could not allocate a unique Login ID.')
}

