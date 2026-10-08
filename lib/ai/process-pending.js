import { debugLog } from '@/lib/logger'
/**
 * Retired browser-side pending scan.
 * AI generation must run through authenticated API routes or server queues.
 */
export async function processExistingPendingSubmissions() {
  debugLog('[AI] pending browser scan retired; use authenticated generation queues.')
  return { success: true, processed: 0, skipped: true, retired: true }
}
