import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer } from '../../src/lib/admin/iq-questions.mjs'

test('数值题答对判 pass', () => {
  const q = { judge_rule: 'numeric_pass', expected: '21' }
  assert.equal(judgeAnswer(q, '所以是 21 个').verdict, 'pass')
})

test('数值题答错判 fail 并带上答案', () => {
  const q = { judge_rule: 'numeric_pass', expected: '21' }
  const r = judgeAnswer(q, '29')
  assert.equal(r.verdict, 'fail')
  assert.equal(r.answer, 29)
  assert.equal(r.expected, 21)
})

test('未校准的题只记录', () => {
  assert.equal(judgeAnswer({ judge_rule: 'record_only' }, '24').verdict, 'recorded')
})

test('结构题门槛对齐 sub：SVG≥1、path≥10、text≥3', () => {
  const rich = '<svg>' + '<path d="M0 0"/>'.repeat(12) + '<text>甲</text><text>乙</text><text>丙</text></svg>'
  assert.equal(judgeAnswer({ judge_rule: 'structure' }, rich).verdict, 'structure_ok')
  // 只有一个圆圈不算达标的动画作品
  assert.equal(judgeAnswer({ judge_rule: 'structure' }, '<svg><circle/></svg>').verdict, 'structure_missing')
  assert.equal(judgeAnswer({ judge_rule: 'structure' }, '抱歉我不能').verdict, 'structure_missing')
})

test('没有题目时不抛错', () => {
  assert.equal(judgeAnswer(null, '1').verdict, 'unknown_question')
})
