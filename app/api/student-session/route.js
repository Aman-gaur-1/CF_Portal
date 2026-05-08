import { cookies } from "next/headers"
import { clearStudentCookie, readStudent } from "@/lib/server-auth"
import { ok, unauthorized } from "@/lib/api-response"

export async function GET() {
  const student = readStudent(cookies())
  if (!student) return unauthorized()
  return ok({ success: true, student: { id: student.id, name: student.name, batch: student.batch } })
}

export async function DELETE() {
  clearStudentCookie(cookies())
  return ok({ success: true })
}
