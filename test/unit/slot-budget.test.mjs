import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotOverBudget } from '../../src/lib/pool/slot-budget.mjs'

test('未配置上限时不拦截', () => {
  assert.equal(slotOverBudget(null, 'vm-a', { limitUsd: 0 }), false)
})

test('没有数据库时按 0 成本处理，不拦截', () => {
  assert.equal(slotOverBudget(null, 'vm-a', { limitUsd: 10 }), false)
})
