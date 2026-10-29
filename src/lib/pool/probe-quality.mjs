/**
 * 按探针结论给候选槽位排序：healthy 优先、未知居中、降智垫底。
 *
 * 数据来源是 ticket_snapshots.probe_verdict（两发探针的结论），
 * 未探针的账号不惩罚（保持原顺序），降智账号只是排到后面而不是直接剔除，
 * 这样池子里只剩降智号时仍然能服务。
 */
import { getDb } from '../db/database.mjs'

const RANK = { healthy: 0, healthy_same: 0, unknown: 1, bad: 2 }

function rankOf(verdict) {
  if (verdict === 'healthy' || verdict === 'healthy_same') return RANK.healthy
  if (!verdict) return RANK.unknown
  return RANK.bad
}

export function readProbeVerdicts(ids) {
  const map = new Map()
  if (!Array.isArray(ids) || !ids.length) return map
  try {
    const placeholders = ids.map(() => '?').join(',')
    const rows = getDb()
      .prepare(
        `SELECT vm_id, MAX(COALESCE(probe_at, checked_at)) AS at, probe_verdict
           FROM ticket_snapshots
          WHERE vm_id IN (${placeholders}) AND probe_verdict IS NOT NULL
          GROUP BY vm_id`,
      )
      .all(...ids)
    for (const row of rows) map.set(row.vm_id, row.probe_verdict)
  } catch {}
  return map
}

/** 稳定排序：同 rank 之间保持原有顺序（原有顺序已含粘性与权重策略）。 */
export function orderByProbeQuality(ids, verdicts) {
  if (!Array.isArray(ids) || ids.length < 2) return ids
  return ids
    .map((id, index) => ({ id, index, rank: rankOf(verdicts?.get?.(id)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.id)
}
