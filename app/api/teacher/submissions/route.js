import { cookies } from "next/headers"
import { badRequest, ok, serverError, unauthorized } from "@/lib/api-response"
import { readTeacher } from "@/lib/server-auth"
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
    const { data, error } = await supabase.from("submissions").select("*").order("submitted_at", { ascending: false })
    if (error) throw error
    return ok({ submissions: await withSignedFileUrls(supabase, data || []) })
  } catch (error) {
    return serverError(error)
  }
}

export async function PATCH(request) {
  try {
    const teacher = requireTeacher()
    if (!teacher) return unauthorized()
    const { id, feedback, submission_type, phase } = await request.json()
    if (!id) return badRequest("Submission id is required.")
    if (!feedback?.trim()) return badRequest("Feedback is required.")

    const supabase = createServerSupabase()
    const { error } = await supabase.from("submissions").update({
      feedback: feedback.trim(),
      feedback_by: teacher.name,
      feedback_at: new Date().toISOString(),
      submission_type,
      phase,
    }).eq("id", id)
    if (error) throw error
    return ok({ success: true })
  } catch (error) {
    return serverError(error)
  }
}

export async function DELETE(request) {
  try {
    if (!requireTeacher()) return unauthorized()
    const { id, file_name } = await request.json()
    if (!id) return badRequest("Submission id is required.")

    const supabase = createServerSupabase()
    if (file_name) await supabase.storage.from("assignments").remove([file_name]).catch(() => {})
    const { error } = await supabase.from("submissions").delete().eq("id", id)
    if (error) throw error
    return ok({ success: true })
  } catch (error) {
    return serverError(error)
  }
}
