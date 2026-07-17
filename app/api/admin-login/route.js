import { NextResponse } from "next/server"
import { createAdminToken } from "@/lib/admin-auth"
import { clearLoginAttempts, consumeLoginAttempt } from "@/lib/login-rate-limit"

function readCredentials() {
  const raw = process.env.ADMIN_CREDENTIALS
  if (!raw) throw new Error("ADMIN_CREDENTIALS is not configured")
  return JSON.parse(raw)
}

export async function POST(request) {
  try {
    const rateLimit = await consumeLoginAttempt(request, "admin")
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many login attempts. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      )
    }

    const { username, password } = await request.json()
    const admins = readCredentials()

    if (admins[username] && admins[username] === password) {
      await clearLoginAttempts(request, "admin")
      return NextResponse.json({ success: true, name: username, role: "admin", token: createAdminToken(username) })
    }

    return NextResponse.json({ success: false }, { status: 401 })
  } catch (e) {
    console.error("[admin-login] failed", e.message)
    return NextResponse.json({ success: false, error: "Admin login is unavailable." }, { status: 500 })
  }
}
