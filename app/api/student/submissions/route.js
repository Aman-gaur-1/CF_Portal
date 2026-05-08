import { cookies } from "next/headers"
import { ok, serverError, unauthorized } from "@/lib/api-response"
import { readStudent } from "@/lib/server-auth"
import { createServerSupabase } from "@/lib/server-supabase"

async function withSignedFileUrls(supabase, rows) {
  return Promise.all((rows || []).map(async row => {
    if (!row.file_name) return row
    const { data } = await supabase.storage.from("assignments").createSignedUrl(row.file_name, 24 * 60 * 60)
    return { ...row, file_url: data?.signedUrl || row.file_url }
  }))
}

export async function GET() {
  try {
    const student = readStudent(cookies())
    if (!student) return unauthorized()

    const supabase = createServerSupabase()
    const { data, error } = await supabase
      .from("submissions")
      .select("*")
      .eq("student_id", student.id)
      .order("submitted_at", { ascending: false })
    if (error) throw error
    return ok({ submissions: await withSignedFileUrls(supabase, data || []) })
  } catch (error) {
    return serverError(error)
  }
}
