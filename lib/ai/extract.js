import { MAX_SUBMISSION_CHARS } from './constants'
import {
  logParserDiagnostics,
  parsePastedCode,
  parseUploadedAssignment,
} from './parsers'
import { normalizeExtractedText } from './parsers/normalize'

/**
 * Normalize and cap extracted submission text.
 */
export function normalizeSubmissionText(text) {
  return normalizeExtractedText(text, { maxChars: MAX_SUBMISSION_CHARS })
}

async function downloadFileText(supabase, fileName) {
  const safeName = String(fileName || '').replace(/[/\\]/g, '').slice(0, 512)
  if (!safeName) {
    throw new Error('Invalid submission file name.')
  }

  const { data, error } = await supabase.storage.from('assignments').download(safeName)
  if (error || !data) {
    throw new Error('Could not download submission file from storage.')
  }

  let raw
  try {
    raw = await data.text()
  } catch {
    throw new Error('Could not read submission file contents.')
  }

  return parseUploadedAssignment(raw, { fileName: safeName })
}

/**
 * Build evaluable text from a submission row (code, cache, or storage file).
 */
export async function extractSubmissionText(submission, supabase) {
  const result = await extractSubmissionForEvaluation(submission, supabase)
  return result.text
}

export async function extractSubmissionForEvaluation(submission, supabase) {
  if (submission.submission_text?.trim()) {
    const cachedText = normalizeSubmissionText(submission.submission_text)
    const diagnostics = {
      parser: 'cached-submission-text',
      source: 'submission_text',
      supported: true,
      characters: cachedText.length,
    }
    logParserDiagnostics(diagnostics)
    return { text: cachedText, diagnostics }
  }

  if (submission.code_text?.trim()) {
    const parsed = parsePastedCode(submission.code_text)
    logParserDiagnostics(parsed.diagnostics)
    return parsed
  }

  if (submission.file_name) {
    const parsed = await downloadFileText(supabase, submission.file_name)
    logParserDiagnostics(parsed.diagnostics)
    return {
      text: normalizeSubmissionText(parsed.text),
      diagnostics: parsed.diagnostics,
    }
  }

  const diagnostics = {
    parser: 'empty-submission',
    supported: false,
    characters: 0,
  }
  logParserDiagnostics(diagnostics)
  return { text: '', diagnostics }
}
