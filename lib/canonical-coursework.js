export const CANONICAL_PHASES = Object.freeze(['Python', 'Data Analytics', 'SQL'])

const phase = (name, assignments, projects) => [
  ...assignments.map((title, index) => ({
    canonicalKey: `${name === 'Data Analytics' ? 'data_analytics' : name.toLowerCase()}_assignment_${String(index + 1).padStart(2, '0')}`,
    phase: name,
    itemType: 'assignment',
    title,
    sortOrder: index + 1,
  })),
  ...projects.map((title, index) => ({
    canonicalKey: `${name === 'Data Analytics' ? 'data_analytics' : name.toLowerCase()}_project_${String(index + 1).padStart(2, '0')}`,
    phase: name,
    itemType: 'project',
    title,
    sortOrder: index + 1,
  })),
]

export const CANONICAL_CURRICULUM = Object.freeze([
  ...phase('Python', [
    'Data Type & Variables',
    'Operators Assignment',
    'User Input & Type Casting',
    'Functions - Basic Assignments',
    'String Assignments',
    'Conditional Statements Assignments',
    'Loops Assignments',
    'List Assignments',
    'Set Assignments',
    'Dictionary Assignments',
    'Function - Advance Assignments',
  ], [
    'ATM Functionalities',
    'Guess the Number Game',
    'Weather Data Analyzer',
    'YouTube Comment Analysis Project',
  ]),
  ...phase('Data Analytics', [
    'NumPy Operations',
    'Multidimensional Array in NumPy',
    'Loading Excel and CSV Data',
    'DataFrame and Series',
    'Series Operations In Pandas',
    'Filtering',
    'Sorting Value in Pandas',
    'Aggregate Functions',
    'value_counts() and groupby()',
    'datetime in pandas',
    'UDF',
    'String Function In Pandas',
    'Data Cleaning in Pandas',
    'Matplotlib For Data Visualization',
  ], [
    'Gold Layer Practice Questions',
  ]),
  ...phase('SQL', [
    'Database Creation',
    'DDL and DML Commands',
    'Operators, Distinct and Sorting',
    'Group By, Aggregate Functions & Having Clause',
    'String Functions',
    'Date and Time Functions',
    'Truncate and Numeric Functions',
    'Joins',
    'Set Operations',
    'Variables and Table Variables',
    'Views and Triggers',
    'Transactions and Exception Handling',
    'Subqueries',
    'Scalar and Table Valued Functions',
    'Constraints',
    'Window Functions, Moving Average and CTE',
  ], [
    'FoodieHub Data Analytics',
  ]),
])

export const CANONICAL_BY_KEY = Object.freeze(Object.fromEntries(CANONICAL_CURRICULUM.map(item => [item.canonicalKey, item])))

export function normalizeCanonicalText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.(py|ipynb|txt|md|csv|docx?)$/i, '')
    .replace(/^[\s]*(?:assignment\s*:\s*)?\d+\s*(?:->|[-:.])\s*/i, '')
    .replace(/&/g, ' and ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9()]+/g, ' ')
    .replace(/\bassignments?\b/g, 'assignment')
    .replace(/\s+/g, ' ')
    .trim()
}

