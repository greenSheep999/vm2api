/**
 * 上游断路：连续「连接建好后一个字节都不给就断开」的槽位会被临时停用。
 *
 * 为什么需要它：调度器原本只看账号是否可调度、额度是否够，不看「最近是不是
 * 一直被上游掐断」。结果是某个号已经 100% 失败，流量仍然往上打，用户侧看到
 * 连续 502（error_code=codex_upstream / upstream_closed_before_content）。
 *
 * 规则：同一槽位 10 分钟内累计 3 次该错误 → 停用 10 分钟；成功后清零。
 */
import fs from 'node:fs'
import path from 'node:path'
import { markVmRestriction } from '../oauth/oauth-credentials.mjs'

const WINDOW_MS = 10 * 60_000
const THRESHOLD = 3
const PARK_MS = 10 * 60_000
const REASON = 'upstream_closed_before_content'

const state = new Map()

function key(vmId) {
  return String(vmId || '')
}

/** 记一次失败；达到阈值就把槽位临时停用。 */
export function recordUpstreamFailure(projectRoot, vmId) {
  if (!projectRoot || !vmId) return { tripped: false, count: 0 }
  const now = Date.now()
  const prev = state.get(key(vmId)) || { count: 0, firstAt: now, lastAt: now }
  const fresh = now - prev.firstAt > WINDOW_MS
  const next = {
    count: (fresh ? 0 : prev.count) + 1,
    firstAt: fresh ? now : prev.firstAt,
    lastAt: now,
  }
  state.set(key(vmId), next)
  if (next.count < THRESHOLD) return { tripped: false, count: next.count }
  state.set(key(vmId), { count: 0, firstAt: now, lastAt: now })
  try {
    const file = path.join(projectRoot, 'vms', `${vmId}.json`)
    if (!fs.existsSync(file)) return { tripped: false, count: next.count }
    markVmRestriction(file, { until: now + PARK_MS, reason: REASON })
  } catch {}
  return { tripped: true, count: next.count }
}

/** 成功一次就清零，避免「历史失败」把好槽位误停。 */
export function recordUpstreamSuccess(vmId) {
  if (!vmId) return
  state.delete(key(vmId))
}

export function breakerState(vmId) {
  return state.get(key(vmId)) || { count: 0, firstAt: null, lastAt: null }
}
