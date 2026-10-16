import assert from 'node:assert/strict'
import {
  HEALTH_CARD_EPOCH,
  getIndiaDateString,
  isUniqueViolation,
  normalizeHealthActivityType,
} from '../lib/student-health-card.js'

assert.equal(HEALTH_CARD_EPOCH, '2026-10-01')
assert.equal(getIndiaDateString(new Date('2026-09-30T18:29:59.000Z')), '2026-09-30')
assert.equal(getIndiaDateString(new Date('2026-09-30T18:30:00.000Z')), '2026-10-01')
assert.equal(normalizeHealthActivityType('project'), 'project')
assert.equal(normalizeHealthActivityType('200'), 'project')
assert.equal(normalizeHealthActivityType('100'), 'assignment')
assert.equal(normalizeHealthActivityType('50'), '')
assert.equal(isUniqueViolation({ code: '23505' }), true)
assert.equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint' }), true)

console.log('Student Health Card domain tests passed.')

