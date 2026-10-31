import * as XLSX from 'xlsx'
import {
  matchNamesToStudents,
  normalizeParticipantName,
  stripParticipantSuffix,
} from './attendance-matching.js'

export const stripTeamsSuffix = stripParticipantSuffix
export const normalizeAttendanceName = normalizeParticipantName

function decodeTextBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }
  return new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '')
}

export function parseTeamsReport(buffer, fileName) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase()
  let wb
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = decodeTextBuffer(buffer)
    wb = XLSX.read(text, { type: 'string' })
  } else {
    wb = XLSX.read(buffer, { type: 'buffer' })
  }
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { names: [], meta: { fileName, error: 'No sheets found in file.' } }

  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  if (!rows.length) return { names: [], meta: { fileName, error: 'Sheet is empty.' } }

  const headers = Object.keys(rows[0]).map(h => normalizeParticipantName(h))
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

export function buildUploadPreview({ fileNames, students, aliases = [], existingAttendance, date, batch }) {
  const { matched, uncertain, unmatched } = matchNamesToStudents(fileNames, students, aliases)

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
