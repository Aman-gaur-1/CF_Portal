import { MAX_EXTRACTED_FILE_CHARS } from '../constants'
import { analyzePythonSignals } from '../code-signals'
import { joinSections, normalizeExtractedText, toUint8Array } from './normalize'

const MIN_USABLE_TEXT_CHARS = 80
const MIN_USABLE_CODE_CHARS = 24
const OCR_MIN_TEXT_CHARS = 220
const OCR_MAX_IMAGES = 3
const OCR_MAX_IMAGE_BYTES = 3 * 1024 * 1024

export async function parsePdf(raw, { ext, fileName } = {}) {
  const bytes = toUint8Array(raw)
  const diagnostics = {
    parser: 'pdf',
    extension: ext || 'pdf',
    fileName: fileName || null,
    supported: true,
    bytes: bytes.byteLength,
    pages: 0,
    extraction_method: 'none',
    direct_text_characters: 0,
    raw_fallback_characters: 0,
    ocr_triggered: false,
    ocr_characters: 0,
    ocr_images_attempted: 0,
    ocr_skipped_reason: null,
    embedded_image_count: 0,
    dct_image_count: 0,
    extracted_code_characters: 0,
    commented_code_characters: 0,
    assignment_answer_characters: 0,
    code_signal_matches: [],
    commented_code_matches: [],
    assignment_answer_matches: [],
    usability_reasons: [],
    normalized_text_preview: '',
    extraction_score: 0,
    extraction_confidence: 'low',
    fallback_reason: null,
  }

  if (!bytes.byteLength) {
    diagnostics.supported = false
    diagnostics.fallback_reason = 'empty_pdf_bytes'
    return {
      text: '',
      diagnostics: withQuality(diagnostics, ''),
    }
  }

  const direct = await extractPdfText(bytes, diagnostics)
  const rawFallback = direct.text.length >= MIN_USABLE_TEXT_CHARS
    ? ''
    : extractRawPdfStrings(bytes, diagnostics)

  const preliminary = normalizeForEvaluation(joinSections([
    direct.text && `# Extracted PDF text\n${direct.text}`,
    rawFallback && `# PDF raw text fallback\n${rawFallback}`,
  ]))

  const images = findEmbeddedPdfImages(bytes)
  diagnostics.embedded_image_count = images.imageCount
  diagnostics.dct_image_count = images.jpegImages.length

  let ocrText = ''
  if (shouldRunOcr(preliminary, images.jpegImages)) {
    diagnostics.ocr_triggered = true
    diagnostics.fallback_reason = direct.error ? 'direct_text_failed_ocr_fallback' : 'low_direct_text_ocr_fallback'
    ocrText = await ocrEmbeddedImages(images.jpegImages, diagnostics)
  } else {
    diagnostics.ocr_skipped_reason = resolveOcrSkippedReason(preliminary, images)
  }

  if (!ocrText && diagnostics.ocr_triggered) {
    diagnostics.ocr_skipped_reason = diagnostics.ocr_error ? 'ocr_failed' : 'ocr_returned_no_text'
  } else if (preliminary.length < MIN_USABLE_TEXT_CHARS && images.imageCount > 0) {
    diagnostics.fallback_reason = images.jpegImages.length
      ? 'low_text_ocr_not_needed_or_unavailable'
      : 'low_text_images_not_extractable_for_ocr'
  }

  const text = normalizeForEvaluation(joinSections([
    preliminary,
    ocrText && `# OCR text from embedded PDF images\n${ocrText}`,
  ]))

  diagnostics.characters = text.length
  diagnostics.extraction_method = chooseExtractionMethod({ directText: direct.text, rawFallback, ocrText })

  return {
    text,
    diagnostics: withQuality(diagnostics, text),
  }
}

async function extractPdfText(bytes, diagnostics) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''

    const loadingTask = pdfjs.getDocument({
      data: bytes,
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: false,
    })
    const pdf = await loadingTask.promise
    diagnostics.pages = pdf.numPages || 0

    const pageTexts = []
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const content = await page.getTextContent({
        disableCombineTextItems: false,
        includeMarkedContent: false,
      })
      const pageText = textItemsToLines(content.items || [])
      if (pageText) pageTexts.push(`# Page ${pageNum}\n${pageText}`)
    }

    const text = normalizeForEvaluation(pageTexts.join('\n\n'))
    diagnostics.direct_text_characters = text.length
    return { text, error: null }
  } catch (err) {
    diagnostics.parse_error = err?.message || 'PDF text extraction failed'
    return { text: '', error: err }
  }
}

