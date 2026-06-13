import { NextResponse } from "next/server"
import { createTeacherToken } from "@/lib/teacher-auth"
import { clearLoginAttempts, consumeLoginAttempt } from "@/lib/login-rate-limit"

function parseTeacherCredentials() {
  return JSON.parse(process.env.TEACHER_CREDENTIALS || "{}")
}

function normalizeCredentialText(value) {
  return String(value || "").trim()
}

function credentialEntries(credentials) {
  if (Array.isArray(credentials)) {
    return credentials.map((entry, index) => ({
      index,
      login: entry?.username ?? entry?.name ?? entry?.email ?? entry?.trainer_name,
      name: entry?.name,
      username: entry?.username,
      email: entry?.email,
      trainer_name: entry?.trainer_name,
      password: entry?.password,
    }))
  }

  if (credentials && typeof credentials === "object") {
    return Object.entries(credentials).map(([login, password], index) => ({
      index,
      login,
      name: login,
      password,
    }))
  }

  return []
}

function findTeacherCredential(credentials, username, password) {
  const submittedUsername = normalizeCredentialText(username)
  const submittedPassword = normalizeCredentialText(password)
  if (!submittedUsername || !submittedPassword) return null

  return credentialEntries(credentials).find(entry =>
    normalizeCredentialText(entry.login) === submittedUsername &&
    normalizeCredentialText(entry.password) === submittedPassword
  ) || null
}

export async function POST(request) {
  try {
    const rateLimit = consumeLoginAttempt(request, "teacher")
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many login attempts. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      )
    }

    const { username, password } = await request.json()
    const teachers = parseTeacherCredentials()
    const teacher = findTeacherCredential(teachers, username, password)
    if (teacher) {
      const teacherName = String(teacher.name || teacher.username || teacher.email || teacher.trainer_name || username).trim()
      clearLoginAttempts(request, "teacher")
      return NextResponse.json({ success: true, name: teacherName, token: createTeacherToken(teacherName) })
    }
    return NextResponse.json({ success: false }, { status: 401 })
  } catch (e) {
    console.error("[teacher-login] failed", e.message)
    return NextResponse.json({ success: false, error: "Teacher login is unavailable." }, { status: 500 })
  }
}
