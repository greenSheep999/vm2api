import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeCapabilityAnswer } from '../../src/lib/admin/ticket-harvest.mjs'

test('糖果题答 21 判通过', () => {
  const r = judgeCapabilityAnswer('candy', '因此最少取出 21 个。')
  assert.equal(r.answer, 21)
  assert.equal(r.verdict, 'pass')
})

test('糖果题答 29 判失败（这正是旧号的表现）', () => {
  const r = judgeCapabilityAnswer('candy', '最少取出：29 个')
  assert.equal(r.verdict, 'fail')
  assert.equal(r.expected, 21)
})

test('没有数字时判 no_answer', () => {
  const r = judgeCapabilityAnswer('candy', '无法确定')
  assert.equal(r.answer, null)
  assert.equal(r.verdict, 'no_answer')
})

test('未校准的题只记录不判分', () => {
  const r = judgeCapabilityAnswer('poker', '24')
  assert.equal(r.answer, 24)
  assert.equal(r.expected, null)
  assert.equal(r.verdict, 'recorded')
})

test('未知题号不抛错', () => {
  assert.equal(judgeCapabilityAnswer('nope', '1').verdict, 'unknown_question')
})
