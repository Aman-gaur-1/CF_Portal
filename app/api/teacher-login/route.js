import { NextResponse } from "next/server"
import { cookies, headers } from "next/headers"
import { setTeacherCookie } from "@/lib/server-auth"

const attempts = new Map()

function recentAttempts(key) {
  const now = Date.now()
  const windowMs = 10 * 60 * 1000
  const current = attempts.get(key) || []
  const recent = current.filter(t => now - t < windowMs)
  attempts.set(key, recent)
  return recent
}

function recordFailedAttempt(key) {
  const now = Date.now()
  const recent = recentAttempts(key)
  recent.push(now)
  attempts.set(key, recent)
}

export async function POST(request) {
  try {
    const { username, password } = await request.json()
    const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const attemptKey = `${ip}:${username || ""}`
    if (recentAttempts(attemptKey).length >= 12) {
      return NextResponse.json({ success: false }, { status: 429 })
    }
    const teachers = JSON.parse(process.env.TEACHER_CREDENTIALS || "{}")
    if (teachers[username] && teachers[username] === password) {
      setTeacherCookie(cookies(), username)
      return NextResponse.json({ success: true, name: username })
    }
    recordFailedAttempt(attemptKey)
    return NextResponse.json({ success: false }, { status: 401 })
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
