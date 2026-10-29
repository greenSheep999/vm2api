import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderCodexSessionSlots } from '../../src/lib/pool/codex-slot-pool.mjs'

const base = (id) => ({
  id,
  platform: 'openai',
  status: 'running',
  schedulable: true,
  has_token: true,
  proxy: { url: 'socks5://127.0.0.1:1080' },
  codex: { extra: { codex_5h_used_percent: 5, codex_7d_used_percent: 5 } },
})

test('缺票拦截：degraded 的号被排除，healthy 的留下', () => {
  const vms = [base('vm-a'), base('vm-b')]
  const verdicts = new Map([
    ['vm-a\u0000gpt-6-astra', 'degraded'],
    ['vm-b\u0000gpt-6-astra', 'healthy'],
  ])
  const out = orderCodexSessionSlots(vms, {
    model: 'gpt-6-astra',
    ticketGate: { enabled: true, verdicts },
  })
  assert.deepEqual(out.ids, ['vm-b'])
})

test('缺票拦截：未探针（无记录）不会被排除', () => {
  const vms = [base('vm-a'), base('vm-b')]
  const verdicts = new Map([['vm-a\u0000gpt-6-astra', 'degraded']])
  const out = orderCodexSessionSlots(vms, {
    model: 'gpt-6-astra',
    ticketGate: { enabled: true, verdicts },
  })
  assert.ok(out.ids.includes('vm-b'))
})

test('缺票拦截：全部不可用时回落，不把请求打死', () => {
  const vms = [base('vm-a')]
  const verdicts = new Map([['vm-a\u0000gpt-6-astra', 'degraded']])
  const out = orderCodexSessionSlots(vms, {
    model: 'gpt-6-astra',
    ticketGate: { enabled: true, verdicts },
  })
  assert.ok(out.ids.length > 0, '不应返回空池')
})
