import crypto from 'crypto'
import * as XLSX from 'xlsx'
import { normalizeParticipantName } from './attendance-matching.js'
import { getStudentPatternPasswordInfo, normalizePhoneDigits, STUDENT_PATTERN_PHONE_ERROR } from './student-password-pattern.js'

export const ROSTER_HEADERS = Object.freeze(['Student Name', 'Email', 'Phone', 'External Student ID', 'Teams Display Name'])

export const ROSTER_PHONE_HEADER_ALIASES = Object.freeze([
  'phone',
  'phone number',
  'phone no',
  'mobile',
  'mobile number',
  'mobile no',
  'contact',
  'contact number',
  'contact no',
  'whatsapp number',
  'whatsapp no',
])

const PHONE_HEADER_ALIAS_SET = new Set(ROSTER_PHONE_HEADER_ALIASES)

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function parseRosterBufferWithMetadata(buffer, filename = '') {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('The roster file has no worksheet.')
  const headerRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  const detectedColumns = [...new Set((headerRows[0] || []).map(normalizeHeader).filter(Boolean))]
  const phoneColumnDetected = detectedColumns.some(column => PHONE_HEADER_ALIAS_SET.has(column))
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const rows = rawRows.map((raw, index) => {
    const values = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeHeader(key), String(value ?? '').trim()]))
    const phoneHeader = ROSTER_PHONE_HEADER_ALIASES.find(alias => Object.prototype.hasOwnProperty.call(values, alias))
    return {
      rowNumber: index + 2,
      name: values['student name'] || values.name || '',
      email: values.email || '',
      phone: phoneHeader ? values[phoneHeader] : '',
      externalStudentId: values['external student id'] || values['student id'] || values['external id'] || '',
      teamsDisplayName: values['teams display name'] || values['teams name'] || values['attendance name'] || '',
      source: filename,
    }
  }).filter(row => row.name || row.email || row.phone || row.externalStudentId || row.teamsDisplayName)
  return { rows, detectedColumns, phoneColumnDetected }
}

export function parseRosterBuffer(buffer, filename = '') {
  return parseRosterBufferWithMetadata(buffer, filename).rows
}

function addToIndex(index, key, value) {
  if (!key) return
  index.set(key, [...(index.get(key) || []), value])
}

function uniqueStudents(rows = []) {
  return [...new Map(rows.map(student => [String(student.id), student])).values()]
}

