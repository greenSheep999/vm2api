/**
 * 缓存配比闭环控制。
 *
 * 命中率不是能直接设的值，但可以按会话采样：把一部分会话主动打散
 * （每轮换 prompt_cache_key），命中率就会按比例下降。
 *
 *   bust_permille = 300  → 约 30% 的会话被打散
 *   实测命中率 82% 而目标 70% → 提高 bust_permille
 *
 * 打散是有代价的：那部分会话前缀缓存失效，TTFT 从几秒涨到几十秒。
 */
import { getDb } from '../db/database.mjs'

const STATE_TTL_MS = 60_000
const stateCache = new Map()

function nowIso() {
  return new Date().toISOString()
}

/** 读某 key 的打散比例（内存缓存 60 秒，避免热路径打库）。 */
export function bustPermilleFor(keyId) {
  if (!keyId) return 0
  const cached = stateCache.get(keyId)
  if (cached && Date.now() - cached.at < STATE_TTL_MS) return cached.value
  let value = 0
  try {
    const row = getDb().prepare('SELECT bust_permille FROM cache_control_state WHERE key_id = ?').get(keyId)
    value = Number(row?.bust_permille) || 0
  } catch {}
  stateCache.set(keyId, { value, at: Date.now() })
  return value
}

/** 稳定的会话采样：同一个 session 每次都得到同一个结论，避免一会儿打散一会儿不打。 */
export function shouldBustSession(keyId, sessionKey, permille) {
  if (!permille || permille <= 0) return false
  if (permille >= 1000) return true
  const seed = `${keyId}\u0000${sessionKey || ''}`
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash % 1000 < permille
}

/** 读该 key 的策略目标（没有配置返回 null）。 */
export function targetRatioFor(keyId) {
  try {
    const row = getDb().prepare('SELECT cache_policy FROM api_keys WHERE id = ?').get(keyId)
    if (!row?.cache_policy) return null
    const parsed = JSON.parse(row.cache_policy)
    const target = Number(parsed?.target_ratio)
    if (!Number.isFinite(target) || target <= 0) return null
    return Math.max(0, Math.min(1, target))
  } catch {
    return null
  }
}

/**
 * 闭环调整：对比最近窗口实测命中率与目标，按误差调整打散比例。
 * 每次调用处理所有配置了目标值的 key。
 */
export function runCacheControlTick({ windowMinutes = 30 } = {}) {
  const conn = getDb()
  const keys = conn
    .prepare("SELECT id, cache_policy FROM api_keys WHERE cache_policy IS NOT NULL AND deleted_at IS NULL")
    .all()
  const adjusted = []
  for (const key of keys) {
    let target = null
    try {
      target = Number(JSON.parse(key.cache_policy)?.target_ratio)
    } catch {}
    if (!Number.isFinite(target) || target <= 0) continue
    const agg = conn
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(cache_read_tokens), 0) AS cache,
                COALESCE(SUM(input_tokens), 0) AS input
           FROM usage_logs
          WHERE api_key_id = ?
            AND datetime(replace(created_at,'T',' ')) > datetime('now', ?)`,
      )
      .get(key.id, `-${Math.max(5, Math.min(180, windowMinutes))} minutes`)
    const total = (agg?.cache || 0) + (agg?.input || 0)
    if (!total || (agg?.n || 0) < 5) continue
    const measured = (agg.cache || 0) / total
    const prev = Number(
      conn.prepare('SELECT bust_permille FROM cache_control_state WHERE key_id = ?').get(key.id)?.bust_permille || 0,
    )
    let next = prev
    const gap = measured - target
    if (gap > 0.05) next = prev + Math.min(150, Math.round(gap * 400))
    else if (gap < -0.05) next = prev - Math.min(150, Math.round(-gap * 600))
    next = Math.max(0, Math.min(1000, next))
    conn
      .prepare(
        `INSERT INTO cache_control_state (key_id, bust_permille, measured_ratio, samples, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key_id) DO UPDATE SET
           bust_permille = excluded.bust_permille,
           measured_ratio = excluded.measured_ratio,
           samples = excluded.samples,
           updated_at = excluded.updated_at`,
      )
      .run(key.id, next, measured, agg.n || 0, nowIso())
    stateCache.set(key.id, { value: next, at: Date.now() })
    adjusted.push({ keyId: key.id, target, measured, prev, next })
  }
  return adjusted
}

export function cacheControlState(keyId) {
  const cached = stateCache.get(keyId)
  const value = bustPermilleFor(keyId)
  let measured = null
  let samples = 0
  let updatedAt = null
  try {
    const row = getDb()
      .prepare('SELECT measured_ratio, samples, updated_at FROM cache_control_state WHERE key_id = ?')
      .get(keyId)
    measured = row?.measured_ratio ?? null
    samples = row?.samples ?? 0
    updatedAt = row?.updated_at ?? null
  } catch {}
  return { bustPermille: value, cachedAt: cached?.at ?? null, measuredRatio: measured, samples, updatedAt }
}
