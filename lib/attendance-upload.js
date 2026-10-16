import * as XLSX from 'xlsx'

const CONFIDENCE_EXACT = 'exact'
const CONFIDENCE_HIGH = 'high'
const CONFIDENCE_LOW = 'low'
const CONFIDENCE_NONE = 'none'

const HIGH_THRESHOLD = 0.80
const LOW_THRESHOLD = 0.55

function normalize(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function tokenize(name) {
  return normalize(name).split(' ').filter(Boolean).sort()
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

function similarity(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1

  const maxLen = Math.max(na.length, nb.length)
  const charSim = 1 - levenshtein(na, nb) / maxLen

  const tokA = tokenize(a)
  const tokB = tokenize(b)
  const tokenStr = (tokens) => tokens.join(' ')
  const tokenSim = 1 - levenshtein(tokenStr(tokA), tokenStr(tokB)) / Math.max(tokenStr(tokA).length, tokenStr(tokB).length, 1)

  return Math.max(charSim, tokenSim)
}

export function parseTeamsReport(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { names: [], meta: { fileName, error: 'No sheets found in file.' } }

  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  if (!rows.length) return { names: [], meta: { fileName, error: 'Sheet is empty.' } }

  const headers = Object.keys(rows[0]).map(h => normalize(h))
  const nameIndex = headers.findIndex(h =>
    h === 'full name' || h === 'name' || h === 'participant name' ||
    h === 'display name' || h === 'participant' || h === 'student name' ||
    h === 'student' || h === 'attendee'
  )

  const nameKey = nameIndex >= 0 ? Object.keys(rows[0])[nameIndex] : null
  if (!nameKey) {
    const firstKey = Object.keys(rows[0])[0]
    const names = extractUniqueNames(rows, firstKey)
    return { names, meta: { fileName, detectedColumn: firstKey, fallback: true, totalRows: rows.length } }
  }

  const names = extractUniqueNames(rows, nameKey)
  return { names, meta: { fileName, detectedColumn: nameKey, totalRows: rows.length } }
}

function extractUniqueNames(rows, key) {
  const seen = new Set()
  const names = []
  for (const row of rows) {
    const raw = String(row[key] || '').trim()
    if (!raw) continue
    const lower = raw.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    names.push(raw)
  }
  return names
}

export function matchNamesToStudents(fileNames, students) {
  const studentMap = students.map(s => ({
    id: s.id,
    name: s.name,
    batch: s.batch,
    normalized: normalize(s.name),
  }))

  const exactIndex = new Map()
  for (const s of studentMap) {
    exactIndex.set(s.normalized, s)
  }

  const matched = []
  const uncertain = []
  const unmatched = []

  for (const fileName of fileNames) {
    const norm = normalize(fileName)
    const exact = exactIndex.get(norm)
    if (exact) {
      matched.push({
        fileName,
        studentId: exact.id,
        studentName: exact.name,
        confidence: CONFIDENCE_EXACT,
        similarity: 1,
      })
      continue
    }

    let bestMatch = null
    let bestSim = 0
    for (const s of studentMap) {
      const sim = similarity(fileName, s.name)
      if (sim > bestSim) {
        bestSim = sim
        bestMatch = s
      }
    }

    if (bestMatch && bestSim >= HIGH_THRESHOLD) {
      matched.push({
        fileName,
        studentId: bestMatch.id,
        studentName: bestMatch.name,
        confidence: CONFIDENCE_HIGH,
        similarity: Math.round(bestSim * 100) / 100,
      })
    } else if (bestMatch && bestSim >= LOW_THRESHOLD) {
      uncertain.push({
        fileName,
        studentId: bestMatch.id,
        studentName: bestMatch.name,
        confidence: CONFIDENCE_LOW,
        similarity: Math.round(bestSim * 100) / 100,
      })
    } else {
      unmatched.push({
        fileName,
        bestMatch: bestMatch ? {
          studentId: bestMatch.id,
          studentName: bestMatch.name,
          similarity: Math.round((bestSim || 0) * 100) / 100,
        } : null,
        confidence: CONFIDENCE_NONE,
      })
    }
  }

  return { matched, uncertain, unmatched }
}

export function buildUploadPreview({ fileNames, students, existingAttendance, date, batch }) {
  const { matched, uncertain, unmatched } = matchNamesToStudents(fileNames, students)

  const existingByStudentId = new Map()
  for (const row of existingAttendance) {
    existingByStudentId.set(String(row.student_id), row)
  }

  const fresh = []
  const alreadyMarked = []

  for (const entry of matched) {
    const existing = existingByStudentId.get(String(entry.studentId))
    if (existing) {
      alreadyMarked.push({ ...entry, existingStatus: existing.status, existingId: existing.id })
    } else {
      fresh.push(entry)
    }
  }

  return {
    date,
    batch,
    totalNamesInFile: fileNames.length,
    matched: fresh,
    alreadyMarked,
    uncertain,
    unmatched,
    summary: {
      willCreate: fresh.length,
      alreadyExists: alreadyMarked.length,
      needsReview: uncertain.length,
      noMatch: unmatched.length,
    },
  }
}
