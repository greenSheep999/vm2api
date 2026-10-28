/**
 * 滚动日志页的纯展示逻辑（不含组件），移植自 claude-code-hub 的
 * `model-audit-display.ts` / `thinking-effort-badge.tsx` / 表格内联计算，
 * 并按 vm2api 的 `ProviderChainItem`（request_attempts 直出）改写供应商链部分。
 */
import type {
  CacheTtlApplied,
  ProviderChainItem,
  UsageLogRow,
} from '@/types/panel-usage-logs'
import { toast } from 'sonner'

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制')
  } catch {
    toast.error('复制失败')
  }
}

// ---------- 状态码 ----------

/** 状态 badge 配色（hub `getStatusBadgeClassName`）。null = 无状态码。 */
const INCOMPLETE_SUCCESS_BADGE =
  'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700'

/** Downstream already committed HTTP 2xx, but the stream/body did not finish. */
export function isIncompleteCommitted(
  statusCode: number | null,
  finalState: string | null | undefined
): boolean {
  return (
    statusCode != null &&
    statusCode >= 200 &&
    statusCode < 300 &&
    finalState === 'incomplete'
  )
}

export function statusBadgeClass(
  statusCode: number | null,
  finalState: string | null | undefined = null
): string {
  if (isIncompleteCommitted(statusCode, finalState))
    return INCOMPLETE_SUCCESS_BADGE
  if (statusCode != null) {
    if (statusCode >= 200 && statusCode < 300)
      return 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
    if (statusCode >= 300 && statusCode < 400)
      return 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700'
    if (statusCode >= 400 && statusCode < 500)
      return 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700'
    if (statusCode >= 500)
      return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700'
  }
  return 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600'
}

export function statusBadgeTooltip(
  statusCode: number | null,
  finalState: string | null | undefined,
  errorCode: string | null | undefined
): string | null {
  if (!isIncompleteCommitted(statusCode, finalState)) return null
  const state = terminalStateLabel(finalState ?? null) || '响应未完整结束'
  return errorCode ? `${state}（${errorCode}）` : state
}

export function isSuccessStatus(statusCode: number | null): boolean {
  return statusCode != null && statusCode >= 200 && statusCode < 300
}

// ---------- 相对时间 ----------

