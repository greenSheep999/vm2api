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
