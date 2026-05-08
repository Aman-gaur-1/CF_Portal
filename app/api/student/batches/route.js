import { createServerSupabase } from "@/lib/server-supabase"
import { ok, serverError } from "@/lib/api-response"

export async function GET() {
  try {
    const supabase = createServerSupabase()
    const { data, error } = await supabase.from("batches").select("name").order("created_at")
    if (error) throw error
    return ok({ batches: (data || []).map(b => b.name) })
  } catch (error) {
    return serverError(error)
  }
}