/** hub `common.relativeTimeShort`：刚刚 / N秒前 / N分前 / … / N年前。 */
export function formatShortDistance(date: Date, now: Date): string {
  if (Number.isNaN(date.getTime())) return '-'
  if (date > now) return '刚刚'
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days >= 365) return `${Math.floor(days / 365)}年前`
  if (days >= 30) return `${Math.floor(days / 30)}月前`
  if (days >= 7) return `${Math.floor(days / 7)}周前`
  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}时前`
  if (minutes > 0) return `${minutes}分前`
  if (seconds > 0) return `${seconds}秒前`
  return '刚刚'
}

// ---------- 缓存 ----------

/**
 * 缓存写入按 TTL 拆分（表格 tooltip / 详情计费行共用）。
 * 有 5m/1h 明细就用明细；只有合计时按 `cacheTtlApplied` 归到一侧。
 */
export function cacheWriteSplit(input: {
  total: number | null
  fiveM: number
  oneH: number
  ttl: CacheTtlApplied
}): { fiveM: number; oneH: number } {
  return {
    fiveM:
      input.fiveM > 0
        ? input.fiveM
        : input.ttl !== '1h'
          ? (input.total ?? 0)
          : 0,
    oneH:
      input.oneH > 0 ? input.oneH : input.ttl === '1h' ? (input.total ?? 0) : 0,
  }
}

/**
 * 缓存写入费用拆分。后端只给合计 `cacheCreation`：`mixed` 按 token 占比分摊，
 * `1h` 全归 1h，其余归 5m（hub `resolveCacheCreationSplit` 的 legacy 分支）。
 */
export function cacheCostSplit(
  cost: number | null,
  tokens: { fiveM: number; oneH: number },
  ttl: CacheTtlApplied
): { fiveM: number; oneH: number } {
  if (cost == null || cost <= 0) return { fiveM: 0, oneH: 0 }
  if (ttl === 'mixed') {
    const sum = tokens.fiveM + tokens.oneH
    if (sum <= 0) return { fiveM: cost, oneH: 0 }
    const fiveM = (cost * tokens.fiveM) / sum
    return { fiveM, oneH: cost - fiveM }
  }
  if (ttl === '1h') return { fiveM: 0, oneH: cost }
  return { fiveM: cost, oneH: 0 }
}

/** 单价 `@ $x / 1M`：金额 × 1e6 / token 数，两位小数；无 token 返回 null。 */
export function unitPricePerMillion(
  amount: number,
  tokens: number
): string | null {
  if (!(tokens > 0) || !(amount > 0)) return null
  return ((amount * 1e6) / tokens).toFixed(2)
}

/** 实际缓存率 = 读取 / (输入 + 读取 + 写入)，0-1；无输入侧 token 返回 null。 */
export function actualCacheRate(row: UsageLogRow): number | null {
  const total =
    row.inputTokens +
    row.cacheReadInputTokens +
    (row.cacheCreationInputTokens ?? 0)
  return total > 0 ? row.cacheReadInputTokens / total : null
}

// ---------- 倍率 / 特殊开关 ----------

/** 分组倍率 ≠ 1 才显示；返回有限数或 null。 */
export function effectiveMultiplier(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 && value !== 1
    ? value
    : null
}

/** fast：Anthropic speed=fast 或 OpenAI service_tier=priority。 */
export function hasFastMode(row: UsageLogRow): boolean {
  return row.speed === 'fast' || row.serviceTier === 'priority'
}

const MULTIPLIER_UP =
  'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800'
const MULTIPLIER_DOWN =
  'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800'

export function multiplierBadgeClass(multiplier: number): string {
  return multiplier > 1 ? MULTIPLIER_UP : MULTIPLIER_DOWN
}

// ---------- 模型 ----------

export type ModelAuditDisplay = {
  /** 列表主显示 / 计费模型。 */
  primaryBillingModel: string | null
  hasRedirect: boolean
  hasActualMismatch: boolean
  secondaryActualModel: string | null
  effectiveRequestModel: string | null
  /** 实际发给上游的模型（重定向后的出站值）。 */
  sentUpstreamModel: string | null
  /** 上游实际回包的模型。 */
  upstreamResponseModel: string | null
  /** 上游回包与发出去的不是同一个模型 = 真降级。 */
  downgraded: boolean
  /** 只是同族变体（日期后缀 / -latest 等），不算降级。 */
  variantOnly: boolean
  /** 上游回显的实际 effort；没回显就是 null。 */
  upstreamEffort: string | null
  /** 请求高 effort、上游回显更低档 = "降智"的直接证据。 */
  effortDowngraded: boolean
}

/**
 * 抹平模型名里不影响语义的差异，用来区分「降级」和「同族变体」：
 * `gpt-6-astra-20260801` / `gpt-6-astra-latest` 与 `gpt-6-astra` 视为同一模型。
 */
export function normalizeModelVariant(model: string | null | undefined): string {
  return String(model || '')
    .split('/')
    .filter(Boolean)
    .pop()!
    .toLowerCase()
    .replace(/\[1m\]$/, '')
    .replace(/[-_.](latest|preview|exp)$/, '')
    .replace(/[-_.]?\d{8}$/, '')
    .replace(/[-_.]?\d{4}-\d{2}-\d{2}$/, '')
    .replace(/[-_.]\d{4}$/, '')
    .trim()
}

/**
 * hub `resolveModelAuditDisplay`，计费口径固定为「重定向后」：vm2api 的
 * `model` 就是计价用的生效模型（`requested_model` 是客户端原值）。
 */
export function resolveModelAuditDisplay(row: {
  originalModel: string | null
  model: string | null
  actualResponseModel: string | null
  upstreamResponseModel?: string | null
  reasoningEffort?: string | null
  upstreamReasoningEffort?: string | null
}): ModelAuditDisplay {
  const effectiveRequestModel = row.model ?? row.originalModel
  // actualResponseModel(历史命名) = 发给上游的模型。
  const sentUpstreamModel = row.actualResponseModel ?? effectiveRequestModel
  const upstreamResponseModel = row.upstreamResponseModel ?? null
  // 有 really-returned 模型时，比较「发出去的 vs 回回来的」；
  // 历史行为没有这一列，退回比较「生效请求模型 vs 发送模型」。
  const comparedTo = upstreamResponseModel
    ? sentUpstreamModel
    : effectiveRequestModel
  const comparedWith = upstreamResponseModel ?? row.actualResponseModel
  const rawDiff = Boolean(
    comparedTo && comparedWith && comparedTo !== comparedWith
  )
  const downgraded =
    rawDiff &&
    normalizeModelVariant(comparedTo) !== normalizeModelVariant(comparedWith)
  return {
    primaryBillingModel: effectiveRequestModel,
    hasRedirect: Boolean(
      row.originalModel && row.model && row.originalModel !== row.model
    ),
    hasActualMismatch: rawDiff,
    secondaryActualModel: rawDiff ? comparedWith : null,
    effectiveRequestModel,
    sentUpstreamModel,
    upstreamResponseModel,
    downgraded,
    variantOnly: rawDiff && !downgraded,
    upstreamEffort: row.upstreamReasoningEffort ?? null,
    effortDowngraded: effortDowngraded(row),
  }
}

// ---------- 思考强度 ----------

const THINKING_EFFORT_BADGE_STYLES: Record<string, string> = {
  // 强度档不是错误状态，整条色阶走蓝→靛→紫，不用红。
  // 红/玫红留给「失败、降级、超限」，避免把一个正常的 high 看成报警。
  none: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300',
  minimal:
    'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-300',
  auto: 'border-sky-300 bg-gradient-to-r from-cyan-50 via-sky-50 to-indigo-50 text-sky-800 dark:border-sky-700 dark:from-cyan-950/40 dark:via-sky-950/40 dark:to-indigo-950/40 dark:text-sky-200',
  low: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  medium:
    'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300',
  // Codex UI 的主蓝（system blue）——用户一眼认得，且不暗示错误。
  high: 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  xhigh:
    'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  max: 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200',
}

const DEFAULT_EFFORT_STYLE =
  'border-muted-foreground/20 bg-muted/40 text-muted-foreground dark:border-muted-foreground/30 dark:bg-muted/20'

export function thinkingEffortBadgeClass(effort: string): string {
  return (
    THINKING_EFFORT_BADGE_STYLES[effort.trim().toLowerCase()] ??
    DEFAULT_EFFORT_STYLE
  )
}

// ---------- 供应商链 ----------

const SELECTION_REASON_LABELS: Record<string, string> = {
  sticky: '粘性会话',
  'sticky-spill': '粘性溢出',
  'family-affinity': '家族亲和',
  'device-affinity': '设备 / machine 所在 VM',
  'priority-load': '优先级负载',
  'seat-held': '已占席位',
  balanced: '平衡',
  fill: '填充',
  queued: '排队授予',
  peek: '单候选',
  // 预调度之前的轮询策略已删除，但 request_attempts 里的历史行仍带这两个值。
  'round-robin': '轮询',
  'weighted-round-robin': '加权轮询',
}

export function selectionReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return SELECTION_REASON_LABELS[reason] ?? reason
}

const TERMINAL_STATE_LABELS: Record<string, string> = {
  verified: '成功',
  incomplete: '响应未完整结束',
  transport_error: '传输错误',
  cancelled: '已取消',
  exhausted: '候选耗尽',
  rejected: '被拒绝',
  error: '错误',
  unknown: '未知',
}

export function terminalStateLabel(state: string | null): string | null {
  if (!state) return null
  return TERMINAL_STATE_LABELS[state] ?? state
}

export type ChainItemStatus = 'success' | 'failure' | 'pending'

/** 已提交给下游或上游 2xx = 成功；上游 ≥400 或终态非成功 = 失败；其余待定。 */
export function chainItemStatus(item: ProviderChainItem): ChainItemStatus {
  if (item.downstreamCommitted) return 'success'
  if (item.upstreamStatus != null) {
    return isSuccessStatus(item.upstreamStatus) ? 'success' : 'failure'
  }
  if (item.terminalState === 'verified') return 'success'
  if (item.terminalState) return 'failure'
  return 'pending'
}

/** 尝试的展示名：槽位名 → 槽位 id → 账号。 */
export function chainItemName(item: ProviderChainItem): string {
  return item.vmName || item.vmId || item.providerName || '未知'
}

/**
 * 「供应商」列的名字：**账号优先**。
 *
 * 这一列回答的是「哪个账号承接了这次请求」，所以账号名（邮箱）必须排在
 * 槽位名前面；否则没有账号信息时会退化成槽位名，和「槽位」列完全重复。
 */
export function finalProviderName(row: UsageLogRow): string {
  const last = finalChainItem(row.providerChain)
  return (
    last?.providerName ||
    row.providerName ||
    last?.vmName ||
    last?.vmId ||
    row.vmName ||
    row.vmId ||
    '未知'
  )
}

/** 重试次数 = 尝试数 - 1（每条 request_attempts 都是真实上游请求）。 */
export function retryCount(chain: readonly ProviderChainItem[]): number {
  return Math.max(0, chain.length - 1)
}

/** 最终服务方：已提交下游的那次，否则最后一次。 */
export function finalChainItem(
  chain: readonly ProviderChainItem[]
): ProviderChainItem | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].downstreamCommitted) return chain[i]
  }
  return chain.length ? chain[chain.length - 1] : null
}

/** 首次尝试的实测队列等待。历史总调度时间不能当作排队。 */
export function queueWaitMs(
  chain: readonly ProviderChainItem[]
): number | null {
  const wait = chain[0]?.queueWaitMs
  return wait != null && wait >= 0 ? wait : null
}

// ---------- 延迟分解 ----------

export type LatencySegment = {
  key:
    | 'wait'
    | 'scheduling'
    | 'prefill'
    | 'tokenWait'
    | 'generation'
    | 'finalization'
  label: string
  ms: number
  percent: number
  color: string
}

function measuredNonNeg(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * 排队 → 上游响应等待（至 TTFB）→ 首 Token 等待（TTFB→TTFT）→ 内容输出 → 收尾。
 * 生成段只用实测 `generationMs`，终点 = firstByteMs + generationMs；
 * 缺窗口不把总耗时减 TTFT 当成生成。越界的排队只丢该段。
 */
export function latencySegments(input: {
  waitMs: number | null
  queueWaitMs?: number | null
  schedulingMs?: number | null
  firstByteMs: number | null
  ttftMs: number | null
  generationMs: number | null
  durationMs: number | null
}): LatencySegment[] | null {
  const durationMs = measuredNonNeg(input.durationMs)
  if (durationMs == null || durationMs <= 0) return null

  const firstByteMs = measuredNonNeg(input.firstByteMs)
  const ttftMs = measuredNonNeg(input.ttftMs)
  const generationMs = measuredNonNeg(input.generationMs)
  const waitMs = measuredNonNeg(input.waitMs)

  if (firstByteMs != null && firstByteMs > durationMs) return null
  if (ttftMs != null && ttftMs > durationMs) return null
  if (firstByteMs != null && ttftMs != null && ttftMs < firstByteMs) return null

  const cap = firstByteMs ?? ttftMs
  const wait = waitMs != null && cap != null && waitMs <= cap ? waitMs : 0
  const queue = measuredNonNeg(input.queueWaitMs)
  const scheduling = measuredNonNeg(input.schedulingMs)
  const split =
    queue != null && scheduling != null && queue + scheduling <= wait + 1
  const prefill = firstByteMs != null ? firstByteMs - wait : 0
  const tokenWait =
    firstByteMs != null && ttftMs != null
      ? ttftMs - firstByteMs
      : firstByteMs == null && ttftMs != null
        ? ttftMs - wait
        : 0

  let generation = 0
  let finalization = 0
  const windowMs =
    generationMs != null && generationMs > 0 ? generationMs : null
  if (firstByteMs != null && windowMs != null) {
    const endMs = firstByteMs + windowMs
    if (
      endMs <= durationMs &&
      (ttftMs == null || (ttftMs >= firstByteMs && ttftMs <= endMs))
    ) {
      const visibleStart = ttftMs != null ? ttftMs : firstByteMs
      generation = endMs - visibleStart
      finalization = durationMs - endMs
    }
  }

  const generationLabel =
    firstByteMs != null && ttftMs != null ? '内容输出' : '上游输出时间'
  const parts: Array<[LatencySegment['key'], string, number, string]> = [
    ['scheduling', '调度处理', split ? scheduling : 0, 'bg-indigo-500'],
    [
      'wait',
      split ? '排队等待' : '调度与排队（未拆分）',
      split ? queue : wait,
      'bg-blue-500',
    ],
    ['prefill', '上游响应等待', prefill, 'bg-sky-500'],
    ['tokenWait', '首 Token 等待', tokenWait, 'bg-violet-500'],
    ['generation', generationLabel, generation, 'bg-emerald-500'],
    ['finalization', '收尾', finalization, 'bg-slate-400'],
  ]
  if (parts.every(([, , ms]) => ms <= 0)) return null
  return parts.map(([key, label, ms, color]) => ({
    key,
    label,
    ms,
    percent: (ms / durationMs) * 100,
    color,
  }))
}

/** 条宽：真实占比，非零段至少 3%，免得 1ms 段塌成 0 宽却仍出现在图例里。 */
export function segmentWidth(segment: LatencySegment): number {
  return segment.ms > 0 ? Math.max(segment.percent, 3) : 0
}

const EFFORT_RANK: Record<string, number> = {
  none: 0,
  minimal: 1,
  auto: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
}

/**
 * 上游是否把思考强度降低了。只在两边都有值且能比较时成立；缺一侧不算降档，
 * 避免把"上游没回显"误报成降智。
 */
export function effortDowngraded(row: {
  reasoningEffort?: string | null
  upstreamReasoningEffort?: string | null
}): boolean {
  const asked = String(row.reasoningEffort || '').trim().toLowerCase()
  const got = String(row.upstreamReasoningEffort || '').trim().toLowerCase()
  if (!asked || !got) return false
  const a = EFFORT_RANK[asked]
  const b = EFFORT_RANK[got]
  if (a == null || b == null) return false
  return b < a
}
