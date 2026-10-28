import type { UsageLogRow } from '@/types/panel-usage-logs'
import { Clock, Gauge, Zap } from 'lucide-react'
import {
  calculateOutputRate,
  formatDuration,
  formatTokenAmount,
} from '@/lib/usage-format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { CircularProgress } from '@/components/ui/circular-progress'
import { latencySegments, queueWaitMs } from '../log-display'
import { LatencyBreakdownBar } from './latency-breakdown-bar'

type Assessment = { label: string; color: string; bg: string }

const ASSESSMENTS: Record<
  'excellent' | 'good' | 'warning' | 'poor',
  Assessment
> = {
  excellent: {
    label: '优秀',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 dark:bg-emerald-950/20',
  },
  good: {
    label: '良好',
    color: 'text-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
  },
  warning: {
    label: '警告',
    color: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
  },
  poor: {
    label: '较差',
    color: 'text-rose-600',
    bg: 'bg-rose-50 dark:bg-rose-950/20',
  },
}

function PerformanceGauge({
  value,
  max,
  icon: Icon,
  label,
  display,
  assessment,
}: {
  value: number
  max: number
  icon: typeof Clock
  label: string
  display: string
  assessment: Assessment
}) {
  return (
    <div
      className={cn(
        'flex flex-1 items-center gap-4 rounded-lg border p-4',
        assessment.bg
      )}
    >
      <div className='relative'>
        <CircularProgress
          value={Math.min(value, max)}
          max={max}
          size={64}
          strokeWidth={5}
          showPercentage={false}
          toneClassName={assessment.color}
        />
        <Icon
          className={cn(
            'absolute top-1/2 left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2',
            assessment.color
          )}
        />
      </div>
      <div className='min-w-0'>
        <div className='text-xs text-muted-foreground'>{label}</div>
        <div className='font-mono text-xl font-bold'>{display}</div>
        <Badge
          variant='outline'
          className={cn('mt-1 text-[10px]', assessment.color)}
        >
          {assessment.label}
        </Badge>
      </div>
    </div>
  )
}

