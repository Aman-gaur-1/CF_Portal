const TEAMS_SUFFIXES = /\s*\((unverified|external|guest|organizer|presenter)\)\s*$/i

export const MATCH_TYPES = Object.freeze({
  ALIAS: 'alias',
  EXACT: 'exact',
  HIGH_CONFIDENCE: 'high_confidence',
  SUGGESTED: 'suggested',
  AMBIGUOUS: 'ambiguous',
  UNMATCHED: 'unmatched',
})

export const MATCH_THRESHOLDS = Object.freeze({
  highConfidence: 0.86,
  suggestion: 0.55,
  ambiguityGap: 0.06,
})

export function stripParticipantSuffix(name) {
  return String(name || '').replace(TEAMS_SUFFIXES, '').trim()
}

export function normalizeParticipantName(name) {
  return stripParticipantSuffix(name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeParticipantName(name) {
  return normalizeParticipantName(name).split(' ').filter(Boolean)
}

function tokenKey(name) {
  return tokenizeParticipantName(name).sort().join(' ')
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m

  let previous = Array.from({ length: n + 1 }, (_, index) => index)
  let current = new Array(n + 1)
  for (let row = 1; row <= m; row += 1) {
    current[0] = row
    for (let column = 1; column <= n; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      )
    }
    ;[previous, current] = [current, previous]
  }
  return previous[n]
}

export function participantSimilarity(left, right) {
  const a = normalizeParticipantName(left)
  const b = normalizeParticipantName(right)
  if (!a || !b) return 0
  if (a === b) return 1

  const characterSimilarity = 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  const tokenLeft = tokenKey(left)
  const tokenRight = tokenKey(right)
  const tokenSimilarity = 1 - levenshtein(tokenLeft, tokenRight) / Math.max(tokenLeft.length, tokenRight.length, 1)
  return Math.max(characterSimilarity, tokenSimilarity)
}

function studentView(student) {
  return {
    id: student.id,
    name: student.name,
    batch: student.batch,
    normalizedName: normalizeParticipantName(student.name),
  }
}

function aliasView(alias) {
  return {
    id: alias.id,
    studentId: alias.student_id || alias.studentId,
    batch: alias.batch,
    alias: alias.alias,
    normalizedAlias: alias.normalized_alias || alias.normalizedAlias || normalizeParticipantName(alias.alias),
    active: alias.active !== false,
  }
}

function result(type, student, score, reason, extra = {}) {
  return {
    type,
    student: student || null,
    score: Number.isFinite(score) ? Math.round(score * 10000) / 10000 : 0,
    reason,
    ...extra,
  }
}

export function matchParticipantName({ participantName, students = [], aliases = [], thresholds = MATCH_THRESHOLDS }) {
  const normalized = normalizeParticipantName(participantName)
  if (!normalized) return result(MATCH_TYPES.UNMATCHED, null, 0, 'The participant name is empty.')

  const studentViews = students.map(studentView).filter(student => student.id && student.normalizedName)
  const activeAliases = aliases
    .map(aliasView)
    .filter(alias => alias.active && alias.batch !== undefined && alias.normalizedAlias)
    .filter(alias => alias.batch === undefined || studentViews.some(student => String(student.id) === String(alias.studentId)))

  const aliasCandidates = activeAliases.filter(alias => alias.normalizedAlias === normalized)
  const aliasStudentIds = [...new Set(aliasCandidates.map(alias => String(alias.studentId)))]
  if (aliasStudentIds.length > 1) {
    return result(MATCH_TYPES.AMBIGUOUS, null, 1, 'This identity alias belongs to more than one student.', { candidates: aliasCandidates })
  }
  if (aliasStudentIds.length === 1) {
    const student = studentViews.find(candidate => String(candidate.id) === aliasStudentIds[0])
    if (student) return result(MATCH_TYPES.ALIAS, student, 1, 'Trusted identity alias.')
  }

  const exactCandidates = studentViews.filter(student => student.normalizedName === normalized)
  if (exactCandidates.length > 1) {
    return result(MATCH_TYPES.AMBIGUOUS, null, 1, 'More than one registered student has this normalized name.', { candidates: exactCandidates })
  }
  if (exactCandidates.length === 1) {
    return result(MATCH_TYPES.EXACT, exactCandidates[0], 1, 'Exact normalized name match.')
  }

  const tokenMatches = studentViews.filter(student => tokenKey(student.name) === tokenKey(participantName))
  if (tokenMatches.length > 1) {
    return result(MATCH_TYPES.AMBIGUOUS, null, 0.99, 'The name tokens match more than one registered student.', { candidates: tokenMatches })
  }
  if (tokenMatches.length === 1) {
    return result(MATCH_TYPES.HIGH_CONFIDENCE, tokenMatches[0], 0.98, 'Name tokens match after normalization.')
  }

  const ranked = studentViews
    .map(student => ({ student, score: participantSimilarity(participantName, student.name) }))
    .sort((left, right) => right.score - left.score || String(left.student.id).localeCompare(String(right.student.id)))
  const best = ranked[0]
  if (!best || best.score < thresholds.suggestion) {
    return result(MATCH_TYPES.UNMATCHED, best?.student || null, best?.score || 0, 'No registered student is a safe match.', {
      suggestedStudent: best?.student || null,
    })
  }

  const second = ranked[1]
  if (second && best.score - second.score < thresholds.ambiguityGap) {
    return result(MATCH_TYPES.AMBIGUOUS, null, best.score, 'Two registered students are similarly close matches.', {
      candidates: ranked.slice(0, 3).map(candidate => ({ ...candidate.student, score: candidate.score })),
    })
  }

  if (best.score >= thresholds.highConfidence) {
    return result(MATCH_TYPES.HIGH_CONFIDENCE, best.student, best.score, 'Strong unique spelling match.')
  }
  return result(MATCH_TYPES.SUGGESTED, best.student, best.score, 'Possible spelling match; review before linking.')
}

export function matchNamesToStudents(fileNames, students, aliases = []) {
  const matched = []
  const uncertain = []
  const unmatched = []

  for (const fileName of fileNames) {
    const match = matchParticipantName({ participantName: fileName, students, aliases })
    const base = {
      fileName,
      studentId: match.student?.id || null,
      studentName: match.student?.name || null,
      confidence: match.type === MATCH_TYPES.ALIAS ? 'alias' : match.type === MATCH_TYPES.EXACT ? 'exact' : match.type === MATCH_TYPES.HIGH_CONFIDENCE ? 'high' : match.type === MATCH_TYPES.SUGGESTED ? 'low' : 'none',
      similarity: match.score,
      type: match.type,
      reason: match.reason,
    }

    if ([MATCH_TYPES.ALIAS, MATCH_TYPES.EXACT, MATCH_TYPES.HIGH_CONFIDENCE].includes(match.type) && match.student) {
      matched.push(base)
    } else if ([MATCH_TYPES.SUGGESTED, MATCH_TYPES.AMBIGUOUS].includes(match.type)) {
      uncertain.push({ ...base, candidates: match.candidates || [] })
    } else {
      unmatched.push({
        ...base,
        bestMatch: match.suggestedStudent ? { studentId: match.suggestedStudent.id, studentName: match.suggestedStudent.name, similarity: match.score } : null,
      })
    }
  }

  return { matched, uncertain, unmatched }
}
