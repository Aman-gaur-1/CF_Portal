import crypto from 'crypto'
import bcrypt from 'bcryptjs'

export const STUDENT_PROFILE_FIELDS = 'id,name,batch'
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function getSecret() {
  if (process.env.STUDENT_SESSION_SECRET) return process.env.STUDENT_SESSION_SECRET
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY
  if (process.env.NODE_ENV !== 'production') return 'cf-student-dev-secret'
  throw new Error('STUDENT_SESSION_SECRET is required in production')
}

function base64url(input) {
  return Buffer.from(input).toString('base64url')
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function hashStudentPassword(password) {
  return crypto.createHash('sha256').update(String(password || '').trim()).digest('hex')
}

export async function hashStudentPasswordSecure(password) {
  return bcrypt.hash(String(password || '').trim(), 12)
}

export async function verifyStudentPassword(password, storedHash) {
  const hash = String(storedHash || '').trim()
  const text = String(password || '').trim()
  if (!hash || !text) return { ok: false, needsUpgrade: false }
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    return { ok: await bcrypt.compare(text, hash), needsUpgrade: false }
  }
  return { ok: hashStudentPassword(text) === hash, needsUpgrade: true }
}

export function safeStudentProfile(student) {
  if (!student) return null
  return {
    id: student.id,
    name: student.name,
    batch: student.batch,
  }
}

export function createStudentToken(student) {
  const safe = safeStudentProfile(student)
  if (!safe?.id || !safe?.name || !safe?.batch) return ''
  const payload = JSON.stringify({
    id: String(safe.id),
    name: safe.name,
    batch: safe.batch,
    role: 'student',
    exp: Date.now() + TOKEN_TTL_MS,
  })
  const encoded = base64url(payload)
  return `${encoded}.${sign(encoded)}`
}

export function verifyStudentToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [encoded, signature] = token.split('.')
  try {
    if (!encoded || !signature || sign(encoded) !== signature) return null
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (payload.role !== 'student' || !payload.id || !payload.name || !payload.batch || payload.exp < Date.now()) return null
    return { id: String(payload.id), name: payload.name, batch: payload.batch }
  } catch {
    return null
  }
}

export function getStudentFromRequest(request) {
  const header = request.headers.get('authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  return verifyStudentToken(token)
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
  if (result.value.password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  return result
}