export function PerformanceTab({ row }: { row: UsageLogRow }) {
  const { ttftMs, durationMs, outputTokens, firstByteMs, generationMs } = row
  const rate = calculateOutputRate(outputTokens, generationMs)
  const wait = row.providerChain[0]?.waitMs ?? null
  const queued = queueWaitMs(row.providerChain)
  const scheduling = row.providerChain[0]?.schedulingMs ?? null
  const breakdown = latencySegments({
    waitMs: wait,
    queueWaitMs: queued,
    schedulingMs: scheduling,
    firstByteMs,
    ttftMs,
    generationMs,
    durationMs,
  })

  if (
    ttftMs == null &&
    durationMs == null &&
    firstByteMs == null &&
    generationMs == null
  ) {
    return (
      <div className='py-8 text-center text-muted-foreground'>
        <Gauge className='mx-auto mb-2 h-8 w-8 opacity-50' />
        暂无性能数据
      </div>
    )
  }

  const ttftAssessment =
    ttftMs == null
      ? null
      : ASSESSMENTS[
          ttftMs < 1000
            ? 'excellent'
            : ttftMs < 2000
              ? 'good'
              : ttftMs < 3000
                ? 'warning'
                : 'poor'
        ]
  const rateAssessment =
    rate == null
      ? null
      : ASSESSMENTS[
          rate >= 80
            ? 'excellent'
            : rate >= 50
              ? 'good'
              : rate >= 30
                ? 'warning'
                : 'poor'
        ]

  const finalizationMs =
    breakdown?.find((s) => s.key === 'finalization')?.ms ?? 0

  const rows: [string, string][] = []
  if (scheduling != null) rows.push(['调度处理', formatDuration(scheduling)])
  if (queued != null) rows.push(['排队等待', formatDuration(queued)])
  if (scheduling == null && wait != null)
    rows.push(['调度与排队（未拆分）', formatDuration(wait)])
  if (firstByteMs != null)
    rows.push(['首字节时间（TTFB）', formatDuration(firstByteMs)])
  if (ttftMs != null)
    rows.push(['首 Token 时间（TTFT）', formatDuration(ttftMs)])
  if (generationMs != null && generationMs > 0)
    rows.push(['上游输出时间（含推理）', formatDuration(generationMs)])
  if (finalizationMs > 0) rows.push(['收尾', formatDuration(finalizationMs)])
  if (durationMs != null) rows.push(['总耗时', formatDuration(durationMs)])
  rows.push(['输出 Tokens', formatTokenAmount(outputTokens)])
  if (rate != null) rows.push(['输出速率', `${rate.toFixed(1)} tok/s`])

  return (
    <div className='space-y-6'>
      {ttftAssessment || rateAssessment ? (
        <div className='flex flex-col gap-4 sm:flex-row'>
          {ttftAssessment && ttftMs != null ? (
            <PerformanceGauge
              value={ttftMs}
              max={3000}
              icon={Clock}
              label='首 Token 时间'
              display={formatDuration(ttftMs)}
              assessment={ttftAssessment}
            />
          ) : null}
          {rateAssessment && rate != null ? (
            <PerformanceGauge
              value={rate}
              max={100}
              icon={Zap}
              label='输出速率'
              display={`${rate.toFixed(1)} tok/s`}
              assessment={rateAssessment}
            />
          ) : null}
        </div>
      ) : null}
      {breakdown ? (
        <div className='space-y-2'>
          <h4 className='flex items-center gap-2 text-sm font-semibold'>
            <Gauge className='h-4 w-4 text-purple-600' />
            延迟分解
          </h4>
          <div className='rounded-lg border bg-card p-4'>
            <LatencyBreakdownBar
              waitMs={wait}
              queueWaitMs={queued}
              schedulingMs={scheduling}
              firstByteMs={firstByteMs}
              ttftMs={ttftMs}
              generationMs={generationMs}
              durationMs={durationMs}
            />
          </div>
        </div>
      ) : null}
      <div className='space-y-2'>
        <h4 className='text-sm font-semibold'>性能数据</h4>
        <div className='divide-y rounded-lg border bg-card'>
          {rows.map(([label, value]) => (
            <div
              key={label}
              className='flex items-center justify-between px-4 py-3'
            >
              <span className='text-sm text-muted-foreground'>{label}</span>
              <span className='font-mono text-sm font-medium'>{value}</span>
            </div>
          ))}
        </div>
        {generationMs != null && generationMs > 0 ? (
          <p className='text-xs text-muted-foreground'>
            上游输出窗口从首个协议事件计到终止生成事件，含不可见推理；速率用该窗口，不含收尾。
          </p>
        ) : null}
      </div>

      <StageTimeline
        waitMs={wait}
        queueWaitMs={queued}
        schedulingMs={scheduling}
        firstByteMs={firstByteMs}
        ttftMs={ttftMs}
        generationMs={generationMs}
        durationMs={durationMs}
      />

      <AttemptBreakdown row={row} />
    </div>
  )
}

