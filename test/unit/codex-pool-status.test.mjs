import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codexAccountStatus } from '../../src/lib/pool/codex-slot-pool.mjs'

const base = {
  id: 'vm-test',
  platform: 'openai',
  status: 'running',
  schedulable: true,
  has_token: true,
  proxy: { url: 'socks5://127.0.0.1:1080' },
  codex: { extra: { codex_5h_used_percent: 10, codex_7d_used_percent: 10 } },
}

test('额度窗口打满 → quota_exhausted（不是 disabled）', () => {
  const vm = {
    ...base,
    codex: { extra: { codex_5h_used_percent: 100, codex_7d_used_percent: 20 } },
  }
  assert.equal(codexAccountStatus(vm, Date.now(), null), 'quota_exhausted')
})

test('额度正常 → normal', () => {
  assert.equal(codexAccountStatus(base, Date.now(), null), 'normal')
})

test('手动停调度 → disabled，与额度区分开', () => {
  const vm = { ...base, schedulable: false, schedule_disabled_reason: 'manual_stop' }
  assert.equal(codexAccountStatus(vm, Date.now(), null), 'disabled')
})

test('软闸门（额度 90% > 0.85 阈值）→ parked_gate，与真打满分开', () => {
  const vm = { ...base, codex: { extra: { codex_5h_used_percent: 90, codex_7d_used_percent: 10 } } }
  const policy = { limit_5h: 0.85, limit_7d: 0.85 }
  const status = codexAccountStatus(vm, Date.now(), policy)
  assert.notEqual(status, 'quota_exhausted')
})

import { orderCodexSessionSlots } from '../../src/lib/pool/codex-slot-pool.mjs'

test('全部额度打满时给出 retryAt = 最早窗口重置时间', () => {
  const resetAt = new Date(Date.now() + 3600_000).toISOString()
  const vm = {
    ...base,
    id: 'vm-q1',
    codex: {
      extra: {
        codex_5h_used_percent: 100,
        codex_7d_used_percent: 30,
        codex_5h_reset_at: resetAt,
      },
    },
  }
  const out = orderCodexSessionSlots([vm], { model: 'gpt-6-astra' })
  assert.equal(out.error, 'quota_exhausted')
  assert.ok(Number(out.retryAt) > Date.now(), 'retryAt 必须是未来时间')
  const deltaMin = Math.round((Number(out.retryAt) - Date.now()) / 60000)
  assert.ok(deltaMin >= 55 && deltaMin <= 61, `retryAt 应约等于 60 分钟后，实际 ${deltaMin} 分钟`)
})

test('额度打满且拿不到重置时间时，retryAt 退到 15 分钟而不是立刻重试', () => {
  const vm = {
    ...base,
    id: 'vm-q2',
    codex: { extra: { codex_5h_used_percent: 100, codex_7d_used_percent: 20 } },
  }
  const out = orderCodexSessionSlots([vm], { model: 'gpt-6-astra' })
  assert.equal(out.error, 'quota_exhausted')
  const deltaMin = Math.round((Number(out.retryAt) - Date.now()) / 60000)
  assert.ok(deltaMin >= 14 && deltaMin <= 16, `应约 15 分钟，实际 ${deltaMin}`)
})
