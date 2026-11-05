export const STUDENT_PATTERN_PHONE_ERROR = 'Phone number is required to create the student login password.'

export function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '')
}

export function normalizeStudentFirstName(name) {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ')
  const token = normalized.split(' ')[0] || ''
  if (!/[\p{L}\p{N}]/u.test(token)) return ''
  return token
    .toLowerCase()
    .split(/([-'`])/)
    .map(part => /^[-'`]$/.test(part) || !part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function getStudentPatternPasswordInfo({ name, phone } = {}) {
  const firstName = normalizeStudentFirstName(name)
  if (!firstName) return { valid: false, reason: 'Student first name is required.' }

  const phoneDigits = normalizePhoneDigits(phone)
  if (phoneDigits.length < 3) return { valid: false, reason: STUDENT_PATTERN_PHONE_ERROR, firstName, phoneDigits }

  const lastThree = phoneDigits.slice(-3)
  return {
    valid: true,
    firstName,
    phoneDigits,
    lastThree,
    password: `${firstName}@${lastThree}#`,
  }
}

export function buildStudentPatternPassword({ name, phone } = {}) {
  const info = getStudentPatternPasswordInfo({ name, phone })
  if (!info.valid) throw new Error(info.reason)
  return info.password
}

export function maskStudentPhone(phone) {
  const digits = normalizePhoneDigits(phone)
  if (!digits) return ''
  if (digits.length <= 3) return '*'.repeat(digits.length)
  return `${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`
}
