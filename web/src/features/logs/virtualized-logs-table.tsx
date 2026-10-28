import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { UsageLogFilters, UsageLogRow } from '@/types/panel-usage-logs'
import { ArrowUp, Loader2, Wrench } from 'lucide-react'
import {
  calculateOutputRate,
  formatCurrency,
  formatDuration,
  formatTokenAmount,
  isNonBillingEndpoint,
} from '@/lib/usage-format'
import { cn } from '@/lib/utils'
import { useVirtualizedInfiniteList } from '@/hooks/use-virtualized-infinite-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { LogsTableColumn } from './column-visibility'

/**
 * 缓存命中率（%）：缓存读 ÷（新 input + 缓存读 + 缓存写）。
 * 任一分量为 0 或缺省时返回 null，不臆造数字。
 */
function cacheHitRate(row: {
  inputTokens: number | null
  cacheReadInputTokens: number | null
  cacheCreationInputTokens: number | null
}): number | null {
  const read = Number(row.cacheReadInputTokens) || 0
  const fresh = Number(row.inputTokens) || 0
  const write = Number(row.cacheCreationInputTokens) || 0
  const total = read + fresh + write
  if (!read || total <= 0) return null
  return Math.round((1000 * read) / total) / 10
}

/** 命中率提示色：>= 80% 绿 / 40-80% 黄 / < 40% 红。 */
function hitRateToneClass(rate: number | null): string {
  if (rate == null) return 'text-muted-foreground'
  if (rate >= 80) return 'text-green-600 dark:text-green-400'
  if (rate >= 40) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

// ---------- IP 归属地 ----------
// 进程内缓存，避免同一 IP 反复请求；按需批量拉取，失败静默降级。
const GEO_CACHE = new Map<string, { country: string | null; city: string | null } | null>()
const GEO_INFLIGHT = new Set<string>()

function useGeoLabels(ips: string[]): Record<string, string> {
  const [labels, setLabels] = useState<Record<string, string>>({})
  const key = [...new Set(ips.filter(Boolean))].sort().join(',')
  useEffect(() => {
    if (!key) return
    const need = key.split(',').filter((ip) => !GEO_CACHE.has(ip) && !GEO_INFLIGHT.has(ip))
    const apply = () => {
      const next: Record<string, string> = {}
      for (const ip of key.split(',')) {
        const g = GEO_CACHE.get(ip)
        if (!g) continue
        const text = [g.city, g.country].filter(Boolean).join(', ')
        if (text) next[ip] = text
      }
      setLabels(next)
    }
    if (!need.length) {
      apply()
      return
    }
    for (const ip of need) GEO_INFLIGHT.add(ip)
    let cancelled = false
    api<{ geo: Record<string, { country: string | null; city: string | null } | null> }>(
      `/api/panel/geoip?ips=${encodeURIComponent(need.join(','))}`,
    )
      .then((r) => {
        for (const [ip, g] of Object.entries(r.geo || {})) GEO_CACHE.set(ip, g)
      })
      .catch(() => {
        for (const ip of need) GEO_CACHE.set(ip, null)
      })
      .finally(() => {
        for (const ip of need) GEO_INFLIGHT.delete(ip)
        if (!cancelled) apply()
      })
    return () => {
      cancelled = true
    }
  }, [key])
  return labels
}

/** 时长拆成「数值 + 单位」，便于数值上色、单位置灰。null 原样返回占位。 */
function splitDuration(ms: number | null | undefined): { n: string; u: string } {
  if (ms == null || !Number.isFinite(ms)) return { n: '-', u: '' }
  return ms >= 1000
    ? { n: (ms / 1000).toFixed(2), u: 's' }
    : { n: String(Math.round(ms)), u: 'ms' }
}

/** 金额拆成「符号 + 数值」。 */
function splitCurrency(text: string): { sym: string; n: string } {
  if (text.startsWith('$')) return { sym: '$', n: text.slice(1) }
  return { sym: '', n: text }
}

/** TTFT 提示色：< 5s 绿 / 5-15s 黄 / > 15s 红。 */
function ttftToneClass(ms: number): string {
  if (ms < 5000) return 'text-green-600 dark:text-green-400'
  if (ms < 15000) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

/** 输出速率提示色：> 30 绿 / 10-30 黄 / < 10 红。 */
function tpsToneClass(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return 'text-muted-foreground'
  if (rate > 30) return 'text-green-600 dark:text-green-400'
  if (rate >= 10) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

/** 总耗时提示色：< 15s 绿 / 15-30s 黄 / >= 30s 红。 */
function durationToneClass(ms: number | null): string {
  if (ms == null || ms <= 0) return 'text-muted-foreground'
  if (ms < 15000) return 'text-green-600 dark:text-green-400'
  if (ms < 30000) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

/** 把文字提示色换成同色系的左侧竖条底色。 */
function barOf(tone: string): string {
  if (tone.includes('green')) return 'bg-green-500'
  if (tone.includes('yellow')) return 'bg-yellow-500'
  if (tone.includes('red')) return 'bg-red-500'
  return 'bg-muted-foreground/30'
}

/** 性能列的一行：值(带单位) + 文字标签，整行右对齐；彩条由外层统一画成一条。 */
function PerfRow({
  label,
  n,
  u,
  tone,
}: {
  label: string
  n: string
  u: string
  tone: string
}) {
  return (
    <div className='flex w-full items-center justify-end gap-1 leading-tight'>
      <span className={cn('shrink-0 text-[10px] tabular-nums', tone)}>
        {n}
        <span className='text-muted-foreground'>{u}</span>
      </span>
      <span className='w-[34px] shrink-0 truncate text-left text-[10px] text-muted-foreground'>
        {label}
      </span>
    </div>
  )
}
import { CostTooltipContent } from './cost-tooltip'
import { TipDivider, TipKV, TipNote, TipSection } from './tooltip-kit'
import {
  ModelDisplayWithRedirect,
  StatusBadge,
} from './log-cells'
import { cacheWriteSplit, copyText, hasFastMode } from './log-display'
import { ProviderCell } from './provider-chain-popover'
import { usageLogsBatchQueryOptions } from './queries'
import { RelativeTime } from './relative-time'
import { api } from '@/lib/api'

const ROW_HEIGHT = 72
const SCROLL_TOP_THRESHOLD = 500

export type DetailTab = 'summary' | 'logic-trace' | 'performance' | 'raw'

export type OpenDetail = (
  row: UsageLogRow,
  opts?: { tab?: DetailTab; chainIndex?: number; scrollToRedirect?: boolean }
) => void

const FAST_BADGE =
  'text-[10px] leading-tight px-1 py-0 [&_svg]:size-2.5 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800'
const CONTEXT_1M_BADGE =
  'text-[10px] leading-tight px-1 py-0 [&_svg]:size-2.5 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800'
const TTL_BADGE =
  'text-[10px] leading-tight px-1 py-0 [&_svg]:size-2.5 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800'
const TOOLS_BADGE =
  'gap-0.5 text-[10px] leading-tight px-1 py-0 [&_svg]:size-2.5 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800'

function HeadCell({
  className,
  title,
  children,
}: {
  className: string
  title?: string
  children: string
}) {
  return (
    <div className={cn('truncate px-1.5', className)} title={title ?? children}>
      {children}
    </div>
  )
}

/** 长上下文档位的兜底阈值：总上下文（未命中输入 + 缓存读）超过 200K。 */
const LONG_CONTEXT_CONTEXT_TOKENS = 200_000

/** 长上下文：优先看计价档标记，没标记时按总上下文量兜底判断。 */
function isLongContext(row: UsageLogRow): boolean {
  if (row.context1mApplied) return true
  const contextTokens =
    (row.inputTokens || 0) + (row.cacheReadInputTokens || 0)
  return contextTokens >= LONG_CONTEXT_CONTEXT_TOKENS
}

function CostBadges({ row }: { row: UsageLogRow }) {
  const fast = hasFastMode(row)
  const longContext = isLongContext(row)
  const tools = Boolean(row.hasTools)
  if (!fast && !longContext && !tools) return null
  return (
    <>
      {fast ? (
        <Badge
          variant='outline'
          className={FAST_BADGE}
          title='优先服务等级（fast 模式）'
        >
          fast
        </Badge>
      ) : null}
      {longContext ? (
        <Badge
          variant='outline'
          className={CONTEXT_1M_BADGE}
          title='长上下文：本次请求上下文超过 200K，按长上下文档位计价'
        >
          Long context
        </Badge>
      ) : null}
      {tools ? (
        <Badge
          variant='outline'
          className={TOOLS_BADGE}
          title='携带工具调用；联网搜索 / 图片生成这类计费工具会单独计入成本'
        >
          <Wrench className='h-2.5 w-2.5' />+
        </Badge>
      ) : null}
    </>
  )
}

function LogRow({
  row,
  hidden,
  onOpenDetail,
}: {
  row: UsageLogRow
  hidden: (column: LogsTableColumn) => boolean
  onOpenDetail: OpenDetail
}) {
  const nonBilling = isNonBillingEndpoint(row.endpoint)
  const hits = cacheHitRate(row)
  const geoLabels = useGeoLabels(row.clientIp ? [row.clientIp] : [])
  const cache = cacheWriteSplit({
    total: row.cacheCreationInputTokens,
    fiveM: row.cacheCreation5mInputTokens,
    oneH: row.cacheCreation1hInputTokens,
    ttl: row.cacheTtlApplied,
  })
  const rate = calculateOutputRate(row.outputTokens, row.generationMs)
  const showRate = rate != null

  return (
    <>
      <div className='min-w-[56px] flex-[0.6] truncate pr-1.5 pl-3 font-mono text-xs'>
        <RelativeTime date={row.createdAt} fallback='-' />
      </div>
      {hidden('user') ? null : (
        <div
          className='min-w-[50px] flex-[0.8] truncate px-1.5 text-sm'
          title={row.userName ?? undefined}
        >
          {row.userName || '-'}
        </div>
      )}
      {hidden('key') ? null : (
        <div
          className='min-w-[50px] flex-[0.6] truncate px-1.5 font-mono text-xs'
          title={row.keyName ?? undefined}
        >
          {row.keyName || '-'}
        </div>
      )}
      {hidden('sessionId') ? null : (
        <div className='min-w-[80px] flex-[0.8] px-1.5'>
          {row.sessionId ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  className='w-full cursor-pointer truncate text-left font-mono text-xs hover:underline'
                  onClick={() => row.sessionId && void copyText(row.sessionId)}
                >
                  {row.sessionId}
                </button>
              </TooltipTrigger>
              <TooltipContent side='bottom' className='max-w-[500px] space-y-1'>
                <span className='block font-mono text-xs break-all'>
                  出站 {row.sessionId}
                </span>
                {row.clientSessionId &&
                row.clientSessionId !== row.sessionId ? (
                  <span className='block font-mono text-xs break-all opacity-70'>
                    客户端 {row.clientSessionId}
                  </span>
                ) : null}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className='font-mono text-xs text-muted-foreground'>-</span>
          )}
        </div>
      )}
      {hidden('ip') ? null : (
        <div className='min-w-[90px] flex-[0.8] overflow-hidden px-1.5'>
          {row.clientIp ? (
            <>
              <button
                type='button'
                title='点击复制'
                className='block w-full max-w-full min-w-0 cursor-pointer truncate text-left font-mono text-xs hover:underline'
                onClick={() => row.clientIp && void copyText(row.clientIp)}
              >
                {row.clientIp}
              </button>
              {geoLabels[row.clientIp] ? (
                <span className='block truncate text-[10px] text-muted-foreground'>
                  {geoLabels[row.clientIp]}
                </span>
              ) : null}
            </>
          ) : (
            <span className='block font-mono text-xs text-muted-foreground'>
              —
            </span>
          )}
        </div>
      )}
      {hidden('vm') ? null : (
        <div className='min-w-[90px] flex-[0.9] px-1.5 font-mono text-xs'>
          {row.vmName || row.vmId ? (
            <Tooltip delayDuration={250}>
              <TooltipTrigger asChild>
                <span className='flex min-w-0 cursor-help flex-col'>
                  <span className='truncate'>{row.vmName || row.vmId}</span>
                  {row.vmName && row.vmId && row.vmName !== row.vmId ? (
                    <span className='truncate text-[10px] text-muted-foreground'>
                      {row.vmId}
                    </span>
                  ) : null}
                </span>
              </TooltipTrigger>
              <TooltipContent align='end' className='space-y-1 text-xs'>
                <div>槽位: {row.vmId || '—'}</div>
                <div>展示名: {row.vmName || '—'}</div>
                <div>供应商: {row.providerName || '—'}</div>
                <div>账号: {row.accountId || '—'}</div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className='text-muted-foreground'>—</span>
          )}
        </div>
      )}
      {hidden('provider') ? null : (
        <div className='min-w-[100px] flex-[1.5] px-1.5'>
          <ProviderCell
            row={row}
            onChainItemClick={(chainIndex) =>
              onOpenDetail(row, { tab: 'logic-trace', chainIndex })
            }
          />
        </div>
      )}
      <div className='min-w-[100px] flex-[1.3] px-1.5 font-mono text-xs'>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='flex min-w-0 cursor-help items-center gap-1 truncate'>
              <ModelDisplayWithRedirect
                row={row}
                onRedirectClick={() =>
                  onOpenDetail(row, { scrollToRedirect: true })
                }
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className='text-xs'>{row.originalModel || row.model || '-'}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {hidden('tokens') ? null : (
        <div className='min-w-[70px] flex-[0.7] px-1.5 text-right font-mono text-xs'>
          <Tooltip delayDuration={250}>
            <TooltipTrigger asChild>
              <div className='flex cursor-help flex-col items-end leading-tight tabular-nums'>
                <span>{formatTokenAmount(row.inputTokens)}</span>
                <span className='text-muted-foreground'>
                  {formatTokenAmount(row.outputTokens)}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent align='end' className='w-[186px] space-y-1'>
              <TipKV label='输入' value={formatTokenAmount(row.inputTokens)} />
              <TipKV label='输出' value={formatTokenAmount(row.outputTokens)} />
              <TipKV
                label='缓存读取'
                value={formatTokenAmount(row.cacheReadInputTokens)}
              />
              <TipDivider />
              <TipKV
                label='总 tokens'
                value={formatTokenAmount(row.totalTokens)}
              />
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      {hidden('cache') ? null : (
        <div className='min-w-[70px] flex-[0.8] px-1.5 text-right font-mono text-xs'>
          {(() => {
            const hasWrite = (row.cacheCreationInputTokens ?? 0) > 0
            const hasRead = (row.cacheReadInputTokens ?? 0) > 0
            // 两者都没有 → 一个「—」就够，别渲染成「— / 0」看着像 -0。
            if (!hasWrite && !hasRead) {
              return <span className='text-muted-foreground'>—</span>
            }
            return (
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <div className='flex cursor-help flex-col items-end leading-tight tabular-nums'>
                    {hasWrite ? (
                      <div className='flex w-full items-center gap-1'>
                        {row.cacheTtlApplied ? (
                          <Badge variant='outline' className={TTL_BADGE}>
                            {row.cacheTtlApplied}
                          </Badge>
                        ) : null}
                        <span className='ml-auto'>
                          {formatTokenAmount(row.cacheCreationInputTokens)}
                        </span>
                      </div>
                    ) : null}
                    {hasRead ? (
                      <span className='text-muted-foreground'>
                        {formatTokenAmount(row.cacheReadInputTokens)}
                      </span>
                    ) : null}
                    {hits != null ? (
                      <span className='text-[10px]'>
                        <span className='text-muted-foreground'>命中 </span>
                        <span className={hitRateToneClass(hits)}>{hits}%</span>
                      </span>
                    ) : null}
                  </div>
                </TooltipTrigger>
                <TooltipContent align='end' className='w-[210px] space-y-1'>
                  {hasWrite ? (
                    <>
                      <TipSection>缓存写入</TipSection>
                      <TipKV label='5m' value={formatTokenAmount(cache.fiveM)} />
                      <TipKV label='1h' value={formatTokenAmount(cache.oneH)} />
                      <TipDivider />
                    </>
                  ) : null}
                  <TipSection>缓存读取</TipSection>
                  <TipKV
                    label='读命中'
                    value={formatTokenAmount(row.cacheReadInputTokens)}
                  />
                  <TipKV
                    label='命中率'
                    value={hits != null ? `${hits}%` : '无缓存读'}
                    tone={hitRateToneClass(hits)}
                  />
                  <TipKV
                    label='全价输入'
                    value={formatTokenAmount(row.inputTokens)}
                  />
                  <TipNote>全价输入 = 未命中部分，按原价计费。</TipNote>
                  {hasWrite ? null : (
                    <TipNote>
                      本链路是隐式缓存：上游只回「缓存命中读取」，不单独上报写入，
                      所以没有 5m / 1h 写入量。
                    </TipNote>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })()}
        </div>
      )}
      {hidden('cost') ? null : (
        <div className='min-w-[96px] flex-[0.9] px-1.5 text-right font-mono text-xs'>
          {nonBilling || row.costUsd == null ? (
            '-'
          ) : (
            <Tooltip delayDuration={250}>
              <TooltipTrigger asChild>
                <span className='flex cursor-help flex-col items-end gap-0.5 leading-tight'>
                  <span className='inline-flex items-baseline gap-0.5'>
                    {(() => {
                      const c = splitCurrency(
                        formatCurrency(row.costUsd, 6),
                      )
                      return (
                        <>
                          <span className='text-muted-foreground'>{c.sym}</span>
                          <span className='text-green-600 dark:text-green-400'>
                            {c.n}
                          </span>
                        </>
                      )
                    })()}
                  </span>
                  {row.actualCostUsd != null &&
                  row.costUsd != null &&
                  Math.abs(row.actualCostUsd - row.costUsd) > 5e-7 ? (
                    <span className='text-[10px] text-orange-600 dark:text-orange-400'>
                      A {formatCurrency(row.actualCostUsd, 6)}
                    </span>
                  ) : null}
                  <span className='flex flex-wrap items-center justify-end gap-1'>
                    <CostBadges row={row} />
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent align='end' className='max-w-[320px] p-3'>
                <CostTooltipContent row={row} />
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      {hidden('performance') ? null : (
        <div className='min-w-[104px] flex-[1] px-1.5 font-mono text-xs'>
          <Tooltip delayDuration={250}>
            <TooltipTrigger asChild>
              <div
                className='flex cursor-pointer items-stretch gap-1.5'
                title='点击查看阶段拆解'
                onClick={(event) => {
                  // 只开性能页，别被行级 click 再开一次成 summary。
                  event.stopPropagation()
                  onOpenDetail(row, { tab: 'performance' })
                }}
              >
                <div className='flex min-w-0 flex-1 flex-col gap-y-1'>
                  <PerfRow
                    label='TTFT'
                    n={
                      row.ttftMs != null && row.ttftMs > 0
                        ? splitDuration(row.ttftMs).n
                        : '—'
                    }
                    u={
                      row.ttftMs != null && row.ttftMs > 0
                        ? splitDuration(row.ttftMs).u
                        : ''
                    }
                    tone={
                      row.ttftMs != null && row.ttftMs > 0
                        ? ttftToneClass(row.ttftMs)
                        : 'text-muted-foreground'
                    }
                  />
                  <PerfRow
                    label='Total'
                    n={
                      row.durationMs != null
                        ? splitDuration(row.durationMs).n
                        : '—'
                    }
                    u={
                      row.durationMs != null
                        ? splitDuration(row.durationMs).u
                        : ''
                    }
                    tone={durationToneClass(row.durationMs)}
                  />
                  <PerfRow
                    label='tok/s'
                    n={showRate ? rate.toFixed(0) : '—'}
                    u={showRate ? ' t/s' : ''}
                    tone={
                      showRate ? tpsToneClass(rate) : 'text-muted-foreground'
                    }
                  />
                </div>
                {/* 一条竖条，三段紧贴：TTFT / Total / tok/s 各按自己的健康度上色。 */}
                <div className='flex w-[3px] shrink-0 flex-col overflow-hidden rounded-full'>
                  <span
                    className={cn(
                      'flex-1',
                      barOf(
                        row.ttftMs != null && row.ttftMs > 0
                          ? ttftToneClass(row.ttftMs)
                          : 'text-muted-foreground',
                      ),
                    )}
                  />
                  <span
                    className={cn(
                      'flex-1',
                      barOf(durationToneClass(row.durationMs)),
                    )}
                  />
                  <span
                    className={cn(
                      'flex-1',
                      barOf(
                        showRate
                          ? tpsToneClass(rate)
                          : 'text-muted-foreground',
                      ),
                    )}
                  />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent align='end' className='w-[214px] space-y-1'>
              <TipKV
                label='总耗时'
                value={formatDuration(row.durationMs)}
                tone={durationToneClass(row.durationMs)}
              />
              {row.firstByteMs != null ? (
                <TipKV
                  label='首字节 TTFB'
                  value={formatDuration(row.firstByteMs)}
                />
              ) : null}
              {row.ttftMs != null ? (
                <TipKV
                  label='首 Token TTFT'
                  value={formatDuration(row.ttftMs)}
                  tone={ttftToneClass(row.ttftMs)}
                />
              ) : null}
              {row.generationMs != null && row.generationMs > 0 ? (
                <TipKV
                  label='上游输出'
                  value={formatDuration(row.generationMs)}
                />
              ) : null}
              <TipDivider />
              {showRate ? (
                <TipKV
                  label='输出速率'
                  value={`${rate.toFixed(1)} tok/s`}
                  tone={tpsToneClass(rate)}
                />
              ) : null}
              {hits != null ? (
                <TipKV
                  label='缓存命中率'
                  value={`${hits}%`}
                  tone={hitRateToneClass(hits)}
                />
              ) : null}
              <TipNote>上游输出含不可见推理，不含 HTTP 收尾与清理。</TipNote>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      <div className='min-w-[70px] flex-[0.7] truncate pr-3 pl-1.5 text-right'>
        <Button
          type='button'
          variant='ghost'
          className='h-auto p-0 font-normal hover:bg-transparent'
          onClick={() => onOpenDetail(row)}
        >
          <StatusBadge
            statusCode={row.statusCode}
            finalState={row.finalState}
            errorCode={row.errorCode}
          />
        </Button>
      </div>
    </>
  )
}

/**
 * 键集游标的无限虚拟列表（hub `VirtualizedLogsTable`）。
 * 轮询只在列表停在顶部附近时进行：往下翻时重拉所有已加载页既慢又会打乱阅读。
 */
export function VirtualizedLogsTable({
  filters,
  autoRefreshEnabled,
  autoRefreshIntervalMs = 5000,
  hiddenColumns,
  hideStatusBar = false,
  hideScrollToTop = false,
  bodyClassName,
  onOpenDetail,
}: {
  filters: UsageLogFilters
  autoRefreshEnabled: boolean
  autoRefreshIntervalMs?: number
  hiddenColumns?: readonly LogsTableColumn[]
  hideStatusBar?: boolean
  hideScrollToTop?: boolean
  bodyClassName?: string
  onOpenDetail: OpenDetail
}) {
  const scrolledDownRef = useRef(false)
  const query = useInfiniteQuery(
    usageLogsBatchQueryOptions({
      filters,
      pollMs: autoRefreshIntervalMs,
      shouldPoll: () => autoRefreshEnabled && !scrolledDownRef.current,
    })
  )
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = query
  const allLogs = useMemo(
    () => data?.pages.flatMap((page) => page.logs) ?? [],
    [data]
  )
  const pages = data?.pages
  const lastPageEmpty =
    !!pages?.length && pages[pages.length - 1].logs.length === 0

  const {
    parentRef,
    rowVirtualizer,
    virtualItems,
    showScrollToTop,
    handleScroll,
    scrollToTop,
    resetScrollPosition,
  } = useVirtualizedInfiniteList({
    itemCount: allLogs.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    loadMoreThreshold: 5,
    scrollTopThreshold: SCROLL_TOP_THRESHOLD,
    getItemKey: (index) => allLogs[index]?.id ?? `loader-${index}`,
  })
  scrolledDownRef.current = showScrollToTop

  // 后端在屏蔽类 / 错误类的 JS 后过滤扫到上限时会回一页空数据但 hasMore=true：
  // 这时虚拟列表里没有新行可触发「接近末尾」，需要主动接着拉。
  useEffect(() => {
    if (lastPageEmpty && hasNextPage && !isFetchingNextPage)
      void fetchNextPage()
  }, [lastPageEmpty, hasNextPage, isFetchingNextPage, fetchNextPage])

  const filtersKey = JSON.stringify(filters)
  const resetRef = useRef(resetScrollPosition)
  resetRef.current = resetScrollPosition
  useEffect(() => {
    resetRef.current()
  }, [filtersKey])

  const isHidden = useCallback(
    (column: LogsTableColumn) => hiddenColumns?.includes(column) ?? false,
    [hiddenColumns]
  )

  if (query.isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
        <span className='ml-2 text-muted-foreground'>加载中...</span>
      </div>
    )
  }
  if (query.error) {
    return (
      <div className='py-8 text-center text-destructive'>
        {query.error instanceof Error ? query.error.message : '加载失败'}
      </div>
    )
  }
  if (!allLogs.length && !hasNextPage) {
    return (
      <div className='py-8 text-center text-muted-foreground'>暂无数据</div>
    )
  }

  return (
    <div className='space-y-4'>
      {hideStatusBar ? null : (
        <div className='flex items-center justify-between px-3 pt-2 text-xs text-muted-foreground/70'>
          <span>已加载 {allLogs.length} 条记录</span>
          {isFetchingNextPage ? (
            <span className='flex items-center gap-1.5'>
              <Loader2 className='h-3 w-3 animate-spin' />
              加载更多中...
            </span>
          ) : !hasNextPage && allLogs.length > 0 ? (
            <span>已加载全部记录</span>
          ) : null}
        </div>
      )}
      <div className='overflow-x-auto'>
        <div className='min-w-[900px]'>
          {/* Same scrollbar gutter as the body below so flex columns resolve to the same widths. */}
          <div className='sticky top-0 z-10 [scrollbar-gutter:stable] overflow-y-hidden border-b bg-muted/30'>
            <div className='flex h-8 items-center text-[11px] font-medium tracking-wide text-muted-foreground/80'>
              <HeadCell className='min-w-[56px] flex-[0.6] pr-1.5 pl-3'>
                时间
              </HeadCell>
              {isHidden('user') ? null : (
                <HeadCell className='min-w-[50px] flex-[0.8]'>用户</HeadCell>
              )}
              {isHidden('key') ? null : (
                <HeadCell className='min-w-[50px] flex-[0.6]'>密钥</HeadCell>
              )}
              {isHidden('sessionId') ? null : (
                <HeadCell
                  className='min-w-[80px] flex-[0.8]'
                  title='实际发往上游的会话 id'
                >
                  出站 Session
                </HeadCell>
              )}
              {isHidden('ip') ? null : (
                <HeadCell className='min-w-[90px] flex-[0.8]'>IP</HeadCell>
              )}
              {isHidden('vm') ? null : (
                <HeadCell className='min-w-[90px] flex-[0.9]'>槽位</HeadCell>
              )}
              {isHidden('provider') ? null : (
                <HeadCell className='min-w-[100px] flex-[1.5]'>供应商</HeadCell>
              )}
              <HeadCell className='min-w-[100px] flex-[1.3]'>计费模型</HeadCell>
              {isHidden('tokens') ? null : (
                <HeadCell className='min-w-[70px] flex-[0.7] text-right'>
                  Tokens
                </HeadCell>
              )}
              {isHidden('cache') ? null : (
                <HeadCell className='min-w-[70px] flex-[0.8] text-right'>
                  缓存
                </HeadCell>
              )}
              {isHidden('cost') ? null : (
                <HeadCell className='min-w-[96px] flex-[0.9] text-right'>
                  成本
                </HeadCell>
              )}
              {isHidden('performance') ? null : (
                <HeadCell className='min-w-[104px] flex-[1] text-right'>
                  性能
                </HeadCell>
              )}
              <HeadCell className='min-w-[70px] flex-[0.7] pr-3 pl-1.5 text-right'>
                状态
              </HeadCell>
            </div>
          </div>
          <div
            ref={parentRef}
            className={cn(
              'h-[600px] [scrollbar-gutter:stable] overflow-auto',
              bodyClassName
            )}
            onScroll={handleScroll}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualRow) => {
                const row = allLogs[virtualRow.index]
                const style = {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                } as const
                if (!row) {
                  return (
                    <div
                      key='loader'
                      style={style}
                      className='flex items-center justify-center'
                    >
                      <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                    </div>
                  )
                }
                return (
                  <div
                    key={row.id}
                    style={style}
                    role='button'
                    tabIndex={0}
                    className={cn(
                      'flex cursor-pointer items-center overflow-hidden border-b border-border/40 text-sm transition-colors outline-none hover:bg-accent/50 focus-visible:bg-accent/50',
                      isNonBillingEndpoint(row.endpoint) &&
                        'bg-muted/30 text-muted-foreground dark:bg-muted/15'
                    )}
                    onClick={(event) => {
                      // Cells with their own action (copy, chain popover, redirect) keep it;
                      // clicks bubbling from portaled popovers are outside the row DOM.
                      const target = event.target as HTMLElement
                      if (!event.currentTarget.contains(target)) return
                      if (target.closest('button, a')) return
                      onOpenDetail(row)
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onOpenDetail(row)
                    }}
                  >
                    <LogRow
                      row={row}
                      hidden={isHidden}
                      onOpenDetail={onOpenDetail}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      {!hideScrollToTop && showScrollToTop ? (
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='fixed right-8 bottom-8 z-50 shadow-lg'
          onClick={scrollToTop}
        >
          <ArrowUp className='mr-1 h-4 w-4' />
          回到顶部
        </Button>
      ) : null}
    </div>
  )
}
