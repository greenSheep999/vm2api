import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldBustSession } from '../../src/lib/pool/cache-controller.mjs'

test('打散比例为 0 时永不打散', () => {
  assert.equal(shouldBustSession('k1', 's1', 0), false)
})

test('打散比例为 1000 时全部打散', () => {
  assert.equal(shouldBustSession('k1', 's1', 1000), true)
})

test('同一会话的采样结论稳定（不会忽打忽不打）', () => {
  const a = shouldBustSession('k1', 'session-a', 400)
  for (let i = 0; i < 20; i++) assert.equal(shouldBustSession('k1', 'session-a', 400), a)
})

test('不同 key 的同一会话可以落在不同桶', () => {
  const results = new Set()
  for (let i = 0; i < 50; i++) results.add(shouldBustSession(`key-${i}`, 'same-session', 500))
  assert.equal(results.size, 2)
})