export function classifyRosterRows(rows = [], existing = [], options = {}) {
  const batch = String(options.batch || '').trim()
  const existingNamesInBatch = new Map()
  const existingExternalIds = new Map()
  const existingEmails = new Map()
  const existingAttendanceNames = new Map()
  for (const student of existing) {
    const nameKey = normalizedName(student.name)
    if (nameKey && (!batch || String(student.batch) === batch)) addToIndex(existingNamesInBatch, nameKey, student)
    const attendanceNameKey = normalizeParticipantName(student.name)
    if (attendanceNameKey && (!batch || String(student.batch) === batch)) addToIndex(existingAttendanceNames, attendanceNameKey, student)
    const externalKey = normalizedName(student.external_student_id)
    if (externalKey) addToIndex(existingExternalIds, externalKey, student)
    const emailKey = normalizedName(student.email)
    if (emailKey) addToIndex(existingEmails, emailKey, student)
  }

  const existingAliases = new Map()
  for (const alias of options.aliases || []) {
    if (alias.active === false || (batch && String(alias.batch) !== batch)) continue
    addToIndex(existingAliases, alias.normalized_alias || normalizeParticipantName(alias.alias), alias)
  }

  const aliasCounts = new Map()
  for (const row of rows) {
    const aliasKey = normalizeParticipantName(row.teamsDisplayName)
    if (aliasKey && aliasKey !== normalizeParticipantName(row.name)) aliasCounts.set(aliasKey, (aliasCounts.get(aliasKey) || 0) + 1)
  }

  const seenNames = new Map()
  const seenExternalIds = new Map()
  const seenEmails = new Map()
  const classified = rows.map(row => {
    row = {
      ...row,
      name: String(row.name || '').trim(),
      email: String(row.email || '').trim(),
      phone: String(row.phone || '').trim(),
      externalStudentId: String(row.externalStudentId || '').trim(),
      teamsDisplayName: String(row.teamsDisplayName || '').trim(),
    }
    const nameKey = normalizedName(row.name)
    const externalKey = normalizedName(row.externalStudentId)
    const emailKey = normalizedName(row.email)
    const aliasKey = normalizeParticipantName(row.teamsDisplayName)
    let status = 'new'
    let reason = ''
    let matchedStudent = null
    const strongMatches = uniqueStudents([
      ...(externalKey ? existingExternalIds.get(externalKey) || [] : []),
      ...(emailKey ? existingEmails.get(emailKey) || [] : []),
    ])
    const sameBatchNameMatches = existingNamesInBatch.get(nameKey) || []
    const duplicateImportRow = (externalKey && seenExternalIds.get(externalKey)) || (emailKey && seenEmails.get(emailKey)) || seenNames.get(nameKey)
    if (!nameKey) {
      status = 'invalid'
      reason = 'Student Name is required.'
    } else if (nameKey.length > 120 || row.email.length > 240 || row.phone.length > 80 || row.externalStudentId.length > 160 || row.teamsDisplayName.length > 240) {
      status = 'invalid'
      reason = 'One or more values are too long.'
    } else if (duplicateImportRow) {
      status = 'possible_duplicate'
      reason = `Duplicate of import row ${duplicateImportRow}.`
    } else if (strongMatches.length > 1) {
      status = 'possible_duplicate'
      reason = 'External Student ID and email match different existing students.'
    } else if (strongMatches.length === 1) {
      matchedStudent = strongMatches[0]
      status = String(matchedStudent.batch) === batch ? 'existing' : 'existing_different_batch'
      reason = status === 'existing'
        ? 'Already onboarded in this batch. Existing credentials will not change.'
        : `Existing student is currently assigned to ${matchedStudent.batch || 'another batch'}.`
    } else if (sameBatchNameMatches.length === 1 && !externalKey && !emailKey) {
      status = 'existing'
      matchedStudent = sameBatchNameMatches[0]
      reason = 'Already onboarded in this batch. Existing credentials will not change.'
    } else if (sameBatchNameMatches.length) {
      status = 'possible_duplicate'
      reason = 'A student with this name already exists in this batch; verify email or External Student ID.'
    } else if ([...existingNamesInBatch.keys()].some(existingName => existingName.includes(nameKey) || nameKey.includes(existingName))) {
      status = 'possible_duplicate'
      reason = 'Name is similar to an existing student; review before creating an account.'
    }

    const effectivePhone = row.phone || (matchedStudent?.phone || '')
    const passwordInfo = getStudentPatternPasswordInfo({ name: row.name, phone: effectivePhone })
    const phoneUpdate = Boolean(matchedStudent && row.phone && normalizePhoneDigits(row.phone) !== normalizePhoneDigits(matchedStudent.phone))
    const phoneDigits = normalizePhoneDigits(effectivePhone)
    const phoneStatus = passwordInfo.valid ? 'ready' : phoneDigits ? 'invalid' : 'missing'
    if (status === 'new' && !passwordInfo.valid) {
      status = 'invalid'
      reason = passwordInfo.reason
    } else if (status === 'existing' && !passwordInfo.valid) {
      reason = phoneStatus === 'invalid'
        ? 'Existing student matched, but the uploaded phone number is invalid. Add at least 3 phone digits before applying the password pattern.'
        : 'Existing student matched, but a valid phone number is required before the password pattern can be applied. Add a phone number to apply the ConsoleFlare password pattern.'
    } else if (status === 'existing') {
      reason = phoneUpdate
        ? 'Existing student matched. Ready to update phone and apply the password pattern.'
        : 'Existing student matched. Ready to apply the password pattern.'
    }

    if (status !== 'invalid' && aliasKey && aliasKey !== normalizeParticipantName(row.name)) {
      const conflictingAliases = existingAliases.get(aliasKey) || []
      const conflictingNames = existingAttendanceNames.get(aliasKey) || []
      const matchedId = matchedStudent ? String(matchedStudent.id) : ''
      const aliasBelongsElsewhere = conflictingAliases.some(alias => String(alias.student_id || alias.studentId) !== matchedId)
      const nameBelongsElsewhere = conflictingNames.some(student => String(student.id) !== matchedId)
      if ((aliasCounts.get(aliasKey) || 0) > 1 || aliasBelongsElsewhere || nameBelongsElsewhere) {
        status = 'possible_duplicate'
        reason = 'Teams Display Name is already used by another roster identity and needs review.'
      }
    }

    if (!seenNames.has(nameKey)) seenNames.set(nameKey, row.rowNumber)
    if (externalKey && !seenExternalIds.has(externalKey)) seenExternalIds.set(externalKey, row.rowNumber)
    if (emailKey && !seenEmails.has(emailKey)) seenEmails.set(emailKey, row.rowNumber)
    return {
      ...row,
      status,
      reason,
      matchedStudent,
      phoneUpdate,
      phoneStatus,
      passwordReady: status === 'new' || status === 'existing' ? passwordInfo.valid : false,
      passwordPattern: passwordInfo.valid ? passwordInfo.password : '',
    }
  })

  const passwordGroups = new Map()
  for (const row of classified) {
    if (!row.passwordReady || !row.passwordPattern) continue
    passwordGroups.set(row.passwordPattern, [...(passwordGroups.get(row.passwordPattern) || []), row])
  }
  return classified.map(row => {
    const collisionCount = row.passwordReady && row.passwordPattern ? (passwordGroups.get(row.passwordPattern) || []).length : 0
    return { ...row, passwordCollisionCount: collisionCount }
  })
}

export function createRosterTemplateBuffer() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ROSTER_HEADERS,
  ])
  sheet['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 18 }, { wch: 24 }, { wch: 28 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Student Roster')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

export function generateLegacyLoginId(name, used = new Set()) {
  const base = normalizedName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'student'
  let index = 1
  let candidate = `${base}-${String(index).padStart(2, '0')}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${base}-${String(index).padStart(2, '0')}`
  }
  used.add(candidate)
  return candidate
}

export async function loadUsedLoginIds(supabase) {
  const used = new Set()
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('students')
      .select('login_id')
      .not('login_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error

    for (const row of data || []) {
      const loginId = String(row.login_id || '').trim().toLowerCase()
      if (loginId) used.add(loginId)
    }

    if ((data || []).length < pageSize) break
    offset += pageSize
  }

  return used
}

export function hashRosterFile(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