function toneOf(ms: number | null, watch: number, slow: number) {
  if (ms == null) return 'text-muted-foreground'
  if (ms >= slow) return 'text-rose-600 dark:text-rose-400'
  if (ms >= watch) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

type Stage = {
  label: string
  startMs: number | null
  endMs: number | null
  ms: number | null
  note: string
}

/**
 * 阶段时间线：把一次请求拆成可归因的几段。
 *
 * 只用真正打过点的字段推算；TCP/TLS/DNS/请求体读取/下游写入没有埋点，
 * 单独列成「未采集」，不允许拿 0 或估算值冒充。
 */
function StageTimeline({
  waitMs,
  queueWaitMs,
  schedulingMs,
  firstByteMs,
  ttftMs,
  generationMs,
  durationMs,
}: {
  waitMs: number | null
  queueWaitMs: number | null
  schedulingMs: number | null
  firstByteMs: number | null
  ttftMs: number | null
  generationMs: number | null
  durationMs: number | null
}) {
  const stages: Stage[] = []
  const gateEnd = waitMs ?? queueWaitMs ?? schedulingMs ?? null
  if (gateEnd != null && gateEnd > 0) {
    stages.push({
      label: '网关排队/调度',
      startMs: 0,
      endMs: gateEnd,
      ms: gateEnd,
      note: '取号 + 等并发名额',
    })
  }
  if (firstByteMs != null) {
    const from = gateEnd != null && gateEnd < firstByteMs ? gateEnd : 0
    stages.push({
      label: '到上游首字节',
      startMs: from,
      endMs: firstByteMs,
      ms: firstByteMs - from,
      note: '建连 + 上行 + 上游首包',
    })
  }
  if (firstByteMs != null && ttftMs != null && ttftMs >= firstByteMs) {
    stages.push({
      label: '上游思考（首字节→首 token）',
      startMs: firstByteMs,
      endMs: ttftMs,
      ms: ttftMs - firstByteMs,
      note: '模型推理，不含网络',
    })
  }
  if (firstByteMs != null && generationMs != null && generationMs > 0) {
    stages.push({
      label: '上游生成窗口',
      startMs: firstByteMs,
      endMs: firstByteMs + generationMs,
      ms: generationMs,
      note: '含不可见推理，与上一段重叠',
    })
  }
  if (firstByteMs != null && generationMs != null && durationMs != null) {
    const end = firstByteMs + generationMs
    if (durationMs > end) {
      stages.push({
        label: '收尾（生成结束→响应结束）',
        startMs: end,
        endMs: durationMs,
        ms: durationMs - end,
        note: '下游写出与清理',
      })
    }
  }

  if (!stages.length) return null

  return (
    <div className='space-y-2'>
      <h4 className='text-sm font-semibold'>阶段拆解</h4>
      <div className='divide-y rounded-lg border bg-card'>
        <div className='flex items-center justify-between px-4 py-2 text-[11px] text-muted-foreground'>
          <span>阶段</span>
          <span className='font-mono'>起点 → 终点 ／ 耗时</span>
        </div>
        {stages.map((s) => (
          <div key={s.label} className='px-4 py-2.5'>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-sm'>{s.label}</span>
              <span
                className={cn(
                  'shrink-0 font-mono text-sm font-medium',
                  toneOf(
                    s.ms,
                    s.label.includes('思考') ? 10000 : 3000,
                    s.label.includes('思考') ? 20000 : 10000,
                  ),
                )}
              >
                {formatDuration(s.ms)}
              </span>
            </div>
            <div className='mt-0.5 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground'>
              <span>{s.note}</span>
              <span className='font-mono'>
                {formatDuration(s.startMs)} → {formatDuration(s.endMs)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className='text-xs text-muted-foreground'>
        未采集：TCP/TLS/DNS 握手、请求体读取、下游写入耗时。这几项没有埋点，
        不填 0、不估算；面板上出现的耗时都能追到上面的阶段。
      </p>
    </div>
  )
}

/** 每次上游尝试（含失败/切换）的明细。 */
function AttemptBreakdown({ row }: { row: UsageLogRow }) {
  const chain = row.providerChain
  if (!chain.length) {
    return (
      <p className='text-xs text-muted-foreground'>
        本次请求没有尝试记录（单次尝试未落 attempt），因此「排队 vs 上游」无法拆分。
      </p>
    )
  }
  return (
    <div className='space-y-2'>
      <h4 className='text-sm font-semibold'>上游尝试（{chain.length}）</h4>
      <div className='divide-y rounded-lg border bg-card'>
        {chain.map((a, i) => (
          <div key={`${a.attemptNumber}-${i}`} className='px-4 py-3'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <span className='text-sm font-medium'>
                #{a.attemptNumber} {a.vmName || a.vmId || '—'}
                {a.providerName ? (
                  <span className='ml-1 text-xs text-muted-foreground'>
                    {a.providerName}
                  </span>
                ) : null}
              </span>
              <Badge
                variant='outline'
                className={cn(
                  'px-1.5 py-0 text-[10px] leading-tight',
                  a.upstreamStatus === 200
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-rose-500 text-rose-600',
                )}
              >
                {a.upstreamStatus ?? '—'}
              </Badge>
            </div>
            <div className='mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-4'>
              <span>排队 {formatDuration(a.queueWaitMs)}</span>
              <span>调度 {formatDuration(a.schedulingMs)}</span>
              <span>TTFT {formatDuration(a.ttftMs)}</span>
              <span>总耗时 {formatDuration(a.latencyMs)}</span>
            </div>
            <div className='mt-1 text-[11px] text-muted-foreground'>
              选择原因 {a.selectionReason || '—'} · 终态 {a.terminalState || '—'}
              {a.errorScope ? ` · 错误域 ${a.errorScope}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
