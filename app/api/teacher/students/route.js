import { cookies } from "next/headers"
import { badRequest, ok, serverError, unauthorized } from "@/lib/api-response"
import { createPasswordHash, readTeacher } from "@/lib/server-auth"
import { createServerSupabase } from "@/lib/server-supabase"

function requireTeacher() {
  return readTeacher(cookies())
}

export async function GET() {
  try {
    if (!requireTeacher()) return unauthorized()
    const supabase = createServerSupabase()
    const [{ data: students, error: studentsError }, { data: submissions, error: submissionsError }, { data: batches, error: batchesError }] = await Promise.all([
      supabase.from("students").select("id,name,batch,created_at").order("created_at"),
      supabase.from("submissions").select("student_id"),
      supabase.from("batches").select("name").order("created_at"),
    ])
    if (studentsError || submissionsError || batchesError) throw studentsError || submissionsError || batchesError
    return ok({ students: students || [], submissions: submissions || [], batches: batches || [] })
  } catch (error) {
    return serverError(error)
  }
}

export async function PATCH(request) {
  try {
    if (!requireTeacher()) return unauthorized()
    const { id, name, batch, password } = await request.json()
    if (!id) return badRequest("Student id is required.")
    if (!name?.trim()) return badRequest("Name cannot be empty.")
    if (password?.trim() && password.trim().length < 4) return badRequest("Password must be at least 4 chars.")

    const update = { name: name.trim(), batch }
    if (password?.trim()) update.password_hash = createPasswordHash(password)

    const supabase = createServerSupabase()
    const { error } = await supabase.from("students").update(update).eq("id", id)
    if (error) throw error
    return ok({ success: true })
  } catch (error) {
    return serverError(error)
  }
}

export async function DELETE(request) {
  try {
    if (!requireTeacher()) return unauthorized()
    const { id } = await request.json()
    if (!id) return badRequest("Student id is required.")
    const supabase = createServerSupabase()
    const { error } = await supabase.from("students").delete().eq("id", id)
    if (error) throw error
    return ok({ success: true })
  } catch (error) {
    return serverError(error)
  }
}
