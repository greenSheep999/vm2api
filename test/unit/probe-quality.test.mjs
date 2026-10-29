import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderByProbeQuality, readProbeVerdicts } from '../../src/lib/pool/probe-quality.mjs'

test('healthy 排前，未知居中，降智垫底，同档保持原顺序', () => {
  const verdicts = new Map([
    ['b', 'degraded'],
    ['c', 'healthy'],
  ])
  assert.deepEqual(orderByProbeQuality(['a', 'b', 'c', 'd'], verdicts), ['c', 'a', 'd', 'b'])
})

test('没有探针数据时保持原顺序', () => {
  assert.deepEqual(orderByProbeQuality(['x', 'y', 'z'], new Map()), ['x', 'y', 'z'])
})

test('单元素与空数组安全', () => {
  assert.deepEqual(orderByProbeQuality([], new Map()), [])
  assert.deepEqual(orderByProbeQuality(['only'], new Map()), ['only'])
})

test('路由漂移与无票也算差档', () => {
  const verdicts = new Map([
    ['p', 'route_changed'],
    ['q', 'no_ticket'],
    ['r', 'healthy_same'],
  ])
  assert.deepEqual(orderByProbeQuality(['p', 'q', 'r'], verdicts), ['r', 'p', 'q'])
})

test('readProbeVerdicts 对空输入直接返回空表', () => {
  assert.equal(readProbeVerdicts([]).size, 0)
  assert.equal(readProbeVerdicts(null).size, 0)
})
