import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recordUpstreamFailure, recordUpstreamSuccess, breakerState } from '../../src/lib/pool/upstream-breaker.mjs'

function tmpProject(vmId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breaker-'))
  fs.mkdirSync(path.join(dir, 'vms'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'vms', `${vmId}.json`),
    JSON.stringify({ id: vmId, claude: {}, schedulable: true }),
  )
  return dir
}

test('两次失败不触发停用', () => {
  const dir = tmpProject('vm-a')
  assert.equal(recordUpstreamFailure(dir, 'vm-a').tripped, false)
  assert.equal(recordUpstreamFailure(dir, 'vm-a').tripped, false)
  assert.equal(breakerState('vm-a').count, 2)
})

test('第三次失败触发停用并写入临时不可调度', () => {
  const dir = tmpProject('vm-b')
  recordUpstreamFailure(dir, 'vm-b')
  recordUpstreamFailure(dir, 'vm-b')
  const r = recordUpstreamFailure(dir, 'vm-b')
  assert.equal(r.tripped, true)
  const vm = JSON.parse(fs.readFileSync(path.join(dir, 'vms', 'vm-b.json'), 'utf8'))
  assert.equal(vm.temp_unschedulable_reason, 'upstream_closed_before_content')
  assert.ok(vm.temp_unschedulable_until > Date.now())
})

test('成功一次清零计数', () => {
  const dir = tmpProject('vm-c')
  recordUpstreamFailure(dir, 'vm-c')
  recordUpstreamFailure(dir, 'vm-c')
  recordUpstreamSuccess('vm-c')
  assert.equal(breakerState('vm-c').count, 0)
})
