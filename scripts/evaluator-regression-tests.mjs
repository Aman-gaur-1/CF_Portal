import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = process.cwd()
const analysis = loadAnalysisModule()

const {
  detectAssignmentLanguage,
  parseAssignmentStructure,
  selectFinalEvaluationPhase,
  shouldSkipAiEvaluation,
  validateGroundedReferences,
} = analysis

const cases = [
  ['Python assignment', () => {
    const detected = detectAssignmentLanguage({ text: 'def total(items):\n    for item in items:\n        print(item)', fileName: 'loops.py' })
    assert.equal(detected.phase, 'Python')
    assert.ok(detected.confidence > 0.5)
  }],
  ['SQL assignment', () => {
    const detected = detectAssignmentLanguage({ text: 'SELECT c.name, SUM(o.total) FROM customers c JOIN orders o ON c.id=o.customer_id WHERE o.total > 100 GROUP BY c.name ORDER BY 2 DESC;', fileName: 'query.sql' })
    assert.equal(detected.phase, 'SQL')
    assert.ok(detected.confidence >= 0.9)
    assert.ok(detected.matched_signals.some(signal => signal.signal === 'JOIN'))
  }],
  ['Mixed notebook prefers Data Analytics', () => {
    const detected = detectAssignmentLanguage({ text: '# Cell 1 [code]\nimport pandas as pd\nimport seaborn as sns\nimport matplotlib.pyplot as plt\ndf = pd.read_csv("sales.csv")\nsns.heatmap(df.corr())', fileName: 'lab.ipynb' })
    assert.equal(detected.phase, 'Data Analytics')
  }],
  ['Commented notebook tracks commented code', () => {
    const structure = parseAssignmentStructure({ text: '# Cell 1 [code]\n# print(a)\n# for item in items:\n#     print(item)', fileName: 'commented.ipynb' })
    assert.equal(structure.mostly_commented_code, true)
    assert.equal(structure.executable_code.length, 0)
    assert.ok(structure.commented_code.length >= 2)
  }],
  ['Power BI assignment', () => {
    const detected = detectAssignmentLanguage({ text: 'Create Power BI dashboard relationships and DAX measure Sales = CALCULATE(SUM(Orders[Amount]))', fileName: 'brief.txt' })
    assert.equal(detected.phase, 'Power BI')
    assert.ok(detected.confidence >= 0.75)
  }],
  ['Data Analytics assignment', () => {
    const detected = detectAssignmentLanguage({ text: 'import numpy as np\nimport pandas as pd\ndf = pd.read_csv("data.csv")\ndf.groupby("city").mean()', fileName: 'analysis.py' })
    assert.equal(detected.phase, 'Data Analytics')
  }],
  ['Markdown-heavy notebook', () => {
    const structure = parseAssignmentStructure({ text: '# Cell 1 [markdown]\n## Theory\nExplain why joins are useful.\n# Cell 2 [markdown]\nAnswer: joins combine tables.', fileName: 'theory.ipynb' })
    assert.equal(structure.assignment_type, 'Notebook Assignment')
    assert.equal(structure.counts.notebook_cells, 2)
  }],
  ['TXT submission detects SQL', () => {
    const detected = detectAssignmentLanguage({ text: 'WITH totals AS (SELECT customer_id, SUM(amount) amount FROM sales GROUP BY customer_id) SELECT * FROM totals WHERE amount > 500', fileName: 'answer.txt' })
    assert.equal(detected.phase, 'SQL')
  }],
  ['IPYNB SQL magic', () => {
    const detected = detectAssignmentLanguage({ text: '# Cell 1 [code]\n%%sql\nSELECT region, COUNT(*) FROM sales GROUP BY region HAVING COUNT(*) > 2', fileName: 'sql-lab.ipynb' })
    assert.equal(detected.phase, 'SQL')
    assert.ok(detected.confidence >= 0.9)
  }],
  ['Corrupted notebook skip', () => {
    const skip = shouldSkipAiEvaluation({ parser: 'ipynb', supported: false, valid_json: false })
    assert.equal(skip.skip, true)
    assert.equal(skip.reason, 'corrupted_notebook')
  }],
  ['Unsupported file skip', () => {
    const skip = shouldSkipAiEvaluation({ parser: 'unsupported', supported: false, extension: 'zip' })
    assert.equal(skip.skip, true)
    assert.equal(skip.reason, 'unsupported_file')
  }],
  ['Wrong phase selection warning basis', () => {
    const detected = detectAssignmentLanguage({ text: 'SELECT * FROM students WHERE score > 80', fileName: 'answer.sql' })
    const decision = selectFinalEvaluationPhase({ selectedPhase: 'Python', detectedPhase: detected.phase, detectionConfidence: 0.72 })
    assert.equal(decision.final_evaluation_phase, 'Python')
    assert.equal(decision.overridden, false)
  }],
  ['High-confidence language mismatch overrides', () => {
    const decision = selectFinalEvaluationPhase({ selectedPhase: 'Python', detectedPhase: 'SQL', detectionConfidence: 0.97 })
    assert.equal(decision.final_evaluation_phase, 'SQL')
    assert.equal(decision.overridden, true)
  }],
  ['Hallucination validation generalizes unverified facts', () => {
    const structure = parseAssignmentStructure({ text: '# Cell 1 [code]\ndef total_score():\n    result = 1\nQ1. Use a function', fileName: 'work.ipynb' })
    const result = validateGroundedReferences('Cell 9 has function missing_func and variable student_name in Question 4.', {
      structure,
      submissionText: 'def total_score():\n    result = 1\nQ1. Use a function',
    })
    assert.match(result.text, /one of your later notebook cells/)
    assert.match(result.text, /one of your functions/)
    assert.match(result.text, /one of your variable assignments/)
    assert.match(result.text, /one of the questions/)
    assert.ok(result.notes.length >= 4)
  }],
]

let passed = 0
for (const [name, run] of cases) {
  run()
  passed += 1
  console.log(`ok - ${name}`)
}
console.log(`\n${passed} evaluator regression tests passed.`)

function loadAnalysisModule() {
  const file = path.join(root, 'lib', 'assignment-analysis.js')
  const source = fs.readFileSync(file, 'utf8')
  const exported = [...source.matchAll(/export function (\w+)|export const (\w+)/g)]
    .map(match => match[1] || match[2])
  const transformed = source
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
  const sandbox = { console, module: { exports: {} } }
  vm.runInNewContext(`${transformed}\nmodule.exports = { ${exported.join(', ')} };`, sandbox)
  return sandbox.module.exports
}
