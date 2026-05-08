import { cookies } from "next/headers"
import { badRequest, ok, serverError, unauthorized } from "@/lib/api-response"
import { readStudent } from "@/lib/server-auth"
import { createServerSupabase } from "@/lib/server-supabase"
import { sanitizeFilename } from "@/lib/utils"

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request) {
  let storedName = null

  try {
    const student = readStudent(cookies())
    if (!student) return unauthorized()

    const form = await request.formData()
    const topic = String(form.get("topic") || "").trim()
    const code = String(form.get("code") || "").trim()
    const comment = String(form.get("comment") || "").trim()
    const file = form.get("file")

    if (!topic) return badRequest("Topic is required.")
    if ((!file || typeof file === "string" || file.size === 0) && !code) return badRequest("Upload a file or paste your code.")
    if (file && typeof file !== "string" && file.size > MAX_BYTES) return badRequest("File exceeds 10MB limit.")

    const supabase = createServerSupabase()
    if (file && typeof file !== "string" && file.size > 0) {
      const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)
      storedName = `${sanitizeFilename(student.name)}_${ts}_${sanitizeFilename(file.name)}`
      const bytes = Buffer.from(await file.arrayBuffer())
      const { error: uploadErr } = await supabase.storage
        .from("assignments")
        .upload(storedName, bytes, { contentType: file.type || "application/octet-stream" })
      if (uploadErr) throw uploadErr
    }

    const { error } = await supabase.from("submissions").insert({
      student_id: student.id,
      student_name: student.name,
      batch: student.batch,
      topic,
      file_name: storedName,
      file_url: null,
      code_text: code || null,
      comment,
      submitted_at: new Date().toISOString(),
      submission_type: "assignment",
      phase: "Python",
    })
    if (error) {
      if (storedName) await supabase.storage.from("assignments").remove([storedName]).catch(() => {})
      throw error
    }

    return ok({ success: true })
  } catch (error) {
    return serverError(error)
  }
}
