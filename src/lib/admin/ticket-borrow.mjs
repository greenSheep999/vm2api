/**
 * 借票：拿一张「已验证可用」的来源门票当引子，让上游为目标账号铸一张属于它自己的票，
 * 再对目标做续接验证；通过才入库，不通过就丢弃并回退自采。
 *
 * 为什么不是「把票搬过去」：实测票绑定账号（token）。同票换 token 必被重铸，
 * 所以只能借「引子」，让上游给目标重新铸票；铸出来的票还要再验一次能否续接。
 */
import { getDb } from '../db/database.mjs'

const UPSTREAM_TTL_SEC = 3600

function db() {
  return getDb()
}

function nowIso() {
  return new Date().toISOString()
}

/** 入库：仅 status=verified 的票可被业务读取。 */
export function storeTicket({ vmId, model, state, cookies = [], source = 'self', verdict = 'verified', blocks = null, len = null, issuedAt = null, ttlSec = UPSTREAM_TTL_SEC }) {
  if (!vmId || !model || !state) return false
  const expires = new Date(Date.now() + Math.max(60, ttlSec) * 1000).toISOString()
  try {
    db()
      .prepare(
        `INSERT INTO ticket_pool (vm_id, model, state, cookies, source, verdict, blocks, len, issued_at, expires_at, verified_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(vm_id, model) DO UPDATE SET
           state = excluded.state, cookies = excluded.cookies, source = excluded.source,
           verdict = excluded.verdict, blocks = excluded.blocks, len = excluded.len,
           issued_at = excluded.issued_at, expires_at = excluded.expires_at,
           verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
      )
      .run(
        vmId,
        model,
        state,
        JSON.stringify(cookies || []),
        source,
        verdict,
        blocks,
        len,
        issuedAt,
        expires,
        nowIso(),
        nowIso(),
      )
    return true
  } catch {
    return false
  }
}

/** 取一张当前有效、已验证的票（供业务注入使用）。 */
export function pickTicket({ vmId, model }) {
  try {
    const row = db()
      .prepare(
        `SELECT state, cookies, expires_at FROM ticket_pool
          WHERE vm_id = ? AND model = ? AND verdict = 'verified' AND expires_at > ?`,
      )
      .get(vmId, model, nowIso())
    if (!row?.state) return null
    return { state: row.state, cookies: JSON.parse(row.cookies || '[]'), expires_at: row.expires_at }
  } catch {
    return null
  }
}

/** 借票失败/过期时清掉，避免业务拿到坏票。 */
export function dropTicket({ vmId, model }) {
  try {
    db().prepare('DELETE FROM ticket_pool WHERE vm_id = ? AND model = ?').run(vmId, model)
  } catch {}
}

export function listPool() {
  try {
    return db()
      .prepare('SELECT vm_id, model, source, verdict, len, expires_at, updated_at FROM ticket_pool ORDER BY updated_at DESC')
      .all()
  } catch {
    return []
  }
}