export const CANONICAL_ALIASES = Object.freeze([
  ['List Assignment', 'python_assignment_08'],
  ['List Assignments', 'python_assignment_08'],
  ['Lists assignment', 'python_assignment_08'],
  ['List - Assignments', 'python_assignment_08'],
  ['DataFrame and Series', 'data_analytics_assignment_04'],
  ['data frame and series', 'data_analytics_assignment_04'],
  ['DataFrames and Series', 'data_analytics_assignment_04'],
  ['Pandas-Data frame and Series Assignment', 'data_analytics_assignment_04'],
  ['Filtering assignment', 'data_analytics_assignment_06'],
  ['Filtering Assignments.', 'data_analytics_assignment_06'],
  ['Pandas-Filtering Assignment', 'data_analytics_assignment_06'],
  ['Operators, Distinct & Sorting', 'sql_assignment_03'],
  ['Operators, Distinct & Sorting Assignment', 'sql_assignment_03'],
  ['OPERATOR,DISTINCT & SORTING', 'sql_assignment_03'],
  ['ATM', 'python_project_01'],
  ['ATM Functionality', 'python_project_01'],
  ['ATM functionalities', 'python_project_01'],
  ['Guess Number', 'python_project_02'],
  ['Guess the Number', 'python_project_02'],
  ['Guess Number Game', 'python_project_02'],
  ['Weather Analyzer', 'python_project_03'],
  ['Weather Data Analyzer', 'python_project_03'],
  ['Gold Layer Practice', 'data_analytics_project_01'],
  ['Gold Layer Practice Questions', 'data_analytics_project_01'],
  ['FoodieHub', 'sql_project_01'],
  ['FoodieHub Data Analytics', 'sql_project_01'],
])

export const CANONICAL_AUTHORITATIVE_OVERRIDES = Object.freeze([
  ['ADVANCE_FUNCTION_ASSIGNMENTS', 'python_assignment_11'],
  ['advance function', 'python_assignment_11'],
  ['advanced function', 'python_assignment_11'],
  ['advance functions', 'python_assignment_11'],
  ['advanced functions', 'python_assignment_11'],
  ['basic function', 'python_assignment_04'],
  ['basic functions', 'python_assignment_04'],
  ['Conditional Statements - Assignments', 'python_assignment_06'],
  ['data type', 'python_assignment_01'],
  ['data types', 'python_assignment_01'],
  ['Data Type & Variable', 'python_assignment_01'],
  ['data type and variable', 'python_assignment_01'],
  ['data types & variables', 'python_assignment_01'],
  ['variable', 'python_assignment_01'],
  ['variables', 'python_assignment_01'],
  ['Dictionary - Assignments', 'python_assignment_10'],
  ['function', 'python_assignment_04'],
  ['functions', 'python_assignment_04'],
  ['functions basic', 'python_assignment_04'],
  ['List Assignment', 'python_assignment_08'],
  ['Loop assigment', 'python_assignment_07'],
  ['loop', 'python_assignment_07'],
  ['loops', 'python_assignment_07'],
  ['loop assignment', 'python_assignment_07'],
  ['loops assignment', 'python_assignment_07'],
  ['Operates', 'python_assignment_02'],
  ['Set Assignment', 'python_assignment_09'],
  ['String Assignments', 'python_assignment_05'],
  ['type casting', 'python_assignment_03'],
  ['User Input & Type Casting', 'python_assignment_03'],
  ['user input', 'python_assignment_03'],
  ['user inputs', 'python_assignment_03'],
  ['user input & type casting', 'python_assignment_03'],
  ['Operators, Distinct & Sorting Assignments', 'sql_assignment_03'],
  ['SQL Views and Triggers Assignment', 'sql_assignment_11'],
  ['SQL Date and Time Assignment', 'sql_assignment_06'],
  ['SQL Group By, Aggregate Functions & Having Clause', 'sql_assignment_04'],
  ['SQL Join Assignment', 'sql_assignment_08'],
  ['SQL Set Operations Assignment', 'sql_assignment_09'],
  ['SQL String Assignment', 'sql_assignment_05'],
  ['SQL Truncate and Numeric Functions Assignment', 'sql_assignment_07'],
  ['SQL Variables & Table Variables Assignment', 'sql_assignment_10'],
])

export function canonicalCounts(items = CANONICAL_CURRICULUM) {
  return CANONICAL_PHASES.reduce((result, phaseName) => {
    result[phaseName] = {
      assignments: items.filter(item => item.phase === phaseName && item.itemType === 'assignment').length,
      projects: items.filter(item => item.phase === phaseName && item.itemType === 'project').length,
    }
    return result
  }, {})
}
