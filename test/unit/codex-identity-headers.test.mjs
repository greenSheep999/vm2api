import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __codexKernelHeaders as build } from '../../src/lib/protocol/handle-codex.mjs'

test('客户端没发身份头时补默认值（否则上游不铸票）', () => {
  const h = build({}, { model: 'gpt-6-astra' }, null)
  assert.equal(h.originator, 'codex_cli_rs')
  assert.equal(h.version, '0.160.0')
  assert.equal(h['openai-beta'], 'responses=experimental')
})

test('客户端发什么就透传什么，不被默认值覆盖', () => {
  const h = build(
    {
      originator: 'Codex Desktop',
      version: '0.162.0',
      'openai-beta': 'responses=experimental',
      'session-id': 's-123',
      'x-codex-turn-state': 't-1',
    },
    { model: 'gpt-6-astra', service_tier: 'fast' },
    { session_id: 's-123' },
  )
  assert.equal(h.originator, 'Codex Desktop')
  assert.equal(h.version, '0.162.0')
  assert.equal(h['session-id'], 's-123')
  assert.equal(h['x-codex-turn-state'], 't-1')
  assert.match(h['x-codex-routing-hint'], /tier=fast/)
})

test('会话 id 来自解析结果时优先使用', () => {
  const h = build({}, { model: 'gpt-6-astra' }, { session_id: 'out-9' })
  assert.equal(h['session-id'], 'out-9')
})
