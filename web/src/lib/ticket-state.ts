/**
 * 票与档位的统一判定，日志页和打票页共用。
 *
 * 三个维度必须分开，不能压成一个标签：
 *   1. 票：上游这次给没给 x-codex-turn-state（逐请求可证）
 *   2. 续接：带票再发一次，上游有没有重铸（两发探针才能证）
 *   3. 能力：糖果题这类题能不能做对（只有 6 系模型有意义）
 *
 * 低阶模型（gpt-5.6-*）本来就做不出 6 系的题，拿能力题判它会得到假阴性，
 * 所以它们只给「可续 / 断票 / 疑似 / 未验」，不给「满血 / 降智」。
 */

export type Tone = 'ok' | 'bad' | 'warn' | 'muted'

export interface Chip {
  label: string
  tone: Tone
  hint: string
}

/** 能承担 6 系能力题的模型；其余模型能力题结论不可信。 */
export function isCapableModel(model?: string | null): boolean {
  const m = String(model || '').toLowerCase()
  return m.startsWith('gpt-6') || m.startsWith('gpt-6.1')
}

export interface TicketStateInput {
  model?: string | null
  /** 'ok' | 'absent' | 其它 */
  ticketVerdict?: string | null
  ticketLen?: number | null
  /** healthy / healthy_same / degraded / route_changed / inconclusive / no_ticket / null */
  probeVerdict?: string | null
}

/** 票本身：只回答「这次有没有拿到票」。 */
export function ticketChip(input: TicketStateInput): Chip {
  const v = input.ticketVerdict
  if (!v) return { label: '未打票', tone: 'muted', hint: '这个请求没有采集到回合票信息' }
  if (v === 'absent') return { label: '无票', tone: 'warn', hint: '上游这次没有返回回合票' }
  if (v !== 'ok') return { label: '票异常', tone: 'bad', hint: `回合票状态异常：${v}` }
  const len = input.ticketLen ?? 0
  // 有票但续接被重铸，就要在票徽标上直接写「断」，否则「有票·780 + 降智」
  // 看起来自相矛盾，读者无法判断这张票还能不能用。
  const p = input.probeVerdict
  if (p === 'degraded') {
    return { label: `有票·${len}·断`, tone: 'bad', hint: `拿到了 ${len} 字符的票，但第二发被上游重铸，这张票续不住` }
  }
  if (p === 'route_changed' || p === 'inconclusive') {
    return { label: `有票·${len}·疑`, tone: 'warn', hint: `拿到了 ${len} 字符的票，但续接证据不足，不能断定可用` }
  }
  return { label: `有票·${len}`, tone: 'ok', hint: `上游返回了 ${len} 字符的回合票，且续接正常` }
}

/** 续接：只回答「这张票还能不能续」。低阶模型不给满血/降智。 */
export function continuityChip(input: TicketStateInput): Chip {
  const capable = isCapableModel(input.model)
  const p = input.probeVerdict
  if (!p) return { label: '未验', tone: 'muted', hint: '还没跑过两发探针，续接能力未知' }
  if (p === 'healthy' || p === 'healthy_same') {
    return capable
      ? { label: '满血', tone: 'ok', hint: '两发探针：第二发没有重铸票，且能答对能力题' }
      : { label: '可续', tone: 'ok', hint: '两发探针：第二发没有重铸票（该模型不做能力题判定）' }
  }
  if (p === 'degraded') {
    return capable
      ? { label: '降智', tone: 'bad', hint: '两发探针：第二发被上游重铸票，票续不住' }
      : { label: '断票', tone: 'bad', hint: '两发探针：第二发被上游重铸票（该模型不做能力题判定）' }
  }
  if (p === 'route_changed') {
    return { label: '疑似', tone: 'warn', hint: '票没变但出口路由变了，不能算满血也不算降智' }
  }
  if (p === 'inconclusive') {
    return { label: '疑似', tone: 'warn', hint: '第二发没拿到票，证据不足' }
  }
  if (p === 'no_ticket') {
    return { label: '无票', tone: 'warn', hint: '探针第一发就没票，无法验证续接' }
  }
  return { label: '未验', tone: 'muted', hint: `未知的探针结论：${p}` }
}

/** 日志行用：票 + 续接两个徽标（能力题结论不在日志维度里）。 */
export function logChips(input: TicketStateInput): Chip[] {
  const chips: Chip[] = [ticketChip(input)]
  if (input.ticketVerdict === 'ok' || input.probeVerdict) chips.push(continuityChip(input))
  return chips
}

export const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300',
  bad: 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300',
  warn: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
  muted: 'border-muted-foreground/30 text-muted-foreground',
}