function textItemsToLines(items) {
  const positioned = items
    .map(item => ({
      text: String(item?.str || '').trim(),
      x: Number(item?.transform?.[4] || 0),
      y: Number(item?.transform?.[5] || 0),
      width: Number(item?.width || 0),
    }))
    .filter(item => item.text)
    .sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x)

  const lines = []
  for (const item of positioned) {
    const last = lines.at(-1)
    if (!last || Math.abs(last.y - item.y) > 3) {
      lines.push({ y: item.y, parts: [item] })
    } else {
      last.parts.push(item)
    }
  }

  return lines
    .map(line => joinTextLine(line.parts.sort((a, b) => a.x - b.x)))
    .join('\n')
}

function joinTextLine(parts) {
  let output = ''
  let previous = null
  for (const part of parts) {
    if (!previous) {
      output += part.text
    } else {
      const gap = part.x - (previous.x + previous.width)
      const needsSpace = gap > 1.5 && !/[\s([{.]$/.test(output) && !/^[,.;:)\]}]/.test(part.text)
      output += `${needsSpace ? ' ' : ''}${part.text}`
    }
    previous = part
  }
  return output
}

function extractRawPdfStrings(bytes, diagnostics) {
  const binary = bytesToBinaryString(bytes)
  const parts = []

  const literalPattern = /\((?:\\.|[^\\)]){4,}\)/g
  for (const match of binary.matchAll(literalPattern)) {
    const decoded = decodePdfLiteralString(match[0])
    if (looksLikeReadableText(decoded)) parts.push(decoded)
    if (parts.join('\n').length > MAX_EXTRACTED_FILE_CHARS) break
  }

  const hexPattern = /<([0-9A-Fa-f\s]{12,})>/g
  for (const match of binary.matchAll(hexPattern)) {
    const decoded = decodePdfHexString(match[1])
    if (looksLikeReadableText(decoded)) parts.push(decoded)
    if (parts.join('\n').length > MAX_EXTRACTED_FILE_CHARS) break
  }

  const text = normalizeForEvaluation(parts.join('\n'))
  diagnostics.raw_fallback_characters = text.length
  return text
}

function findEmbeddedPdfImages(bytes) {
  const binary = bytesToBinaryString(bytes)
  const imageCount = (binary.match(/\/Subtype\s*\/Image/g) || []).length
  const jpegImages = []
  const streamPattern = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g

  for (const match of binary.matchAll(streamPattern)) {
    const streamStart = match.index || 0
    const dictionary = binary.slice(Math.max(0, streamStart - 1200), streamStart)
    if (!/\/Subtype\s*\/Image/.test(dictionary) || !/\/(?:DCTDecode|JPXDecode)\b/.test(dictionary)) continue

    const data = binaryStringToUint8Array(trimPdfStream(match[1]))
    if (data.byteLength < 64 || data.byteLength > OCR_MAX_IMAGE_BYTES) continue
    jpegImages.push(data)
    if (jpegImages.length >= OCR_MAX_IMAGES) break
  }

  return { imageCount, jpegImages }
}

async function ocrEmbeddedImages(images, diagnostics) {
  if (!images.length) return ''

  try {
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('eng')
    const parts = []

    for (const image of images.slice(0, OCR_MAX_IMAGES)) {
      diagnostics.ocr_images_attempted += 1
      const result = await worker.recognize(Buffer.from(image))
      const text = normalizeForEvaluation(result?.data?.text || '')
      if (text) parts.push(text)
    }

    await worker.terminate()
    const ocrText = normalizeForEvaluation(parts.join('\n\n'))
    diagnostics.ocr_characters = ocrText.length
    return ocrText
  } catch (err) {
    diagnostics.ocr_error = err?.message || 'OCR failed'
    return ''
  }
}

function shouldRunOcr(text, images) {
  if (!images.length) return false
  if (hasUsableCode(text)) return false
  if (text.length < OCR_MIN_TEXT_CHARS) return true
  return !hasCodeSignals(text) && text.length < 800
}

function resolveOcrSkippedReason(text, images) {
  if (!images.imageCount) return 'no_embedded_images'
  if (!images.jpegImages.length) return 'no_extractable_jpeg_or_jpx_images'
  if (hasUsableCode(text)) return 'usable_code_extracted'
  if (text.length >= OCR_MIN_TEXT_CHARS && hasCodeSignals(text)) return 'direct_text_has_code_signals'
  if (text.length >= 800) return 'direct_text_long_enough'
  return 'ocr_not_required'
}

function chooseExtractionMethod({ directText, rawFallback, ocrText }) {
  const methods = []
  if (directText) methods.push('direct_text')
  if (rawFallback) methods.push('raw_pdf_strings')
  if (ocrText) methods.push('embedded_image_ocr')
  return methods.join('+') || 'none'
}

