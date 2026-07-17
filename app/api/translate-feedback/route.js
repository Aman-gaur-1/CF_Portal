import { NextResponse } from 'next/server'
import { generatePlainTextWithGemini } from '@/lib/ai/gemini'
import { consumeSharedRateLimit, getClientIp } from '@/lib/rate-limit'
import { sanitizeStudentText, wrapUntrustedContent } from '@/lib/ai/sanitize'
import { getStudentFromRequest } from '@/lib/student-auth'

export const maxDuration = 60

const MAX_FEEDBACK_LENGTH = 8000
const RATE_WINDOW_SECONDS = 60
const MAX_TRANSLATIONS_PER_IP = 20
const SUPPORTED_LANGUAGES = new Set(['english', 'hinglish', 'hindi'])

const TRANSLATION_INSTRUCTIONS = {
  hindi:
    'Translate this student assignment feedback into simple natural Hindi. Keep the tone supportive and trainer-like. Do not add new information. Do not change the score.',
  hinglish:
    'Translate this student assignment feedback into natural Hinglish using simple Roman Hindi. Keep the tone supportive and trainer-like. Do not add new information. Do not change the score. Avoid overly formal Hindi.',
}

export async function POST(req) {
  try {
    const student = getStudentFromRequest(req)
    if (!student) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ip = getClientIp(req)
    const rateLimit = await consumeSharedRateLimit({
      key: `translate-feedback:${student.id}:${ip}`,
      windowSeconds: RATE_WINDOW_SECONDS,
      maxAttempts: MAX_TRANSLATIONS_PER_IP,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many translation requests. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      )
    }

    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const targetLanguage = String(body?.targetLanguage || '').trim().toLowerCase()
    if (!SUPPORTED_LANGUAGES.has(targetLanguage)) {
      return NextResponse.json({ error: 'Unsupported target language' }, { status: 400 })
    }

    const feedback = sanitizeStudentText(body?.feedback, MAX_FEEDBACK_LENGTH)
    if (!feedback) {
      return NextResponse.json({ error: 'Feedback text is required' }, { status: 400 })
    }

    if (targetLanguage === 'english') {
      return NextResponse.json({ translation: feedback })
    }

    const prompt = `${TRANSLATION_INSTRUCTIONS[targetLanguage]}
Preserve Python terms, code identifiers, and technical meaning where appropriate.
Keep every score exactly as written, including its digits and format.
Return only the translated feedback text. Do not add headings, notes, quotes, or markdown.

${wrapUntrustedContent('feedback_to_translate', feedback)}`

    const { text } = await generatePlainTextWithGemini(prompt)
    const translation = cleanTranslation(text)
    if (!translation) {
      throw new Error('Translation returned empty text')
    }
    if (!preservesScores(feedback, translation)) {
      throw new Error('Translation changed the feedback score')
    }

    return NextResponse.json({ translation })
  } catch (err) {
    console.error('[translate-feedback] failed', err?.message)
    return NextResponse.json({ error: 'Could not translate feedback. Please try again.' }, { status: 500 })
  }
}

function cleanTranslation(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
    .slice(0, 12000)
}

function preservesScores(source, translation) {
  const scorePattern = /\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\b/g
  const sourceScores = source.match(scorePattern) || []
  if (!sourceScores.length) return true

  const translatedScores = new Set(translation.match(scorePattern) || [])
  return sourceScores.every(score => translatedScores.has(score))
}
