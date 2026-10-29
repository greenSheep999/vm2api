import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  expectedTurnStateBlocks,
  expectedTurnStateLength,
  judgeTurnState,
  parseTurnState,
  isTeamPlan,
} from '../../src/lib/protocol/turn-state.mjs'

/** 造一张指定块数的合法票；块数与时间戳可调，用于覆盖判定分支。 */
function makeTicket(blocks, { magic = 0x80, issued = Math.floor(Date.now() / 1000) } = {}) {
  const raw = Buffer.alloc(57 + 16 * blocks)
  raw[0] = magic
  raw.writeBigUInt64BE(BigInt(issued), 1)
  return raw.toString('base64url')
}

test('解析个人版 10 块票', () => {
  const parsed = parseTurnState(makeTicket(10))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.blocks, 10)
})

test('套餐期望块数：Team 系 12 块', () => {
  assert.equal(expectedTurnStateBlocks('plus'), 10)
  assert.equal(expectedTurnStateBlocks('pro'), 10)
  assert.equal(expectedTurnStateBlocks(null), 10)
  assert.equal(expectedTurnStateBlocks('team'), 12)
  assert.equal(expectedTurnStateBlocks('self_serve_business_prolite'), 12)
  assert.equal(expectedTurnStateBlocks('Enterprise'), 12)
  assert.equal(isTeamPlan('business'), true)
})

test('期望长度：10 块 290、12 块 332（base64url 无填充）', () => {
  assert.equal(expectedTurnStateLength(10), 292)
  assert.equal(makeTicket(10).length, 290)
  assert.equal(makeTicket(12).length, 332)
})

test('恰好等于期望才判 ok', () => {
  assert.equal(judgeTurnState(makeTicket(10), 'plus').verdict, 'ok')
  assert.equal(judgeTurnState(makeTicket(12), 'team').verdict, 'ok')
})

test('块数不足判 short，块数超出判 tall（不再和 ok 混淆）', () => {
  assert.equal(judgeTurnState(makeTicket(10), 'team').verdict, 'short')
  const tall = judgeTurnState(makeTicket(12), 'plus')
  assert.equal(tall.verdict, 'tall')
  assert.equal(tall.blocks, 12)
})

test('无票、乱码、信封错误分别归类', () => {
  assert.equal(judgeTurnState('', 'plus').verdict, 'absent')
  assert.equal(judgeTurnState('abc', 'plus').verdict, 'malformed')
  assert.equal(judgeTurnState(makeTicket(10, { magic: 0x81 }), 'plus').verdict, 'malformed')
  const shortRaw = Buffer.alloc(57 + 16 * 10 - 1)
  shortRaw[0] = 0x80
  assert.equal(judgeTurnState(shortRaw.toString('base64url'), 'plus').verdict, 'malformed')
})

test('时间戳越界判 malformed', () => {
  assert.equal(judgeTurnState(makeTicket(10, { issued: 1000 }), 'plus').verdict, 'malformed')
})

test('含空白字符的票直接拒绝（防止头注入）', () => {
  const t = makeTicket(10)
  assert.equal(judgeTurnState(`${t} x`, 'plus').verdict, 'malformed')
  assert.equal(judgeTurnState(`${t}\n`, 'plus').verdict, 'ok')
})
