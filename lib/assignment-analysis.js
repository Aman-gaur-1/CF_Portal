export const ASSIGNMENT_PHASES = ['Python', 'SQL', 'Data Analytics', 'Power BI']
export const FINAL_PHASE_OVERRIDE_THRESHOLD = 0.9

const DATA_ANALYTICS_LANGUAGES = new Set(['Pandas', 'NumPy', 'Matplotlib', 'Seaborn'])

const SIGNALS = [
  { language: 'Power BI', phase: 'Power BI', signal: 'PBIX file', weight: 12, extensions: ['pbix'] },
  { language: 'Power BI', phase: 'Power BI', signal: 'DAX CALCULATE', weight: 8, pattern: /\bcalculate\s*\(/i },
  { language: 'Power BI', phase: 'Power BI', signal: 'DAX relationship function', weight: 7, pattern: /\b(?:related|all|filter)\s*\(/i },
  { language: 'Power BI', phase: 'Power BI', signal: 'DAX measure assignment', weight: 8, pattern: /\bmeasure\b[\s\S]{0,120}=|[A-Za-z_][\w\s]*=\s*(?:calculate|sum|average|count|distinctcount)\s*\(/i },
  { language: 'Power BI', phase: 'Power BI', signal: 'Power BI keyword', weight: 7, pattern: /\bpower\s*bi\b|\bdax\b|\bmeasure\b|\brelationship(?:s)?\b|\bdashboard\b|\bslicer\b|\bvisual(?:ization)?s?\b/i },

  { language: 'SQL', phase: 'SQL', signal: 'SQL file', weight: 10, extensions: ['sql'] },
  { language: 'SQL', phase: 'SQL', signal: 'SQL cell magic', weight: 12, pattern: /^\s*%%sql\b/im },
  { language: 'SQL', phase: 'SQL', signal: 'SELECT FROM', weight: 9, pattern: /\bselect\b[\s\S]{0,600}\bfrom\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'WITH CTE', weight: 7, pattern: /\bwith\s+[A-Za-z_]\w*\s+as\s*\(/i },
  { language: 'SQL', phase: 'SQL', signal: 'JOIN', weight: 6, pattern: /\bjoin\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'GROUP BY', weight: 6, pattern: /\bgroup\s+by\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'WHERE', weight: 4, pattern: /\bwhere\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'HAVING', weight: 4, pattern: /\bhaving\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'ORDER BY', weight: 4, pattern: /\border\s+by\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'INSERT', weight: 5, pattern: /\binsert\s+into\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'UPDATE', weight: 5, pattern: /\bupdate\s+[A-Za-z_]\w*\s+set\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'DELETE', weight: 5, pattern: /\bdelete\s+from\b/i },
  { language: 'SQL', phase: 'SQL', signal: 'CREATE TABLE', weight: 6, pattern: /\bcreate\s+table\b/i },

  { language: 'Pandas', phase: 'Data Analytics', signal: 'pandas import', weight: 9, pattern: /\bimport\s+pandas\b|\bfrom\s+pandas\b/i },
  { language: 'Pandas', phase: 'Data Analytics', signal: 'pandas alias', weight: 7, pattern: /\bpd\./ },
  { language: 'Pandas', phase: 'Data Analytics', signal: 'DataFrame', weight: 6, pattern: /\bDataFrame\b|\bSeries\b/i },
  { language: 'Pandas', phase: 'Data Analytics', signal: 'data loading', weight: 6, pattern: /\bread_csv\b|\bread_excel\b|\bto_csv\b|\bto_excel\b/i },
  { language: 'Pandas', phase: 'Data Analytics', signal: 'data aggregation/cleaning', weight: 5, pattern: /\bgroupby\b|\bvalue_counts\b|\bdropna\b|\bfillna\b|\bisnull\b|\bnotnull\b|\bpivot_table\b/i },
  { language: 'NumPy', phase: 'Data Analytics', signal: 'numpy import', weight: 8, pattern: /\bimport\s+numpy\b|\bfrom\s+numpy\b/i },
  { language: 'NumPy', phase: 'Data Analytics', signal: 'numpy alias', weight: 6, pattern: /\bnp\./ },
  { language: 'NumPy', phase: 'Data Analytics', signal: 'array operation', weight: 5, pattern: /\bndarray\b|\bnumpy\.|\barray\s*\(|\blinspace\b|\barange\b|\breshape\b/i },
  { language: 'Matplotlib', phase: 'Data Analytics', signal: 'matplotlib import', weight: 8, pattern: /\bimport\s+matplotlib\b|\bfrom\s+matplotlib\b|\bpyplot\b/i },
  { language: 'Matplotlib', phase: 'Data Analytics', signal: 'matplotlib plotting', weight: 6, pattern: /\bplt\.|\bfigure\s*\(|\bsubplot\b|\bscatter\s*\(|\bhist\s*\(|\bbar\s*\(|\bxlabel\b|\bylabel\b/i },
  { language: 'Seaborn', phase: 'Data Analytics', signal: 'seaborn import', weight: 8, pattern: /\bimport\s+seaborn\b|\bfrom\s+seaborn\b/i },
  { language: 'Seaborn', phase: 'Data Analytics', signal: 'seaborn plotting', weight: 6, pattern: /\bsns\.|\bheatmap\s*\(|\bpairplot\s*\(|\bcatplot\s*\(|\brelplot\s*\(|\bcountplot\s*\(/i },
  { language: 'Pandas', phase: 'Data Analytics', signal: 'data file', weight: 3, extensions: ['csv', 'xlsx', 'xls'] },

  { language: 'Python', phase: 'Python', signal: 'Python file', weight: 6, extensions: ['py'] },
  { language: 'Python', phase: 'Python', signal: 'function/class', weight: 6, pattern: /\bdef\s+[A-Za-z_]\w*\s*\(|\bclass\s+[A-Za-z_]\w*/ },
  { language: 'Python', phase: 'Python', signal: 'control flow', weight: 5, pattern: /\bfor\s+\w+\s+in\b|\bwhile\s+.+:|\bif\s+.+:|\belif\s+.+:|\belse\s*:|\btry\s*:|\bexcept\b/i },
  { language: 'Python', phase: 'Python', signal: 'print/input/import', weight: 4, pattern: /\bprint\s*\(|\binput\s*\(|\bimport\s+\w+|\bfrom\s+\w+\s+import\b/i },
  { language: 'Python', phase: 'Python', signal: 'assignment', weight: 3, pattern: /(^|[^=!<>])=[^=]/m },
]

const COMMENT_PREFIX_PATTERN = /^\s*(#|\/\/|--)\s?/
const QUESTION_PATTERN = /^\s*(?:#+\s*)?(?:(?:q|question|exercise|task)\s*)?(\d+)[\).:-]\s+(.+)/i
const NOTEBOOK_CELL_PATTERN = /^\s*#\s*Cell\s+(\d+)\s+\[(code|markdown)\]/i
const OUTPUT_PATTERN = /^\s*(?:output|result|answer)\s*[:=-]\s*(.+)$/i
const ERROR_PATTERN = /\b(?:traceback|error|exception|syntaxerror|typeerror|valueerror|nameerror|keyerror|indexerror)\b/i
const WARNING_PATTERN = /\bwarning\b|deprecated|futurewarning|userwarning/i
const PYTHON_FUNCTION_PATTERN = /\bdef\s+([A-Za-z_]\w*)\s*\(/g
const PYTHON_CLASS_PATTERN = /\bclass\s+([A-Za-z_]\w*)\b/g
const PYTHON_ASSIGNMENT_PATTERN = /(?:^|[^\w.])([A-Za-z_]\w*)\s*=(?!=)/g
const SQL_TABLE_PATTERN = /\b(?:from|join|into|update|table)\s+([A-Za-z_][\w.]*)/gi

export function normalizeAssignmentPhase(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!raw) return ''
  if (raw === 'python') return 'Python'
  if (raw === 'sql') return 'SQL'
  if (raw === 'power bi' || raw === 'powerbi') return 'Power BI'
  if (raw === 'data analytics' || raw === 'analytics' || DATA_ANALYTICS_LANGUAGES.has(String(value || '').trim())) {
    return 'Data Analytics'
  }
  return String(value || '').trim()
}

export function detectAssignmentLanguage({ text = '', fileName = '', topic = '' } = {}) {
  const source = [topic, fileName, text].filter(Boolean).join('\n')
  const ext = extensionFromName(fileName)
  const scores = new Map()
  const matchedSignals = []

  for (const signal of SIGNALS) {
    const extensionMatch = signal.extensions?.includes(ext)
    const patternMatch = signal.pattern?.test(source)
    if (!extensionMatch && !patternMatch) continue
    scores.set(signal.language, (scores.get(signal.language) || 0) + signal.weight)
    matchedSignals.push({
      language: signal.language,
      phase: signal.phase,
      signal: signal.signal,
      weight: signal.weight,
    })
  }

  const phaseScores = scoreByPhase(scores)
  const rankedPhases = [...phaseScores.entries()].sort((a, b) => b[1] - a[1])
  const [phase, phaseScore] = rankedPhases[0] || ['Unknown', 0]
  const topLanguage = topLanguageForPhase(scores, phase)
  const confidence = confidenceFromScores(phaseScore, rankedPhases[1]?.[1] || 0, matchedSignals.length)

  return {
    language: topLanguage,
    phase,
    confidence,
    confidence_percent: Math.round(confidence * 100),
    matched_signals: matchedSignals.slice(0, 12),
    evidence: matchedSignals.map(item => `${item.language}: ${item.signal}`).slice(0, 8),
  }
}

export function selectFinalEvaluationPhase({ selectedPhase, detectedPhase, detectionConfidence } = {}) {
  const selected = normalizeAssignmentPhase(selectedPhase) || 'Python'
  const detected = normalizeAssignmentPhase(detectedPhase)
  const confidence = normalizeConfidence(detectionConfidence)
  const shouldOverride = Boolean(detected && detected !== 'Unknown' && detected !== selected && confidence >= FINAL_PHASE_OVERRIDE_THRESHOLD)
  return {
    selected_phase: selected,
    detected_phase: detected || 'Unknown',
    final_evaluation_phase: shouldOverride ? detected : selected,
    confidence,
    confidence_percent: Math.round(confidence * 100),
    overridden: shouldOverride,
    reason: shouldOverride ? 'high_confidence_detection_mismatch' : 'selected_phase_retained',
  }
}

export function shouldSkipAiEvaluation(diagnostics = {}) {
  if (diagnostics.supported === false) {
    return {
      skip: true,
      reason: diagnostics.valid_json === false ? 'corrupted_notebook' : 'unsupported_file',
      message: diagnostics.valid_json === false
        ? 'The uploaded notebook is corrupted or not valid .ipynb JSON.'
        : 'This uploaded file type is not supported for AI evaluation.',
    }
  }
  if (diagnostics.valid_json === false) {
    return {
      skip: true,
      reason: 'corrupted_notebook',
      message: 'The uploaded notebook is corrupted or not valid .ipynb JSON.',
    }
  }
  return { skip: false, reason: '', message: '' }
}

export function phaseMatchesDetectedLanguage(selectedPhase, detected) {
  const selected = normalizeAssignmentPhase(selectedPhase)
  const detectedPhase = normalizeAssignmentPhase(detected?.phase || detected?.language)
  if (!selected || !detectedPhase || detectedPhase === 'Unknown') return true
  return selected === detectedPhase
}

export function detectAssignmentType({ text = '', fileName = '', topic = '', diagnostics = {} } = {}) {
  const source = [topic, fileName, text].filter(Boolean).join('\n').toLowerCase()
  const ext = diagnostics.extension || extensionFromName(fileName)
  if (ext === 'ipynb' || diagnostics.parser === 'ipynb') return 'Notebook Assignment'
  if (/\bsql\b/.test(source) && /\b(practice|exercise|query|queries)\b/.test(source)) return 'SQL Practice'
  if (/\b(data analytics|pandas|numpy|seaborn|matplotlib|eda|visualization|dataset|csv)\b/.test(source)) return 'Data Analytics Lab'
  if (/\bmini\s*project|project\b/.test(source)) return 'Mini Project'
  if (/\bhomework|assignment\b/.test(source)) return 'Homework'
  if (/\btheory|explain|describe|short answer|mcq|multiple choice\b/.test(source)) return 'Theory Assignment'
  if (/\bpractice|exercise\b/.test(source)) return 'Practice Exercise'
  return 'Practice Exercise'
}

export function parseAssignmentStructure({ text = '', diagnostics = {}, fileName = '', topic = '' } = {}) {
  const source = String(text || '')
  const lines = source.split(/\r?\n/)
  const questions = []
  const questionMap = []
  const executableCode = []
  const commentedCode = []
  const markdown = []
  const outputs = []
  const errors = []
  const warnings = []
  const emptyCells = []
  const notebookCells = []
  const variables = new Set()
  const functions = new Set()
  const tables = new Set()
  let currentCell = null
  let currentQuestion = null

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const cellMatch = line.match(NOTEBOOK_CELL_PATTERN)
    if (cellMatch) {
      currentCell = {
        id: `cell-${cellMatch[1]}`,
        number: Number(cellMatch[1]),
        type: cellMatch[2],
        startLine: lineNumber,
        has_executable_code: false,
        has_output: false,
      }
      notebookCells.push(currentCell)
      return
    }

    const questionMatch = line.match(QUESTION_PATTERN)
    if (questionMatch) {
      currentQuestion = {
        number: Number(questionMatch[1]),
        text: questionMatch[2].trim().slice(0, 240),
        line: lineNumber,
        student_answer: [],
        referenced_code: [],
        outputs: [],
        comments: [],
      }
      questions.push({ number: currentQuestion.number, text: currentQuestion.text, line: lineNumber })
      questionMap.push(currentQuestion)
    }

    const trimmed = line.trim()
    if (!trimmed) {
      if (currentCell && !currentCell.has_executable_code && !currentCell.has_output) {
        emptyCells.push({ cell: currentCell.number, line: lineNumber })
      }
      return
    }

    const outputMatch = line.match(OUTPUT_PATTERN)
    if (outputMatch) {
      const item = { line: lineNumber, cell: currentCell?.number || null, text: outputMatch[1].trim().slice(0, 500) }
      outputs.push(item)
      if (currentCell) currentCell.has_output = true
      if (currentQuestion) currentQuestion.outputs.push(item)
      return
    }

    if (ERROR_PATTERN.test(line)) {
      errors.push({ line: lineNumber, cell: currentCell?.number || null, text: trimmed.slice(0, 500) })
    }
    if (WARNING_PATTERN.test(line)) {
      warnings.push({ line: lineNumber, cell: currentCell?.number || null, text: trimmed.slice(0, 500) })
    }

    const uncommented = uncommentLine(line)
    if (uncommented && looksLikeCode(uncommented)) {
      const item = { line: lineNumber, cell: currentCell?.number || null, code: uncommented.slice(0, 500) }
      commentedCode.push(item)
      collectIdentifiers(uncommented, { variables, functions, tables })
      if (currentQuestion) currentQuestion.comments.push(item)
      return
    }

    if (!COMMENT_PREFIX_PATTERN.test(line) && looksLikeCode(line)) {
      const item = { line: lineNumber, cell: currentCell?.number || null, code: trimmed.slice(0, 500) }
      executableCode.push(item)
      collectIdentifiers(line, { variables, functions, tables })
      if (currentCell) currentCell.has_executable_code = true
      if (currentQuestion) currentQuestion.referenced_code.push(item)
      return
    }

    const markdownItem = { line: lineNumber, cell: currentCell?.number || null, text: trimmed.slice(0, 500) }
    if (currentCell?.type === 'markdown' || COMMENT_PREFIX_PATTERN.test(line) || /^[#*>-]/.test(trimmed)) {
      markdown.push(markdownItem)
      if (currentQuestion) currentQuestion.comments.push(markdownItem)
    } else if (currentQuestion) {
      currentQuestion.student_answer.push(markdownItem)
    }
  })

  const detected = detectAssignmentLanguage({ text: source, fileName, topic })
  const fileType = diagnostics.extension || extensionFromName(fileName) || diagnostics.parser || 'text'
  const assignmentType = detectAssignmentType({ text: source, fileName, topic, diagnostics })

  return {
    file_type: fileType,
    assignment_type: assignmentType,
    detected_language: detected.language,
    detected_phase: detected.phase,
    detection_confidence: detected.confidence,
    detection_confidence_percent: detected.confidence_percent,
    matched_signals: detected.matched_signals,
    detection_evidence: detected.evidence,
    questions,
    question_map: questionMap.map(item => ({
      ...item,
      student_answer: item.student_answer.slice(0, 12),
      referenced_code: item.referenced_code.slice(0, 20),
      outputs: item.outputs.slice(0, 10),
      comments: item.comments.slice(0, 12),
    })).slice(0, 40),
    student_answers: questionMap.map(item => ({
      question: item.number,
      text: item.student_answer.map(answer => answer.text).join('\n').slice(0, 500),
      line: item.line,
    })).filter(item => item.text).slice(0, 40),
    executable_code: executableCode.slice(0, 160),
    commented_code: commentedCode.slice(0, 160),
    markdown: markdown.slice(0, 100),
    outputs: outputs.slice(0, 80),
    errors: errors.slice(0, 40),
    warnings: warnings.slice(0, 40),
    empty_cells: emptyCells.slice(0, 80),
    notebook_cells: notebookCells,
    identifiers: {
      variables: [...variables].slice(0, 120),
      functions: [...functions].slice(0, 80),
      tables: [...tables].slice(0, 80),
    },
    counts: {
      questions: questions.length,
      question_mappings: questionMap.length,
      notebook_cells: notebookCells.length,
      executable_code_lines: executableCode.length,
      commented_code_lines: commentedCode.length,
      markdown_lines: markdown.length,
      outputs: outputs.length,
      errors: errors.length,
      warnings: warnings.length,
      empty_cells: emptyCells.length,
    },
    mostly_commented_code: commentedCode.length >= 2 && commentedCode.length > executableCode.length * 2,
  }
}

export function summarizeAssignmentStructure(structure = {}) {
  return JSON.stringify({
    file_type: structure.file_type || 'unknown',
    assignment_type: structure.assignment_type || 'Practice Exercise',
    detected_language: structure.detected_language || 'Unknown',
    detected_phase: structure.detected_phase || 'Unknown',
    detection_confidence: structure.detection_confidence ?? 0,
    detection_confidence_percent: structure.detection_confidence_percent ?? 0,
    matched_signals: structure.matched_signals || [],
    questions: (structure.questions || []).slice(0, 25),
    question_map: (structure.question_map || []).slice(0, 20),
    executable_code: (structure.executable_code || []).slice(0, 60),
    commented_code: (structure.commented_code || []).slice(0, 60),
    markdown: (structure.markdown || []).slice(0, 30),
    outputs: (structure.outputs || []).slice(0, 30),
    errors: (structure.errors || []).slice(0, 20),
    warnings: (structure.warnings || []).slice(0, 20),
    empty_cells: (structure.empty_cells || []).slice(0, 30),
    notebook_cells: structure.notebook_cells || [],
    identifiers: structure.identifiers || {},
    counts: structure.counts || {},
    mostly_commented_code: Boolean(structure.mostly_commented_code),
  }, null, 2)
}

export function validateGroundedReferences(text, { structure = {}, submissionText = '' } = {}) {
  const facts = factsFromStructure(structure, submissionText)
  const notes = []
  let next = String(text || '')
  if (!next) return { text: next, notes }

  next = next.replace(/\bCell\s+(\d+)\b/gi, (match, n) => {
    if (facts.cells.has(Number(n))) return match
    notes.push(`Removed unverified ${match}.`)
    return 'one of your later notebook cells'
  })

  next = next.replace(/\b(?:Question|Q)\s*(\d+)\b/gi, (match, n) => {
    if (facts.questions.has(Number(n))) return match
    notes.push(`Removed unverified ${match}.`)
    return 'one of the questions'
  })

  next = next.replace(/\b(variable|function|table|measure)\s+[`"']?([A-Za-z_][\w.]*)[`"']?/gi, (match, label, name) => {
    if (facts.names.has(name) || containsIdentifier(facts.source, name)) return match
    notes.push(`Generalized unverified ${label} ${name}.`)
    if (/function/i.test(label)) return 'one of your functions'
    if (/table/i.test(label)) return 'one of your tables'
    if (/measure/i.test(label)) return 'one of your measures'
    return 'one of your variable assignments'
  })

  return { text: next, notes }
}

function scoreByPhase(scores) {
  const phaseScores = new Map()
  for (const [language, score] of scores.entries()) {
    const phase = normalizeAssignmentPhase(language) || 'Unknown'
    phaseScores.set(phase, (phaseScores.get(phase) || 0) + score)
  }
  return phaseScores
}

function topLanguageForPhase(scores, phase) {
  const ranked = [...scores.entries()]
    .filter(([language]) => normalizeAssignmentPhase(language) === phase)
    .sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] || 'Unknown'
}

function confidenceFromScores(topScore, secondScore, signalCount) {
  if (!topScore) return 0
  const scoreConfidence = Math.min(1, topScore / 25)
  const marginConfidence = secondScore ? Math.min(1, (topScore - secondScore) / Math.max(topScore, 1)) : 1
  const signalConfidence = Math.min(1, signalCount / 5)
  return roundConfidence((scoreConfidence * 0.55) + (marginConfidence * 0.3) + (signalConfidence * 0.15))
}

function normalizeConfidence(value) {
  if (typeof value === 'string') {
    if (value === 'high') return 0.8
    if (value === 'medium') return 0.55
    if (value === 'low') return 0.3
    if (value === 'none') return 0
  }
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return number > 1 ? Math.min(1, number / 100) : Math.max(0, Math.min(1, number))
}

function roundConfidence(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function extensionFromName(fileName) {
  const base = String(fileName || '').split('?')[0].split('/').pop() || ''
  const idx = base.lastIndexOf('.')
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : ''
}

function uncommentLine(line) {
  const value = String(line || '').trim()
  if (!COMMENT_PREFIX_PATTERN.test(value)) return ''
  return value.replace(COMMENT_PREFIX_PATTERN, '').trim()
}

function looksLikeCode(line) {
  return SIGNALS.some(signal => signal.pattern?.test(line))
}

function collectIdentifiers(line, { variables, functions, tables }) {
  collectMatches(line, PYTHON_FUNCTION_PATTERN, functions)
  collectMatches(line, PYTHON_CLASS_PATTERN, functions)
  collectMatches(line, PYTHON_ASSIGNMENT_PATTERN, variables)
  collectMatches(line, SQL_TABLE_PATTERN, tables)
}

function collectMatches(line, pattern, target) {
  pattern.lastIndex = 0
  let match
  while ((match = pattern.exec(line))) {
    if (match[1]) target.add(match[1])
  }
}

function factsFromStructure(structure = {}, submissionText = '') {
  const cells = new Set((structure.notebook_cells || []).map(cell => Number(cell.number)).filter(Number.isFinite))
  const questions = new Set((structure.questions || []).map(question => Number(question.number)).filter(Number.isFinite))
  const identifiers = structure.identifiers || {}
  const names = new Set([
    ...(identifiers.variables || []),
    ...(identifiers.functions || []),
    ...(identifiers.tables || []),
  ].map(name => String(name || '').trim()).filter(Boolean))
  return { cells, questions, names, source: String(submissionText || '') }
}

function containsIdentifier(source, name) {
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(name)}([^A-Za-z0-9_]|$)`).test(source || '')
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
