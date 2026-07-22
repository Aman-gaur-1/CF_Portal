const PYTHON_KEYWORDS = [
  'import',
  'from',
  'def',
  'class',
  'for',
  'while',
  'if',
  'elif',
  'else',
  'return',
  'print',
  'input',
  'try',
  'except',
  'with',
]

const CODE_LINE_PATTERN = /\b(import\s+\w+|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+|for\s+\w+\s+in\b|while\s+.+:|if\s+.+:|elif\s+.+:|else\s*:|return\b|print\s*\(|input\s*\(|try\s*:|except\b|with\s+open\b|pd\.|np\.|read_csv|read_excel|DataFrame|Series)\b|(^|[^=!<>])=[^=]/i
const COMMENTED_CODE_PATTERN = /^\s*(?:#+|\/\/)\s*(?:\d+[\).:-]?\s*)?(?:>>>?\s*)?(?:import\s+\w+|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+|for\s+\w+\s+in\b|while\s+.+:|if\s+.+:|elif\s+.+:|else\s*:|return\b|print\s*\(|input\s*\(|try\s*:|except\b|with\s+open\b|[A-Za-z_]\w*\s*=|pd\.|np\.|read_csv|read_excel|DataFrame|Series)/i
const ASSIGNMENT_ANSWER_PATTERN = /^\s*(?:#+\s*)?(?:q(?:uestion)?\s*)?\d+[\).:-]\s+.+/i

export function analyzePythonSignals(text, { maxMatches = 8 } = {}) {
  const source = String(text || '')
  const lines = source.split('\n')
  const codeMatches = []
  const commentedCodeMatches = []
  const assignmentAnswerMatches = []
  let codeCharacters = 0
  let commentedCodeCharacters = 0
  let assignmentAnswerCharacters = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const uncommented = uncommentEducationalLine(trimmed)
    const lineForCode = uncommented || trimmed

    if (CODE_LINE_PATTERN.test(lineForCode)) {
      codeCharacters += lineForCode.length
      pushMatch(codeMatches, lineForCode, maxMatches)
    }

    if (COMMENTED_CODE_PATTERN.test(trimmed) || (isCommentLine(trimmed) && CODE_LINE_PATTERN.test(uncommented))) {
      commentedCodeCharacters += lineForCode.length
      pushMatch(commentedCodeMatches, trimmed, maxMatches)
    }

    if (ASSIGNMENT_ANSWER_PATTERN.test(trimmed)) {
      assignmentAnswerCharacters += trimmed.length
      pushMatch(assignmentAnswerMatches, trimmed, maxMatches)
    }
  }

  const concepts = detectConceptsFromText(source)
  return {
    codeCharacters,
    commentedCodeCharacters,
    assignmentAnswerCharacters,
    codeMatches,
    commentedCodeMatches,
    assignmentAnswerMatches,
    concepts,
    hasCodeSignals: codeCharacters > 0,
    hasCommentedCode: commentedCodeCharacters > 0,
    hasAssignmentAnswers: assignmentAnswerCharacters > 0,
  }
}

export function countPythonCodeCharacters(text) {
  return analyzePythonSignals(text, { maxMatches: 0 }).codeCharacters
}

export function hasPythonCodeSignals(text) {
  return analyzePythonSignals(text, { maxMatches: 0 }).hasCodeSignals
}

export function detectConceptsFromText(text) {
  const source = normalizeCommentedCodeForDetection(text)
  const lower = source.toLowerCase()
  const concepts = []

  addConcept(concepts, 'loops', /\b(for|while)\b/.test(lower))
  addConcept(concepts, 'lists', /\[[^\]]*\]|\b(list|append|extend|insert|pop|remove|sort|reverse)\s*\(/.test(lower))
  addConcept(concepts, 'dictionaries', /\{[^}]*:|\.keys\s*\(|\.values\s*\(|\.items\s*\(|\bdict\s*\(/.test(lower))
  addConcept(concepts, 'functions', /\bdef\s+[A-Za-z_]\w*\s*\(/.test(source))
  addConcept(concepts, 'classes/OOP', /\bclass\s+[A-Za-z_]\w*|\bself\.|\b__init__\b|\binheritance\b/.test(source))
  addConcept(concepts, 'conditions', /\b(if|elif|else)\b|==|!=|<=|>=|<|>/.test(lower))
  addConcept(concepts, 'string operations', /\b(str|split|join|strip|lower|upper|replace|find|startswith|endswith|isalpha|isdigit|format)\s*\(/.test(lower) || /f['"`]/.test(source))
  addConcept(concepts, 'menu-driven logic', /\b(menu|choice|option|select|press|enter your choice)\b/.test(lower))
  addConcept(concepts, 'user input', /\binput\s*\(/.test(lower))
  addConcept(concepts, 'print/output statements', /\bprint\s*\(/.test(lower))
  addConcept(concepts, 'file handling', /\b(open|read|write|readlines|writelines)\s*\(|\bwith\s+open\b|\.txt\b|\.csv\b|\.xlsx\b/.test(lower))
  addConcept(concepts, 'error handling', /\btry\s*:|\bexcept\b|\bfinally\s*:|\braise\s+/.test(lower))
  addConcept(concepts, 'pandas', /\bimport\s+pandas\b|\bfrom\s+pandas\b|\bpd\.|\bDataFrame\b|\bSeries\b|read_csv|read_excel|to_csv|to_excel|groupby|value_counts|dropna|fillna|isnull|notnull/.test(source))
  addConcept(concepts, 'numpy', /\bimport\s+numpy\b|\bfrom\s+numpy\b|\bnp\.|\bndarray\b|\barray\s*\(/.test(source))
  addConcept(concepts, 'matplotlib', /\bimport\s+matplotlib\b|\bfrom\s+matplotlib\b|\bplt\.|\bpyplot\b|figure\s*\(|subplot|scatter\s*\(|hist\s*\(|bar\s*\(/.test(source))
  addConcept(concepts, 'seaborn', /\bimport\s+seaborn\b|\bfrom\s+seaborn\b|\bsns\.|heatmap\s*\(|pairplot\s*\(|catplot\s*\(|relplot\s*\(|countplot\s*\(/.test(source))
  addConcept(concepts, 'sql', /\bselect\s+.+\s+from\b|\bjoin\b|\bwhere\b|\bgroup\s+by\b|\bhaving\b|\border\s+by\b/i.test(source))
  addConcept(concepts, 'power bi', /\bpower\s*bi\b|\bdax\b|\bcalculate\s*\(|\bmeasure\b|\brelationship(?:s)?\b|\bdashboard\b/i.test(source))

  return concepts
}

export function normalizeCommentedCodeForDetection(text) {
  return String(text || '')
    .split('\n')
    .map(line => uncommentEducationalLine(line) || line)
    .join('\n')
}

function uncommentEducationalLine(line) {
  const value = String(line || '').trim()
  if (!isCommentLine(value)) return ''
  return value
    .replace(/^\s*(?:#+|\/\/)\s*/, '')
    .replace(/^\d+[\).:-]?\s*/, '')
    .replace(/^>>>?\s*/, '')
    .trim()
}

function isCommentLine(line) {
  return /^\s*(?:#+|\/\/)/.test(line || '')
}

function pushMatch(matches, line, maxMatches) {
  if (matches.length >= maxMatches) return
  matches.push(String(line || '').trim().slice(0, 160))
}

function addConcept(concepts, label, present) {
  if (present) concepts.push(label)
}
