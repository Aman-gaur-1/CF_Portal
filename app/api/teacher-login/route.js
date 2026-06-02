import { NextResponse } from "next/server"
import { createTeacherToken } from "@/lib/teacher-auth"
import { clearLoginAttempts, consumeLoginAttempt } from "@/lib/login-rate-limit"

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
    const teachers = JSON.parse(process.env.TEACHER_CREDENTIALS || "{}")
    if (teachers[username] && teachers[username] === password) {
      clearLoginAttempts(request, "teacher")
      return NextResponse.json({ success: true, name: username, token: createTeacherToken(username) })
    }
    return NextResponse.json({ success: false }, { status: 401 })
  } catch (e) {
    console.error("[teacher-login] failed", e.message)
    return NextResponse.json({ success: false, error: "Teacher login is unavailable." }, { status: 500 })
  }
}
