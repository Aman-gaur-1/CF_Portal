import {
  BADGE_LEVELS,
  MILESTONES,
  calculateLifetimeCoursework,
  getBadge,
  getCourseworkPoints,
  getNextMilestone,
  normalizeCourseworkType,
} from './coursework-scoring'

export async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password.trim())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Sanitize filename by removing unsafe characters
 */
export function sanitizeFilename(text) {
  return (text || '').trim().replace(/\s+/g, '_').replace(/[^\w\-.]/g, '') || 'unknown'
}

/**
 * Check if file type is allowed for upload
 * @param {File} file - The file to check
 * @returns {boolean} - Whether the file is allowed
 */
export function isFileAllowed(file) {
  // Check file size (10MB limit)
  if (file.size > 10 * 1024 * 1024) {
    return false;
  }

  // Allowed file extensions
  const allowedExtensions = [
    'py', 'txt', 'md', 'json', 'html', 'ipynb', 
    'js', 'ts', 'jsx', 'tsx', 'csv', 'pdf', 'docx'
  ];

  // Get file extension
  const extension = file.name.split('.').pop().toLowerCase();
  
  // Check if extension is allowed
  if (!allowedExtensions.includes(extension)) {
    return false;
  }

  // Check MIME type for additional security
  const allowedMimeTypes = [
    'text/plain',
    'text/html',
    'text/csv',
    'application/json',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/x-python-code',
    'text/x-python',
    'application/javascript',
    'text/javascript',
    'text/markdown',
    'application/octet-stream' // for .py files sometimes
  ];

  // Block dangerous MIME types
  const blockedMimeTypes = [
    'application/x-msdownload',
    'application/x-msdos-program',
    'application/x-executable',
    'application/x-sh',
    'application/x-shellscript',
    'text/x-shellscript',
    'application/x-perl',
    'application/x-ruby',
    'application/x-php',
    'application/x-python',
    'text/python'
  ];

  // If MIME type is blocked, reject
  if (blockedMimeTypes.includes(file.type)) {
    return false;
  }

  return true;
}

/**
 * Get user-friendly error message for file validation
 * @param {File} file - The file to check
 * @returns {string|null} - Error message or null if file is valid
 */
export function getFileValidationError(file) {
  // Check file size
  if (file.size > 10 * 1024 * 1024) {
    return 'File size exceeds 10MB limit';
  }

  // Check file extension
  const allowedExtensions = [
    'py', 'txt', 'md', 'json', 'html', 'ipynb', 
    'js', 'ts', 'jsx', 'tsx', 'csv', 'pdf', 'docx'
  ];
  
  const extension = file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    return `File type .${extension} is not allowed`;
  }

  // Check dangerous MIME types
  const blockedMimeTypes = [
    'application/x-msdownload',
    'application/x-msdos-program',
    'application/x-executable',
    'application/x-sh',
    'application/x-shellscript',
    'text/x-shellscript',
    'application/x-perl',
    'application/x-ruby',
    'application/x-php'
  ];

  if (blockedMimeTypes.includes(file.type)) {
    return 'File type is not allowed for security reasons';
  }

  return null;
}

export function getPoints(subType) {
  return getCourseworkPoints(subType)
}

export function getTypeLabel(subType) {
  if (subType === 'project' || subType === '200') return 'Project'
  if (subType === 'assignment' || subType === '100') return 'Assignment'
  if (subType === '50' || subType === '20' || subType === 'custom') return 'Legacy coursework'
  if (typeof subType === 'string' && /^[0-9]+$/.test(subType)) return 'Legacy coursework'
  return 'Assignment'
}

export function getTypeEmoji(subType) {
  if (subType === 'project' || subType === '200') return '🚀'
  if (subType === 'assignment' || subType === '100') return '📝'
  if (subType === '50') return '✨'
  if (subType === '20') return '⚡'
  if (subType === 'custom') return '🔧'
  if (typeof subType === 'string' && /^[0-9]+$/.test(subType)) return '🔢'
  return '📝'
}

export function calcPhaseScores(submissions) {
  return submissions.reduce((acc, sub) => {
    const phase = sub.phase || 'Unassigned'
    acc[phase] = (acc[phase] || 0) + getCourseworkPoints(sub.submission_type)
    return acc
  }, {})
}

export {
  BADGE_LEVELS,
  MILESTONES,
  calculateLifetimeCoursework,
  getBadge,
  getCourseworkPoints,
  getNextMilestone,
  normalizeCourseworkType,
}

export function getPhasesInOrder(submissions) {
  const seen = new Set(), phases = []
  for (const sub of [...submissions].reverse()) {
    const p = sub.phase || 'Unassigned'
    if (!seen.has(p)) { phases.push(p); seen.add(p) }
  }
  return phases
}

export const BROWSER_RENDERABLE = new Set(['pdf','html','png','jpg','jpeg','gif','svg','txt','py'])

export function formatDate(iso) {
  return iso ? iso.slice(0, 10) : '—'
}
