/**
 * 槽位级窗口成本预算。
 *
 * 用途：限制单个账号在滚动窗口内花掉多少钱（例如「5 小时不超过 $10」），
 * 超过就不再参与调度，避免一个号被单租户打爆。
 *
 * 数据来源：usage_logs.total_cost 按 vm_id 聚合；60 秒缓存，
 * 避免每个请求都扫一次表。
 */
const CACHE_MS = 60_000
const cache = new Map()

export function resetSlotBudgetCache() {
  cache.clear()
}

/**
 * @param {object} db better-sqlite3 实例
 * @param {string} vmId 槽位 id
 * @param {number} windowMs 滚动窗口（默认 5 小时）
 * @returns {number} 窗口内累计成本（美元）
 */
export function slotWindowCostUsd(db, vmId, windowMs = 5 * 3600_000) {
  if (!db || !vmId) return 0
  const key = `${vmId}:${Math.round(windowMs / 60_000)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  let value = 0
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(total_cost), 0) AS cost FROM usage_logs
          WHERE vm_id = ? AND datetime(replace(created_at,'T',' ')) > datetime('now', ?)`,
      )
      .get(vmId, `-${Math.round(windowMs / 60_000)} minutes`)
    value = Number(row?.cost) || 0
  } catch {
    value = 0
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

/**
 * 该槽位是否已经超出窗口成本上限。
 * limit 为 0 / null 表示不限制。
 */
export function slotOverBudget(db, vmId, { limitUsd = 0, windowMs = 5 * 3600_000 } = {}) {
  const limit = Number(limitUsd)
  if (!Number.isFinite(limit) || limit <= 0) return false
  return slotWindowCostUsd(db, vmId, windowMs) >= limit
}
