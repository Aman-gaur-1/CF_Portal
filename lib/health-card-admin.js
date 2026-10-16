export const HEALTH_COURSEWORK_TYPES = new Set(['assignment', 'project'])

export function normalizeHealthCourseworkType(value) {
  const type = String(value || '').trim().toLowerCase()
  return HEALTH_COURSEWORK_TYPES.has(type) ? type : ''
}

export function parseIsoDate(value) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const date = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return ''
  return text
}

export function parseDateTime(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const date = new Date(String(value).trim())
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function normalizeCourseworkPayload(body = {}, { partial = false } = {}) {
  const payload = {}
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = String(body.title || '').trim()
    if (!title || title.length > 240) return { error: 'Title is required and must be 240 characters or fewer.' }
    payload.title = title
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'itemType') || Object.prototype.hasOwnProperty.call(body, 'type')) {
    const itemType = normalizeHealthCourseworkType(body.itemType || body.type)
    if (!itemType) return { error: 'Type must be assignment or project.' }
    payload.item_type = itemType
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'batch')) {
    const batch = String(body.batch || '').trim()
    if (batch.length > 160) return { error: 'Batch is too long.' }
    payload.batch = batch || null
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'phase')) {
    const phase = String(body.phase || '').trim()
    if (phase.length > 160) return { error: 'Phase is too long.' }
    payload.phase = phase || null
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'dueAt')) {
    const dueAt = parseDateTime(body.dueAt)
    if (dueAt === '') return { error: 'Due date is invalid.' }
    payload.due_at = dueAt
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'active')) {
    if (typeof body.active !== 'boolean' && body.active !== undefined && body.active !== null) return { error: 'Active must be boolean.' }
    payload.active = body.active === undefined || body.active === null ? true : body.active
  }
  return { value: payload }
}

export function normalizeCalendarPayload(body = {}, { partial = false } = {}) {
  const payload = {}
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'batch')) {
    const batch = String(body.batch || '').trim()
    if (!batch || batch.length > 160) return { error: 'A valid batch is required.' }
    payload.batch = batch
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'calendarDate') || Object.prototype.hasOwnProperty.call(body, 'date')) {
    const calendarDate = parseIsoDate(body.calendarDate || body.date)
    if (!calendarDate) return { error: 'A valid calendar date is required.' }
    payload.calendar_date = calendarDate
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'isWorkingDay') || Object.prototype.hasOwnProperty.call(body, 'working')) {
    const value = body.isWorkingDay ?? body.working
    if (typeof value !== 'boolean') return { error: 'Working-day status must be boolean.' }
    payload.is_working_day = value
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'label')) {
    const label = String(body.label || '').trim()
    if (label.length > 160) return { error: 'Label is too long.' }
    payload.label = label || null
  }
  return { value: payload }
}

export function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message || '')
}
