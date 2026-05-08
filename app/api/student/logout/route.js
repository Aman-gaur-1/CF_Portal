import { cookies } from "next/headers"
import { clearStudentCookie } from "@/lib/server-auth"
import { ok } from "@/lib/api-response"

export async function POST() {
  clearStudentCookie(cookies())
  return ok({ success: true })
}
