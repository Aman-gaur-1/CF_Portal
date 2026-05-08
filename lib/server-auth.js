import crypto from "node:crypto"

export const TEACHER_COOKIE = "cf_teacher_session"
export const STUDENT_COOKIE = "cf_student_session"

const DAY = 24 * 60 * 60
const TEACHER_MAX_AGE = 7 * DAY
const STUDENT_MAX_AGE = 30 * DAY

function secret() {
  return (
    process.env.AUTH_SECRET ||
    process.env.TEACHER_SESSION_SECRET ||
    process.env.TEACHER_CREDENTIALS ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "dev-only-change-me"
  )
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function decode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url")
}

export function createSessionToken(payload, maxAgeSeconds) {
  const body = encode({ ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds })
  return `${body}.${sign(body)}`
}

export function readSessionToken(token) {
  if (!token || !token.includes(".")) return null
  const [body, sig] = token.split(".")
  const expected = sign(body)
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  const payload = decode(body)
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

export function setTeacherCookie(cookieStore, teacherName) {
  cookieStore.set(TEACHER_COOKIE, createSessionToken({ type: "teacher", name: teacherName }, TEACHER_MAX_AGE), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TEACHER_MAX_AGE,
  })
}

export function setStudentCookie(cookieStore, student) {
  cookieStore.set(
    STUDENT_COOKIE,
    createSessionToken({ type: "student", id: student.id, name: student.name, batch: student.batch }, STUDENT_MAX_AGE),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STUDENT_MAX_AGE,
    }
  )
}

export function clearTeacherCookie(cookieStore) {
  cookieStore.set(TEACHER_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 })
}

export function clearStudentCookie(cookieStore) {
  cookieStore.set(STUDENT_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 })
}

export function readTeacher(cookieStore) {
  const payload = readSessionToken(cookieStore.get(TEACHER_COOKIE)?.value)
  return payload?.type === "teacher" ? payload : null
}

export function readStudent(cookieStore) {
  const payload = readSessionToken(cookieStore.get(STUDENT_COOKIE)?.value)
  return payload?.type === "student" ? payload : null
}

export function sha256Password(password) {
  return crypto.createHash("sha256").update(password.trim()).digest("hex")
}

export function createPasswordHash(password) {
  const iterations = 120000
  const salt = crypto.randomBytes(16).toString("base64url")
  const hash = crypto.pbkdf2Sync(password.trim(), salt, iterations, 32, "sha256").toString("base64url")
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`
}

export function verifyPassword(password, storedHash) {
  if (!storedHash) return false
  if (!storedHash.startsWith("pbkdf2_sha256$")) {
    return sha256Password(password) === storedHash
  }
  const [, iterationsRaw, salt, expected] = storedHash.split("$")
  const iterations = Number(iterationsRaw)
  if (!iterations || !salt || !expected) return false
  const actual = crypto.pbkdf2Sync(password.trim(), salt, iterations, 32, "sha256").toString("base64url")
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export function publicStudent(row) {
  if (!row) return null
  return { id: row.id, name: row.name, batch: row.batch, created_at: row.created_at }
}
