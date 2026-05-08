import { badRequest, ok, serverError } from "@/lib/api-response"
import { createPasswordHash } from "@/lib/server-auth"
import { createServerSupabase } from "@/lib/server-supabase"

export async function POST(request) {
  try {
    const { name, batch, password, confirmPassword } = await request.json()
    if (!name?.trim()) return badRequest("Name is required.")
    if (!batch) return badRequest("Batch is required.")
    if (!password?.trim() || password.trim().length < 4) return badRequest("Password must be at least 4 characters.")
    if (password.trim() !== confirmPassword?.trim()) return badRequest("Passwords do not match.")

    const supabase = createServerSupabase()
    const { error } = await supabase.from("students").insert({
      name: name.trim(),
      batch,
      password_hash: createPasswordHash(password),
      created_at: new Date().toISOString(),
    })
    if (error) throw error
    return ok({ success: true })
  } catch (error) {
    const message = error.message?.includes("duplicate") || error.message?.includes("unique")
      ? "Account already exists. Please login."
      : error.message
    return serverError({ message })
  }
}
