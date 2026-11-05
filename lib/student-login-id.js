import { normalizePhoneDigits, normalizeStudentFirstName } from './student-password-pattern.js'

export const STUDENT_LOGIN_ID_PHONE_ERROR = 'Phone number is required to create the student Login ID.'

function normalizeLoginFirstName(name) {
  const firstName = normalizeStudentFirstName(name)
  return firstName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function getStudentLoginIdInfo({ name, phone } = {}) {
  const firstName = normalizeLoginFirstName(name)
  if (!firstName) return { valid: false, reason: 'Student first name must contain Login ID-safe characters.' }

  const phoneDigits = normalizePhoneDigits(phone)
  if (phoneDigits.length < 2) {
    return { valid: false, reason: STUDENT_LOGIN_ID_PHONE_ERROR, firstName, phoneDigits }
  }

  const lastTwo = phoneDigits.slice(-2)
  return {
    valid: true,
    firstName,
    phoneDigits,
    lastTwo,
    base: `${firstName}${lastTwo}`,
  }
}

export function buildStudentLoginIdBase({ name, phone } = {}) {
  const info = getStudentLoginIdInfo({ name, phone })
  if (!info.valid) throw new Error(info.reason)
  return info.base
}

export function generateStudentLoginId({ name, phone } = {}, used = new Set()) {
  const info = getStudentLoginIdInfo({ name, phone })
  if (!info.valid) throw new Error(info.reason)

  let candidate = info.base
  let suffix = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${info.base}-${suffix}`
    suffix += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}
