import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCodexRouting } from '../../src/lib/protocol/codex-route.mjs'

test('overflow_to_any_plan 默认关闭', () => {
  const r = normalizeCodexRouting({})
  assert.equal(r.ticket.overflow_to_any_plan, false)
})

test('显式关闭后仍为 false', () => {
  const r = normalizeCodexRouting({ ticket: { overflow_to_any_plan: false } })
  assert.equal(r.ticket.overflow_to_any_plan, false)
})

test('显式打开才为 true', () => {
  const r = normalizeCodexRouting({ ticket: { overflow_to_any_plan: true } })
  assert.equal(r.ticket.overflow_to_any_plan, true)
})
