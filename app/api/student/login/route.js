import { cookies } from "next/headers"
import { badRequest, ok, serverError, unauthorized } from "@/lib/api-response"
import { createServerSupabase } from "@/lib/server-supabase"
import { createPasswordHash, publicStudent, setStudentCookie, verifyPassword } from "@/lib/server-auth"

export async function POST(request) {
  try {
    const { name, batch, password } = await request.json()
    if (!name?.trim() || !batch || !password?.trim()) return badRequest("Name, batch, and password are required.")

    const supabase = createServerSupabase()
    const { data, error } = await supabase
      .from("students")
      .select("id,name,batch,password_hash,created_at")
      .ilike("name", name.trim())
      .eq("batch", batch)
    if (error) throw error

    const student = (data || []).find(row => verifyPassword(password, row.password_hash))
    if (!student) return unauthorized()

    if (!student.password_hash?.startsWith("pbkdf2_sha256$")) {
      await supabase.from("students").update({ password_hash: createPasswordHash(password) }).eq("id", student.id)
    }

    const safeStudent = publicStudent(student)
    setStudentCookie(cookies(), safeStudent)
    return ok({ success: true, student: safeStudent })
  } catch (error) {
    return serverError(error)
  }
}
