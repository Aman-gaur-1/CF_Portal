import { supabase } from '@/lib/supabase'
import { triggerAiEvaluation } from '@/lib/ai/trigger-evaluation'

let pendingScanPromise = null
let pendingScanCompleted = false

/**
 * Process all existing pending submissions that don't have AI feedback yet
 * This should be called once after deploying the auto-generation feature
 */
export async function processExistingPendingSubmissions() {
  if (pendingScanCompleted) {
    console.info('[AI] pending scan skipped: already completed')
    return { success: true, processed: 0, skipped: true }
  }

  if (pendingScanPromise) {
    console.info('[AI] pending scan skipped: already running')
    return pendingScanPromise
  }

  pendingScanPromise = runPendingSubmissionScan().finally(() => {
    pendingScanCompleted = true
    pendingScanPromise = null
  })

  return pendingScanPromise
}

async function runPendingSubmissionScan() {
  try {
    console.log('[AI] Checking for existing pending submissions...')
    
    // Get all submissions with ai_status = 'pending' and no ai_feedback
    const { data: pendingSubmissions, error } = await supabase
      .from('submissions')
      .select('id')
      .eq('ai_status', 'pending')
      .is('ai_feedback', null)
      .limit(50) // Process in batches to avoid overwhelming the system

    if (error) {
      console.error('[AI] Failed to fetch pending submissions:', error)
      return { success: false, error: error.message }
    }

    if (!pendingSubmissions || pendingSubmissions.length === 0) {
      console.log('[AI] No pending submissions found')
      return { success: true, processed: 0 }
    }

    console.log(`[AI] Found ${pendingSubmissions.length} pending submissions to process`)

    // Trigger AI evaluation for each pending submission
    let processed = 0
    for (const submission of pendingSubmissions) {
      try {
        console.log(`[AI] Triggering evaluation for submission ${submission.id}`)
        triggerAiEvaluation(submission.id).then(result => {
          if (!result.ok) {
            console.warn(`[AI] Trigger was not accepted for submission ${submission.id}:`, result.error)
          }
        })
        processed++
      } catch (error) {
        console.error(`[AI] Failed to trigger evaluation for submission ${submission.id}:`, error)
        // Continue with other submissions
      }
      
      // Add a small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.log(`[AI] Successfully triggered AI evaluation for ${processed} submissions`)
    return { success: true, processed }
  } catch (error) {
    console.error('[AI] Unexpected error processing pending submissions:', error)
    return { success: false, error: error.message }
  }
}
