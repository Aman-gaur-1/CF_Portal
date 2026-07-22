import { MAX_SUBMISSION_CHARS } from './constants'
import {
  extensionFromPath,
  logParserDiagnostics,
  parsePastedCode,
  parseUploadedAssignment,
} from './parsers'
import { normalizeExtractedText } from './parsers/normalize'
import { countPythonCodeCharacters } from './code-signals'
import { parseAssignmentStructure } from '@/lib/assignment-analysis'

/**
 * Normalize and cap extracted submission text.
 */
export function normalizeSubmissionText(text) {
  return normalizeExtractedText(text, { maxChars: MAX_SUBMISSION_CHARS })
}

function isPdfSubmission(submission) {
  return extensionFromPath(submission?.file_name || submission?.original_file_name) === 'pdf'
}

function isStaleVisibilityPlaceholder(text) {
  const normalized = String(text || '').toLowerCase()
  return (
    normalized.includes('not clearly visible') ||
    normalized.includes('uploaded work is not') ||
    normalized.includes('unsupported file') ||
    normalized.includes('could not be reviewed properly')
  )
}

function logExtractionHandoff(source, text, diagnostics = {}, extra = {}) {
  console.info('[assignment-parser] evaluation handoff', {
    source,
    parser: diagnostics.parser || null,
    fileName: diagnostics.fileName || null,
    extractionMethod: diagnostics.extraction_method || null,
    extractedTextLength: text?.length || 0,
    extractedCodeLength: countPythonCodeCharacters(text),
    ocrTriggered: Boolean(diagnostics.ocr_triggered),
    ocrSkippedReason: diagnostics.ocr_skipped_reason || null,
    ocrTextLength: diagnostics.ocr_characters || 0,
    quality: diagnostics.extraction_quality || null,
    confidence: diagnostics.extraction_confidence || null,
    lowQuality: Boolean(diagnostics.low_quality),
    finalTextPreview: String(text || '').slice(0, 240),
    ...extra,
  })
}

async function downloadFileAssignment(supabase, fileName) {
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
    raw = await data.arrayBuffer()
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
    if (isPdfSubmission(submission) && isStaleVisibilityPlaceholder(cachedText)) {
      console.warn('[assignment-parser] bypassing stale cached PDF extraction placeholder', {
        submissionId: submission.id || null,
        fileName: submission.file_name || null,
        cachedCharacters: cachedText.length,
        cachedPreview: cachedText.slice(0, 160),
      })
    } else {
      const diagnostics = {
        parser: 'cached-submission-text',
        source: 'submission_text',
        supported: true,
        characters: cachedText.length,
      }
      logParserDiagnostics(diagnostics)
      logExtractionHandoff('cached-submission-text', cachedText, diagnostics)
      return withStructuredAssignment(cachedText, diagnostics, submission)
    }
  }

  if (submission.code_text?.trim()) {
    const parsed = parsePastedCode(submission.code_text)
    logParserDiagnostics(parsed.diagnostics)
    logExtractionHandoff('pasted-code', parsed.text, parsed.diagnostics)
    return withStructuredAssignment(parsed.text, parsed.diagnostics, submission)
  }

  if (submission.file_name) {
    const parsed = await downloadFileAssignment(supabase, submission.file_name)
    logParserDiagnostics(parsed.diagnostics)
    const text = normalizeSubmissionText(parsed.text)
    logExtractionHandoff('uploaded-file', text, parsed.diagnostics, {
      originalCharacters: parsed.text?.length || 0,
    })
    return {
      text,
      diagnostics: enrichDiagnosticsWithStructure(text, parsed.diagnostics, submission),
    }
  }

  const diagnostics = {
    parser: 'empty-submission',
    supported: false,
    characters: 0,
  }
  logParserDiagnostics(diagnostics)
  logExtractionHandoff('empty-submission', '', diagnostics)
  return withStructuredAssignment('', diagnostics, submission)
}

function withStructuredAssignment(text, diagnostics, submission) {
  return {
    text,
    diagnostics: enrichDiagnosticsWithStructure(text, diagnostics, submission),
  }
}

function enrichDiagnosticsWithStructure(text, diagnostics = {}, submission = {}) {
  const fileName = submission.original_file_name || submission.file_name || diagnostics.fileName || ''
  const structured = parseAssignmentStructure({
    text,
    diagnostics,
    fileName,
    topic: submission.topic,
  })

  return {
    ...diagnostics,
    detected_language: structured.detected_language,
    detected_phase: structured.detected_phase,
    detection_confidence: structured.detection_confidence,
    detection_confidence_percent: structured.detection_confidence_percent,
    matched_signals: structured.matched_signals,
    detected_assignment_type: structured.assignment_type,
    detected_language_evidence: structured.detection_evidence,
    structured_assignment: structured,
  }
}
