/**
 * 缓存续接记忆：记住每个 (槽位, 会话) 最近一次成功的 response id。
 *
 * 上游的前缀缓存是按「同一段前缀的后续请求」滚动的。客户端如果每次都新建
 * response（不带 previous_response_id），缓存虽然还能按 token 前缀命中，
 * 但滚动链断了，命中率会掉。这里把 response id 记下来，配置「强制续接」的
 * Key 在客户端没带的时候由我们补上。
 */
import { getDb } from '../db/database.mjs'

const MAX_AGE_MS = 6 * 60 * 60 * 1000

export function rememberResponseId({ vmId, sessionKey, responseId, model = null }) {
  if (!vmId || !sessionKey || !responseId) return
  try {
    getDb()
      .prepare(
        `INSERT INTO session_cache_state (vm_id, session_key, model, last_response_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(vm_id, session_key) DO UPDATE SET
           last_response_id = excluded.last_response_id,
           model = excluded.model,
           updated_at = excluded.updated_at`,
      )
      .run(vmId, sessionKey, model, responseId, new Date().toISOString())
  } catch {}
}

export function recallResponseId({ vmId, sessionKey }) {
  if (!vmId || !sessionKey) return null
  try {
    const row = getDb()
      .prepare('SELECT last_response_id, updated_at FROM session_cache_state WHERE vm_id = ? AND session_key = ?')
      .get(vmId, sessionKey)
    if (!row?.last_response_id) return null
    const age = Date.now() - Date.parse(row.updated_at)
    if (!Number.isFinite(age) || age > MAX_AGE_MS) return null
    return row.last_response_id
  } catch {
    return null
  }
}

/** 从一行 SSE 里取 response.completed 的 id（只认终态事件，避免误记）。 */
export function responseIdFromSseLine(line) {
  if (typeof line !== 'string' || !line.startsWith('data:')) return null
  if (!line.includes('response.completed')) return null
  const m = /"id"\s*:\s*"(resp_[A-Za-z0-9]+)"/.exec(line)
  return m ? m[1] : null
}
