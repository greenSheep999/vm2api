/**
 * 缓存实验台：测命中率、看命中率随空闲间隔的变化、按套餐给策略。
 *
 * 背景（实测数据）：
 *   pro    空闲 ≤1 分钟 命中 89%，>1 分钟掉到 54%
 *   prolite  ≤1 分钟 85%
 *   plus     ≤1 分钟 61%，1–6 小时只剩 31%
 *
 * 所以「缓存比例」不是一个能直接设定的数值，而是由这三个东西决定的：
 *   1. 请求之间的空闲间隔（上游前缀缓存的滚动窗口很短）
 *   2. 会话是否被钉在同一个账号（换号即丢缓存）
 *   3. prompt_cache_key / metadata 是否逐轮变化（变则前缀不连续）
 *
 * 这里提供两件事：
 *   - cacheStats: 用真实流量按「套餐 × 空闲间隔」统计命中率
 *   - runCacheTest: 主动造一串请求验证某个套餐/槽位在给定间隔下的命中率
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as dbModule from '../db/database.mjs'
import { getDb } from '../db/database.mjs'
import { listVms } from '../vm/vm-registry.mjs'
import { openWsTurn } from '../transport/codex-ws-direct.mjs'

const GAP_BUCKETS = [
  ['0-1min', 0, 60],
  ['1-5min', 60, 300],
  ['5-15min', 300, 900],
  ['15-60min', 900, 3600],
  ['1-6h', 3600, 21600],
  ['>6h', 21600, Infinity],
]

function bucketOf(gapSeconds) {
  for (const [name, lo, hi] of GAP_BUCKETS) {
    if (gapSeconds >= lo && gapSeconds < hi) return name
  }
  return '>6h'
}

/** 槽位 → 套餐（pro / prolite / plus） */
export function slotPlans(projectRoot) {
  const plan = new Map()
  for (const vm of listVms(projectRoot) || []) {
    if (!vm?.id) continue
    plan.set(vm.id, vm.codex?.plan_type || vm.plan_type || 'unknown')
  }
  return plan
}

/**
 * 用真实流量统计「套餐 × 空闲间隔」的命中率。
 * @returns {{ buckets: Array<{plan:string,bucket:string,samples:number,hitRatio:number}>, slots: Array }}
 */
