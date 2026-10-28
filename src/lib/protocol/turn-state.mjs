/**
 * Codex 回合门票（`x-codex-turn-state`）解析。
 *
 * 上游在响应头里铸造一个不透明 blob，客户端在同一回合的后续请求里原样回带。
 * 这个 blob 不是随便的字符串，它有固定信封结构（对齐 sub2api 的
 * `parseOpenAICodexTicketShape`）：
 *
 *   base64url 解码后：
 *     raw[0]        === 0x80
 *     raw[1..9]     = 签发时间戳（大端 uint64，秒）
 *     (len - 57) % 16 === 0
 *     blocks        = (len - 57) / 16
 *
 * 块数按套餐固定：个人版 10 块（base64 后 292 字符），
 * Team / Business / Enterprise 12 块（≈332 字符）。
 *
 * 我们只做**只读检测**：解析、记录、比对期望块数；不注入、不改写、不铸票。
 */

export const TURN_STATE_HEADER = 'x-codex-turn-state'

/** 个人版（Plus/Pro）票固定的数据块数。 */
export const TURN_STATE_PERSONAL_BLOCKS = 10
/** Team / Business / Enterprise 票固定的数据块数。 */
export const TURN_STATE_TEAM_BLOCKS = 12

const TEAM_PLAN_MARKERS = ['team', 'business', 'enterprise']

/** 套餐是否属于 Team 系（上游不只有 "team"，还有 self_serve_business_prolite 之类）。 */
export function isTeamPlan(planType) {
  const plan = String(planType || '')
    .trim()
    .toLowerCase()
  if (!plan) return false
  return TEAM_PLAN_MARKERS.some((marker) => plan.includes(marker))
}

export function expectedTurnStateBlocks(planType) {
  return isTeamPlan(planType) ? TURN_STATE_TEAM_BLOCKS : TURN_STATE_PERSONAL_BLOCKS
}

/** base64url 编码后应有的字符数（带 = 填充）。 */
export function expectedTurnStateLength(blocks) {
  const raw = 57 + 16 * blocks
  return Math.ceil(raw / 3) * 4
}

/**
 * 解析一张票。返回 null 表示没有票；返回 `{ ok: false }` 表示有票但信封不合法。
 */
export function parseTurnState(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const len = text.length
  if (len > 2048) return { ok: false, reason: 'too_long', len }
  if (/[\r\n\t ]/.test(text)) return { ok: false, reason: 'invalid_encoding', len }

  const core = text.replace(/=+$/, '')
  if (text.length - core.length > 2) return { ok: false, reason: 'invalid_padding', len }

  let raw
  try {
    raw = Buffer.from(core, 'base64url')
  } catch {
    return { ok: false, reason: 'not_base64url', len }
  }
  if (!raw || raw.length < 73) return { ok: false, reason: 'envelope_too_short', len }
  if (raw[0] !== 0x80) return { ok: false, reason: 'bad_magic', len }
  if ((raw.length - 57) % 16 !== 0) return { ok: false, reason: 'bad_block_alignment', len }

  const issuedUnix = Number(raw.readBigUInt64BE(1))
  if (!Number.isFinite(issuedUnix) || issuedUnix < 1577836800 || issuedUnix >= 4102444800) {
    return { ok: false, reason: 'timestamp_out_of_range', len }
  }

  const blocks = (raw.length - 57) / 16
  return {
    ok: true,
    blocks,
    len,
    raw_bytes: raw.length,
    issued_at: new Date(issuedUnix * 1000).toISOString(),
  }
}

/**
 * 把票和套餐期望对比，给一个可入库的结论。
 *
 * - `absent`   没有票（上游没给）
 * - `malformed` 信封不合法
 * - `short`    块数低于该套餐期望（降级/限流信号）
 * - `ok`       块数与套餐一致
 */
export function judgeTurnState(value, planType) {
  const parsed = parseTurnState(value)
  if (!parsed) return { verdict: 'absent', blocks: null, len: 0, issued_at: null, reason: 'no_ticket' }
  if (!parsed.ok) {
    return {
      verdict: 'malformed',
      blocks: null,
      len: parsed.len,
      issued_at: null,
      reason: parsed.reason,
    }
  }
  const expected = expectedTurnStateBlocks(planType)
  return {
    verdict: parsed.blocks < expected ? 'short' : 'ok',
    blocks: parsed.blocks,
    len: parsed.len,
    issued_at: parsed.issued_at,
    reason: parsed.blocks < expected ? `blocks_below_${expected}` : `blocks_${expected}`,
  }
}
