import { Brain, Coins, TicketCheck, Workflow, type LucideIcon } from 'lucide-react'

/** 智能运营分区。id 即 URL 段：/ops/<id>。 */
export const OPS_TABS = [
  ['ticket', '门票 · 打票'],
  ['iq', '降智检测'],
  ['cache', '缓存'],
  ['sched', '调度策略'],
] as const

export type OpsTabId = (typeof OPS_TABS)[number][0]

export const OPS_ICONS: Record<OpsTabId, LucideIcon> = {
  ticket: TicketCheck,
  iq: Brain,
  cache: Coins,
  sched: Workflow,
}

export const OPS_DESCRIPTIONS: Record<OpsTabId, string> = {
  ticket: '上游回合门票（x-codex-turn-state）的采集与判定：有没有票、块数是否符合套餐。只读，不改写请求。',
  iq: '三类检测任务：门票探针（3–5 分钟，最及时）、糖果题（15 分钟，答 21 为正常）、鹈鹕结构（30 分钟，形态指纹）。每个任务有独立间隔、状态与运行历史。',
  cache: '缓存命中与写入。隐式缓存链路只回命中读取，写入量恒 0 不算异常。',
  sched: '粘性时长、配额闸线、用量探测开关。改这里会影响线上调度，保存后立即生效。',
}

export function opsTabId(raw: string | undefined): OpsTabId {
  const hit = OPS_TABS.find(([id]) => id === raw)
  return (hit?.[0] ?? 'ticket') as OpsTabId
}