function withQuality(diagnostics, text) {
  const signals = analyzePythonSignals(text)
  const codeSignals = signals.hasCodeSignals
  const codeCharacters = signals.codeCharacters
  const commentedCodeCharacters = signals.commentedCodeCharacters
  const assignmentAnswerCharacters = signals.assignmentAnswerCharacters
  const usabilityReasons = usabilityReasonsFor({ text, signals, diagnostics })
  const enoughText =
    text.length >= MIN_USABLE_TEXT_CHARS ||
    codeCharacters >= MIN_USABLE_CODE_CHARS ||
    commentedCodeCharacters >= MIN_USABLE_CODE_CHARS ||
    (assignmentAnswerCharacters >= MIN_USABLE_TEXT_CHARS && (codeSignals || signals.hasCommentedCode))
  const strongText = text.length >= 500 || codeSignals || signals.hasCommentedCode
  const extractionScore = calculateExtractionScore({ text, signals, diagnostics })

  return {
    ...diagnostics,
    code_signals_detected: codeSignals,
    extracted_code_characters: codeCharacters,
    commented_code_characters: commentedCodeCharacters,
    assignment_answer_characters: assignmentAnswerCharacters,
    code_signal_matches: signals.codeMatches,
    commented_code_matches: signals.commentedCodeMatches,
    assignment_answer_matches: signals.assignmentAnswerMatches,
    usability_reasons: usabilityReasons,
    normalized_text_preview: String(text || '').slice(0, 500),
    extraction_score: extractionScore,
    extraction_quality: strongText ? 'strong' : enoughText ? 'usable' : 'low',
    extraction_confidence: strongText ? 'high' : enoughText ? 'medium' : 'low',
    low_quality: !enoughText,
  }
}

function calculateExtractionScore({ text, signals, diagnostics }) {
  let score = 0
  if (text.length >= MIN_USABLE_TEXT_CHARS) score += 0.35
  if (text.length >= 300) score += 0.2
  if (text.length >= 800) score += 0.15
  if (signals.hasCodeSignals) score += 0.25
  if (signals.codeCharacters >= MIN_USABLE_CODE_CHARS) score += 0.2
  if (signals.hasCommentedCode) score += 0.25
  if (signals.commentedCodeCharacters >= MIN_USABLE_CODE_CHARS) score += 0.2
  if (signals.hasAssignmentAnswers) score += 0.1
  if (diagnostics.ocr_characters >= MIN_USABLE_TEXT_CHARS) score += 0.15
  return Math.min(1, Number(score.toFixed(2)))
}

function usabilityReasonsFor({ text, signals, diagnostics }) {
  const reasons = []
  if (text.length >= MIN_USABLE_TEXT_CHARS) reasons.push('readable_text')
  if (text.length >= 300) reasons.push('substantial_text')
  if (signals.hasCodeSignals) reasons.push('python_syntax_detected')
  if (signals.hasCommentedCode) reasons.push('commented_python_code_detected')
  if (signals.hasAssignmentAnswers) reasons.push('structured_assignment_answers_detected')
  if (diagnostics.ocr_characters >= MIN_USABLE_TEXT_CHARS) reasons.push('ocr_text_detected')
  if (!reasons.length) reasons.push('insufficient_text_or_code_signals')
  return reasons
}

function normalizeForEvaluation(text) {
  return normalizeExtractedText(reconstructCodeBlocks(text), { maxChars: MAX_EXTRACTED_FILE_CHARS })
}

function reconstructCodeBlocks(text) {
  return String(text || '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\b(import|from|def|class|for|while|if|elif|else|try|except|with|return|print|input)\s+/g, '\n$1 ')
    .replace(/\s*:\s*(?=\n|$)/g, ':')
    .replace(/\n{3,}/g, '\n\n')
}

function hasCodeSignals(text) {
  return analyzePythonSignals(text, { maxMatches: 0 }).hasCodeSignals
}

function hasUsableCode(text) {
  const signals = analyzePythonSignals(text, { maxMatches: 0 })
  return (
    signals.hasCodeSignals ||
    signals.hasCommentedCode ||
    signals.codeCharacters >= MIN_USABLE_CODE_CHARS ||
    signals.commentedCodeCharacters >= MIN_USABLE_CODE_CHARS
  )
}

function looksLikeReadableText(text) {
  const value = String(text || '').trim()
  if (value.length < 4) return false
  const printable = value.replace(/[^\x20-\x7E\n\t]/g, '').length
  return printable / Math.max(value.length, 1) > 0.75 && /[A-Za-z0-9_]/.test(value)
}

function decodePdfLiteralString(value) {
  return String(value || '')
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
}

function decodePdfHexString(value) {
  const hex = String(value || '').replace(/\s+/g, '')
  const chars = []
  for (let i = 0; i < hex.length - 1; i += 2) {
    chars.push(String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)))
  }
  return chars.join('')
}

function bytesToBinaryString(bytes) {
  let output = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    output += String.fromCharCode(...bytes.slice(i, i + chunkSize))
  }
  return output
}

function binaryStringToUint8Array(value) {
  const bytes = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff
  return bytes
}

function trimPdfStream(value) {
  return String(value || '').replace(/^\r?\n/, '').replace(/\r?\n$/, '')
}
