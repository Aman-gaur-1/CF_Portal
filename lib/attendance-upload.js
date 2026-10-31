import * as XLSX from 'xlsx'
import {
  matchNamesToStudents,
  normalizeParticipantName,
  stripParticipantSuffix,
} from './attendance-matching.js'

export const stripTeamsSuffix = stripParticipantSuffix
export const normalizeAttendanceName = normalizeParticipantName

const PARTICIPANT_NAME_HEADERS = new Set([
  'full name',
  'name',
  'participant name',
  'display name',
  'participant',
  'student name',
  'student',
  'attendee',
])

const TEAMS_METADATA_KEYS = new Set([
  'meeting title',
  'attended participants',
  'start time',
  'end time',
  'meeting duration',
  'average attendance time',
  'participants',
  '2 participants',
  'name',
  'email',
  'role',
])

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
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true })
  if (!matrix.length) return { names: [], meta: { fileName, error: 'Sheet is empty.' } }

  const normalizedRows = matrix.map(row => row.map(cell => normalizeTeamsCell(cell)))
  const sectionMarkerIndex = normalizedRows.findIndex(row => row.some(cell => isParticipantsMarker(cell)))
  const headerStart = sectionMarkerIndex >= 0 ? sectionMarkerIndex + 1 : 0
  const headerMatch = findParticipantHeader(normalizedRows, headerStart)

  if (!headerMatch) {
    return {
      names: [],
      meta: {
        fileName,
        error: "We couldn't safely detect the participant list in this file.",
        structure: normalizedRows.slice(0, 20).map(row => row.filter(Boolean)),
      },
    }
  }

  const names = extractNamesFromMatrix(matrix, normalizedRows, headerMatch.rowIndex, headerMatch.nameIndex)
  if (!names.length) {
    return {
      names: [],
      meta: { fileName, error: "We couldn't safely detect the participant list in this file.", detectedColumn: headerMatch.header },
    }
  }

  const metaRows = normalizedRows.slice(0, headerMatch.rowIndex)
  return {
    names,
    meta: {
      fileName,
      detectedColumn: headerMatch.header,
      participantSection: sectionMarkerIndex >= 0,
      headerRow: headerMatch.rowIndex + 1,
      totalRows: names.length,
      meetingTitle: findMetadataValue(matrix, metaRows, 'meeting title'),
      startTime: findMetadataValue(matrix, metaRows, 'start time'),
      endTime: findMetadataValue(matrix, metaRows, 'end time'),
    },
  }
}

function normalizeTeamsCell(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isParticipantsMarker(value) {
  return value === 'participants' || /^\d+\.\s*participants$/.test(value)
}

function findParticipantHeader(rows, startIndex) {
  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const nameIndex = row.findIndex(cell => PARTICIPANT_NAME_HEADERS.has(cell))
    if (nameIndex < 0) continue

    const hasParticipantTableShape = row.slice(nameIndex + 1).some(cell => cell === 'email' || cell === 'role' || cell.includes('join') || cell.includes('leave'))
    const isFirstRowSimpleReport = rowIndex === 0 && row.some(Boolean)
    if (hasParticipantTableShape || isFirstRowSimpleReport || startIndex > 0) {
      return { rowIndex, nameIndex, header: row[nameIndex] }
    }
  }
  return null
}

function extractNamesFromMatrix(matrix, normalizedRows, headerRowIndex, nameIndex) {
  const seen = new Set()
  const names = []
  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || []
    const normalized = normalizedRows[rowIndex] || []
    const raw = String(row[nameIndex] ?? '').trim()
    if (!raw) continue
    const lower = normalized[nameIndex] || normalizeTeamsCell(raw)
    if (TEAMS_METADATA_KEYS.has(lower) || isParticipantsMarker(lower)) continue
    if (row.every(cell => !String(cell ?? '').trim())) continue
    if (seen.has(lower)) continue
    seen.add(lower)
    names.push(raw)
  }
  return names
}

function findMetadataValue(matrix, normalizedRows, key) {
  for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
    const row = normalizedRows[rowIndex]
    const index = row.findIndex(cell => cell === key)
    if (index >= 0) {
      const raw = String(matrix[rowIndex]?.[index + 1] ?? '').trim()
      if (raw) return raw
    }
  }
  return ''
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
