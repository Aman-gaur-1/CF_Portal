import { cookies } from "next/headers"
import { badRequest, ok, serverError, unauthorized } from "@/lib/api-response"
import { createPasswordHash, readTeacher } from "@/lib/server-auth"
import { createServerSupabase } from "@/lib/server-supabase"

function requireTeacher() {
  return readTeacher(cookies())
}

async function withSignedFileUrls(supabase, rows) {
  return Promise.all((rows || []).map(async row => {
    if (!row.file_name) return row
    const { data } = await supabase.storage.from("assignments").createSignedUrl(row.file_name, 24 * 60 * 60)
    return { ...row, file_url: data?.signedUrl || row.file_url }
  }))
}

export async function GET() {
  try {
    if (!requireTeacher()) return unauthorized()
    const supabase = createServerSupabase()
    const [{ data: batches, error: batchesError }, { data: students, error: studentsError }, { data: submissions, error: submissionsError }] = await Promise.all([
      supabase.from("batches").select("*").order("created_at"),
      supabase.from("students").select("id,name,batch,created_at").order("created_at"),
      supabase.from("submissions").select("*").order("submitted_at", { ascending: false }),
    ])
    if (batchesError || studentsError || submissionsError) throw batchesError || studentsError || submissionsError
    return ok({ batches: batches || [], students: students || [], submissions: await withSignedFileUrls(supabase, submissions || []) })
  } catch (error) {
    return serverError(error)
  }
}

export async function POST(request) {
  try {
    const teacher = requireTeacher()
    if (!teacher) return unauthorized()
    const { name } = await request.json()
    if (!name?.trim()) return badRequest("Batch name cannot be empty.")

    const supabase = createServerSupabase()
    const { error } = await supabase.from("batches").insert({
      name: name.trim(),
      created_by: teacher.name,
      created_at: new Date().toISOString(),
    })
    if (error) throw error
    return ok({ success: true })
  } catch (error) {
    return serverError(error)
  }
}

export async function PATCH(request) {
  try {
    if (!requireTeacher()) return unauthorized()
    const { studentId, password, confirmPassword } = await request.json()
    if (!studentId) return badRequest("Student id is required.")
    if (!password?.trim() || password.trim().length < 4) return badRequest("Password must be at least 4 chars.")
    if (password.trim() !== confirmPassword?.trim()) return badRequest("Passwords do not match.")

    const supabase = createServerSupabase()
    const { error } = await supabase.from("students").update({ password_hash: createPasswordHash(password) }).eq("id", studentId)
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
    if (!id) return badRequest("Batch id is required.")
    const supabase = createServerSupabase()
    const { error } = await supabase.from("batches").delete().eq("id", id)
    if (error) throw error
    return ok({ success: true })
  } catch (error) {
    return serverError(error)
  }
}
