import { cookies } from "next/headers"
import { clearTeacherCookie, readTeacher } from "@/lib/server-auth"
import { ok, unauthorized } from "@/lib/api-response"

export async function GET() {
  const teacher = readTeacher(cookies())
  if (!teacher) return unauthorized()
  return ok({ success: true, teacher: { name: teacher.name } })
}

export async function DELETE() {
  clearTeacherCookie(cookies())
  return ok({ success: true })
}
