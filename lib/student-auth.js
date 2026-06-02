import crypto from 'crypto'

export const STUDENT_PROFILE_FIELDS = 'id,name,batch'

export function hashStudentPassword(password) {
  return crypto.createHash('sha256').update(String(password || '').trim()).digest('hex')
}

export function safeStudentProfile(student) {
  if (!student) return null
  return {
    id: student.id,
    name: student.name,
    batch: student.batch,
  }
}

export function normalizeStudentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function validateStudentCredentialsInput({ name, batch, password }) {
  const normalized = {
    name: normalizeStudentName(name),
    batch: String(batch || '').trim(),
    password: String(password || '').trim(),
  }

  if (!normalized.name || !normalized.batch || !normalized.password) {
    return { error: 'Name, batch, and password are required.' }
  }
  if (normalized.name.length > 120 || normalized.batch.length > 120 || normalized.password.length > 200) {
    return { error: 'Student details are too long.' }
  }
  return { value: normalized }
}

export function validateStudentRegistrationInput(input) {
  const result = validateStudentCredentialsInput(input)
  if (result.error) return result
  if (result.value.password.length < 4) {
    return { error: 'Password must be at least 4 characters.' }
  }
  return result
}