export function cacheStats(projectRoot, { hours = 12, keyId = null } = {}) {
  const plan = slotPlans(projectRoot)
  const conn = getDb()
  const windowArg = `-${Math.max(1, Math.min(168, hours))} hours`
  const rows = conn
    .prepare(
      `SELECT vm_id, api_key_id, session_id, created_at,
              COALESCE(cache_read_tokens,0) AS cache_read,
              COALESCE(input_tokens,0) AS input_tokens,
              first_token_ms
         FROM usage_logs
        WHERE datetime(replace(created_at,'T',' ')) > datetime('now', ?)
          AND session_id IS NOT NULL
          ${keyId ? 'AND api_key_id = ?' : ''}
        ORDER BY api_key_id, session_id, created_at`,
    )
    .all(...(keyId ? [windowArg, keyId] : [windowArg]))

  const buckets = new Map()
  const slots = new Map()
  const keys = new Map()
  const prev = new Map()

  for (const row of rows) {
    const vm = row.vm_id || 'unknown'
    const slotPlan = plan.get(vm) || 'unknown'
    const t = Date.parse(row.created_at)
    const key = `${row.api_key_id || '-'}\u0000${row.session_id}\u0000${vm}`
    const total = (row.cache_read || 0) + (row.input_tokens || 0)

    const slotAgg = slots.get(vm) || { plan: slotPlan, samples: 0, cache: 0, total: 0, ttftSum: 0, ttftN: 0 }
    slotAgg.samples += 1
    if (Number(row.first_token_ms) > 0) { slotAgg.ttftSum += Number(row.first_token_ms); slotAgg.ttftN += 1 }
    slotAgg.cache += row.cache_read || 0
    slotAgg.total += total
    slots.set(vm, slotAgg)

    const keyAgg = keys.get(row.api_key_id || '-') || { samples: 0, cache: 0, total: 0, ttftSum: 0, ttftN: 0 }
    keyAgg.samples += 1
    keyAgg.cache += row.cache_read || 0
    keyAgg.total += total
    if (Number(row.first_token_ms) > 0) { keyAgg.ttftSum += Number(row.first_token_ms); keyAgg.ttftN += 1 }
    keys.set(row.api_key_id || '-', keyAgg)

    const last = prev.get(key)
    if (last != null && Number.isFinite(t)) {
      const gap = Math.max(0, (t - last) / 1000)
      const bucket = bucketOf(gap)
      const agg = buckets.get(`${slotPlan}\u0000${bucket}`) || { samples: 0, cache: 0, total: 0 }
      agg.samples += 1
      agg.cache += row.cache_read || 0
      agg.total += total
      buckets.set(`${slotPlan}\u0000${bucket}`, agg)
    }
    prev.set(key, t)
  }

  const bucketRows = []
  for (const [k, agg] of buckets) {
    const [slotPlan, bucket] = k.split('\u0000')
    bucketRows.push({
      plan: slotPlan,
      bucket,
      samples: agg.samples,
      hitRatio: agg.total ? agg.cache / agg.total : 0,
    })
  }
  const order = GAP_BUCKETS.map(([name]) => name)
  bucketRows.sort((a, b) => a.plan.localeCompare(b.plan) || order.indexOf(a.bucket) - order.indexOf(b.bucket))

  const slotRows = [...slots.entries()]
    .map(([id, agg]) => ({
      vmId: id,
      plan: agg.plan,
      samples: agg.samples,
      hitRatio: agg.total ? agg.cache / agg.total : 0,
      avgTtftMs: agg.ttftN ? Math.round(agg.ttftSum / agg.ttftN) : null,
    }))
    .sort((a, b) => b.samples - a.samples)

  // 按 key 汇总（keyName 从 api_keys 补）
  const names = new Map()
  try {
    for (const r of conn.prepare('SELECT id, name FROM api_keys').all()) names.set(r.id, r.name)
  } catch {}
  const keyRows = [...keys.entries()]
    .map(([id, agg]) => ({
      keyId: id,
      keyName: names.get(id) || id,
      samples: agg.samples,
      hitRatio: agg.total ? agg.cache / agg.total : 0,
      avgTtftMs: agg.ttftN ? Math.round(agg.ttftSum / agg.ttftN) : null,
    }))
    .sort((a, b) => b.samples - a.samples)

  return { bucketRows, slotRows, keyRows, hours }
}

