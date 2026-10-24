import crypto from 'crypto'
import * as XLSX from 'xlsx'

export const ROSTER_HEADERS = Object.freeze(['Student Name', 'Email', 'Phone', 'External Student ID'])

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function parseRosterBuffer(buffer, filename = '') {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('The roster file has no worksheet.')
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const rows = rawRows.map((raw, index) => {
    const values = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeHeader(key), String(value ?? '').trim()]))
    return {
      rowNumber: index + 2,
      name: values['student name'] || values.name || '',
      email: values.email || '',
      phone: values.phone || values['phone number'] || '',
      externalStudentId: values['external student id'] || values['student id'] || values['external id'] || '',
      source: filename,
    }
  }).filter(row => row.name || row.email || row.phone || row.externalStudentId)
  return rows
}

export function classifyRosterRows(rows = [], existing = []) {
  const existingNames = new Map()
  const existingExternalIds = new Map()
  const existingEmails = new Map()
  for (const student of existing) {
    const nameKey = normalizedName(student.name)
    if (nameKey) existingNames.set(nameKey, student)
    const externalKey = normalizedName(student.external_student_id)
    if (externalKey) existingExternalIds.set(externalKey, student)
    const emailKey = normalizedName(student.email)
    if (emailKey) existingEmails.set(emailKey, student)
  }

  const seenNames = new Map()
  return rows.map(row => {
    const nameKey = normalizedName(row.name)
    const externalKey = normalizedName(row.externalStudentId)
    const emailKey = normalizedName(row.email)
    let status = 'new'
    let reason = ''
    let matchedStudent = null
    if (!nameKey) {
      status = 'invalid'
      reason = 'Student Name is required.'
    } else if (nameKey.length > 120 || row.email.length > 240 || row.phone.length > 80 || row.externalStudentId.length > 160) {
      status = 'invalid'
      reason = 'One or more values are too long.'
    } else if (seenNames.has(nameKey)) {
      status = 'possible_duplicate'
      reason = `Duplicate of import row ${seenNames.get(nameKey)}.`
    } else if (existingExternalIds.has(externalKey) || existingEmails.has(emailKey) || existingNames.has(nameKey)) {
      status = 'existing'
      matchedStudent = existingExternalIds.get(externalKey) || existingEmails.get(emailKey) || existingNames.get(nameKey)
      reason = 'A matching student already exists in this batch.'
    } else if ([...existingNames.keys()].some(existingName => existingName.includes(nameKey) || nameKey.includes(existingName))) {
      status = 'possible_duplicate'
      reason = 'Name is similar to an existing student; review before importing.'
    }
    if (status === 'new') seenNames.set(nameKey, row.rowNumber)
    return { ...row, status, reason, matchedStudent }
  })
}

export function generateLoginId(name, used = new Set()) {
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

export function generateTemporaryPassword() {
  return `CF-${crypto.randomBytes(9).toString('base64url')}`
}

export function hashRosterFile(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