function readToken(projectRoot, vmId) {
  try {
    const file = path.join(projectRoot, 'vms', vmId, 'codex-credentials.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const account = Array.isArray(raw?.accounts) ? raw.accounts[0] : null
    return account?.access_token || null
  } catch {
    return null
  }
}

/**
 * 主动缓存测试：同一个会话连发 count 发（每发之间等 gapMs），
 * 每发都带同一段大前缀，返回每发的缓存读取量与 TTFT。
 */
/** 面板用的策略形状：允许换号 / 粘性分钟 / 目标命中率 / 强制续接。 */
export function normalizeKeyCachePolicy(policy) {
  const p = policy && typeof policy === 'object' ? policy : {}
  return {
    allow_migration: p.allow_migration !== false,
    sticky_minutes: Math.max(1, Math.min(120, Number(p.sticky_minutes) || 10)),
    target_ratio: Math.max(0, Math.min(1, Number(p.target_ratio) || 0.8)),
    force_continue: p.force_continue === true,
    target_ratio: Math.max(0, Math.min(1, Number(p.target_ratio) || 0)),
    cache_retention: ['in_memory', '24h'].includes(p.cache_retention) ? p.cache_retention : '24h',
  }
}

/** 内部守卫用的形状（block_migration / max_idle_seconds）。 */
export function toGuardPolicy(policy) {
  const p = normalizeKeyCachePolicy(policy)
  return {
    block_migration: p.allow_migration === false,
    max_idle_seconds: p.sticky_minutes * 60,
    target_ratio: p.target_ratio,
    force_continue: p.force_continue,
  }
}

/** 列出所有 key 及其缓存策略（未配置的给出默认值）。 */
export function listKeyCachePolicies() {
  const { getDb } = dbModule
  const conn = getDb()
  const rows = conn
    .prepare('SELECT id, name, group_type, cache_policy FROM api_keys ORDER BY name')
    .all()
  return rows.map((r) => {
    let parsed = null
    try {
      parsed = r.cache_policy ? JSON.parse(r.cache_policy) : null
    } catch {}
    return {
      keyId: r.id,
      keyName: r.name,
      groupType: r.group_type || null,
      configured: parsed != null,
      policy: normalizeKeyCachePolicy(parsed),
    }
  })
}

export async function runCacheTest({
  projectRoot,
  keyId,
  vmId = null,
  model = 'gpt-6-astra',
  rounds = 3,
  prefixParagraphs = 48,
  intervalMs = 1000,
  maxOutputTokens = 256,
  effort = null,
  timeoutSec = 120,
  port = Number(process.env.PORT) || 8787,
}) {
  if (!keyId) return { ok: false, reason: 'key_id_required' }
  const { getDb } = await import('../db/database.mjs')
  const rec = getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(keyId)
  if (!rec) return { ok: false, reason: 'key_not_found' }
  const { plainApiKey } = await import('./api-keys.mjs')
  const plain = plainApiKey(rec)
  if (!plain) return { ok: false, reason: 'key_secret_unavailable' }

  const paragraphs = Math.max(1, Math.min(400, Number(prefixParagraphs) || 48))
  const prefix = Array.from({ length: paragraphs }, (_, i) =>
    `Paragraph ${i + 1}: The quick brown fox jumps over the lazy dog while the pelican watches the tide roll in. ` +
    'This sentence exists only to occupy a stable prefix so prompt caching can be observed across rounds.',
  ).join('\n\n')
  const totalRounds = Math.max(1, Math.min(10, Number(rounds) || 3))
  const results = []

  for (let i = 1; i <= totalRounds; i++) {
    if (i > 1 && intervalMs > 0) await new Promise((r) => setTimeout(r, Math.min(120_000, intervalMs)))
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(10, Number(timeoutSec) || 120) * 1000)
    try {
      const payload = {
        model,
        input: `${prefix}\n\nRound ${i}: reply with exactly OK.`,
        stream: false,
        max_output_tokens: Number(maxOutputTokens) || 256,
      }
      if (effort) payload.reasoning = { effort }
      const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${plain}`,
          'content-type': 'application/json',
          ...(vmId ? { 'x-kin-vm': vmId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const body = await res.json().catch(() => ({}))
      const usage = body?.usage || {}
      const input = Number(usage?.input_tokens) || 0
      const cached = Number(usage?.input_tokens_details?.cached_tokens) || 0
      const output = Number(usage?.output_tokens) || 0
      const text = extractResponseText(body)
      results.push({
        round: i,
        status: res.status,
        vmId: body?.vm_id || null,
        inputTokens: input,
        cachedTokens: cached,
        cacheWriteTokens: Number(usage?.input_tokens_details?.cache_write_tokens) || 0,
        outputTokens: output,
        hitRatio: cached + input > 0 ? cached / (cached + input) : 0,
        textSnippet: text.slice(0, 120),
        totalMs: Date.now() - startedAt,
      })
    } catch (error) {
      results.push({ round: i, status: 0, error: String(error?.name === 'AbortError' ? 'timeout' : error?.message || error) })
    } finally {
      clearTimeout(timer)
    }
  }

  const completed = results.filter((r) => r.status === 200)
  const first = completed[0] || null
  const repeats = completed.slice(1)
  const avg = (list, key) => (list.length ? list.reduce((a, b) => a + (b[key] || 0), 0) / list.length : 0)
  return {
    ok: completed.length === totalRounds,
    keyId,
    model,
    prefixParagraphs: paragraphs,
    rounds: totalRounds,
    intervalMs,
    results,
    summary: {
      firstHitRatio: first?.hitRatio ?? null,
      repeatHitRatio: repeats.length ? avg(repeats, 'hitRatio') : null,
      cacheReadTokens: completed.reduce((a, b) => a + (b.cachedTokens || 0), 0),
      completedRounds: completed.length,
    },
  }
}

function extractResponseText(body) {
  try {
    const out = body?.output
    if (!Array.isArray(out)) return ''
    const parts = []
    for (const item of out) {
      for (const c of item?.content || []) {
        if (typeof c?.text === 'string') parts.push(c.text)
      }
    }
    return parts.join('')
  } catch {
    return ''
  }
}
