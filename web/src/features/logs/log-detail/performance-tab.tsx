import {
  Activity,
  ArrowRightLeft,
  Clock,
  Gauge,
  ListChecks,
  Server,
  Timer,
  Zap,
} from 'lucide-react'
import type { UsageLogRow, ProviderChainItem } from '@/types/panel-usage-logs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  calculateOutputRate,
  formatDuration,
  formatTokenAmount,
} from '@/lib/usage-format'

/**
 * 请求计时详情。
 *
 * 原理照 sub2api 的 `UsageTimingDialog`（四档健康带 + 六指标 + 三列分组 +
 * 比例时间线 + 每次尝试 + 未采集显式标注），外观用本仓库既有组件与配色：
 * `rounded-lg border bg-card`、图标块指标卡、`Badge`、`Alert`。
 *
 * 阈值（同 sub2api 的 `latencyHealth.ts` / `requestTimingHealth.ts`）：
 *   首 Token：10s / 30s / 60s        总耗时：60s / 180s / 300s
 *   本地与连接阶段：200ms / 1s / 5s   TPS：≥20 正常、10–20 注意、<10 严重
 */

type Health = 'good' | 'warn' | 'slow' | 'critical' | 'neutral'

const TEXT: Record<Health, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  slow: 'text-orange-600 dark:text-orange-400',
  critical: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-muted-foreground',
}

const DOT: Record<Health, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  slow: 'bg-orange-500',
  critical: 'bg-rose-500',
  neutral: 'bg-muted-foreground/50',
}

const HEALTH_LABEL: Record<Health, string> = {
  good: '正常',
  warn: '注意',
  slow: '缓慢',
  critical: '严重',
  neutral: '信息',
}

const BADGE: Record<Health, string> = {
  good: 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
  slow: 'border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300',
  critical: 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300',
  neutral: 'border-border text-muted-foreground',
}

const FIRST_TOKEN = { warn: 10_000, slow: 30_000, critical: 60_000 }
const DURATION = { warn: 60_000, slow: 180_000, critical: 300_000 }
const STAGE = { warn: 200, slow: 1_000, critical: 5_000 }

function classify(
  ms: number | null | undefined,
  band: { warn: number; slow: number; critical: number },
): Health {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'neutral'
  if (ms >= band.critical) return 'critical'
  if (ms >= band.slow) return 'slow'
  if (ms >= band.warn) return 'warn'
  return 'good'
}

const firstTokenHealth = (ms: number | null) => classify(ms, FIRST_TOKEN)
const durationHealth = (ms: number | null) => classify(ms, DURATION)
const stageHealth = (ms: number | null) => classify(ms, STAGE)

function tpsHealth(tps: number | null): Health {
  if (tps == null || !Number.isFinite(tps)) return 'neutral'
  if (tps < 10) return 'critical'
  if (tps < 20) return 'warn'
  return 'good'
}

function HealthTag({ health }: { health: Health }) {
  if (health === 'good' || health === 'neutral') return null
  return (
    <Badge
      variant='outline'
      className={cn(
        'shrink-0 px-1 py-0 text-[10px] leading-tight',
        BADGE[health],
      )}
    >
      {HEALTH_LABEL[health]}
    </Badge>
  )
}

function SectionTitle({
  icon: Icon,
  color,
  children,
}: {
  icon: typeof Zap
  color: string
  children: React.ReactNode
}) {
  return (
    <h4 className='flex items-center gap-2 text-sm font-semibold'>
      <Icon className={cn('h-4 w-4', color)} />
      {children}
    </h4>
  )
}

/** 指标卡：沿用 summary-tab 的图标块布局，右上挂健康标。 */
function MetricCard({
  icon: Icon,
  iconClass,
  bgClass,
  label,
  value,
  health,
  hint,
}: {
  icon: typeof Zap
  iconClass: string
  bgClass: string
  label: string
  value: string
  health: Health
  hint?: string
}) {
  return (
    <div className='flex items-start gap-3 rounded-lg border bg-card p-3'>
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          bgClass,
        )}
      >
        <Icon className={cn('h-4 w-4', iconClass)} />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-xs text-muted-foreground'>{label}</span>
          <HealthTag health={health} />
        </div>
        <div
          className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            TEXT[health],
          )}
        >
          {value}
        </div>
        {hint ? (
          <div className='text-[10px] text-muted-foreground'>{hint}</div>
        ) : null}
      </div>
    </div>
  )
}

/** 字段行：左标签右值；缺数据时显式写「未采集」。 */
function FieldRow({
  label,
  value,
  health = 'neutral',
  missing,
}: {
  label: string
  value: string | null
  health?: Health
  missing?: boolean
}) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <span className='shrink-0 text-xs text-muted-foreground'>{label}</span>
      <span
        className={cn(
          'text-right font-mono text-xs tabular-nums',
          missing ? 'text-[10px] text-muted-foreground/70' : TEXT[health],
        )}
      >
        {value ?? '未采集'}
      </span>
    </div>
  )
}

function Card({
  title,
  icon,
  color,
  children,
}: {
  title: string
  icon: typeof Zap
  color: string
  children: React.ReactNode
}) {
  return (
    <section className='space-y-3 rounded-lg border bg-card p-4'>
      <SectionTitle icon={icon} color={color}>
        {title}
      </SectionTitle>
      <div className='space-y-2.5'>{children}</div>
    </section>
  )
}

type Span = {
  label: string
  start: number
  end: number
  health: Health
  neutral?: boolean
}

function buildSpans(row: UsageLogRow): Span[] {
  const fb = row.firstByteMs
  const ttft = row.ttftMs
  const gen = row.generationMs
  const dur = row.durationMs
  const spans: Span[] = []
  if (fb != null) {
    spans.push({
      label: '到上游首字节',
      start: 0,
      end: fb,
      // 含上游首包（可能排队），按首 token 宽带判；本地阶段才用 200ms/1s/5s。
      health: firstTokenHealth(fb),
    })
  }
  if (fb != null && ttft != null && ttft >= fb) {
    spans.push({
      label: '上游思考（首字节→首 token）',
      start: fb,
      end: ttft,
      health: firstTokenHealth(ttft - fb),
    })
  }
  if (fb != null && gen != null && gen > 0) {
    spans.push({
      label: '上游生成窗口',
      start: fb,
      end: fb + gen,
      health: 'neutral',
      neutral: true,
    })
  }
  if (dur != null && fb != null && gen != null) {
    const end = fb + gen
    if (dur > end) {
      spans.push({
        label: '收尾（生成结束→响应结束）',
        start: end,
        end: dur,
        health: stageHealth(dur - end),
      })
    }
  }
  return spans
}

export function PerformanceTab({ row }: { row: UsageLogRow }) {
  const fb = row.firstByteMs
  const ttft = row.ttftMs
  const gen = row.generationMs
  const dur = row.durationMs
  const rate = calculateOutputRate(row.outputTokens, gen)
  const thinking = fb != null && ttft != null && ttft >= fb ? ttft - fb : null

  if (fb == null && ttft == null && gen == null && dur == null) {
    return (
      <div className='rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground'>
        <Gauge className='mx-auto mb-2 h-8 w-8 opacity-50' />
        这次请求没有留下计时数据，无法拆解。
        <div className='mt-1 text-xs'>
          历史记录、未采集的协议和失败请求都可能没有阶段数据。
        </div>
      </div>
    )
  }

  const spans = buildSpans(row)
  const ttftHealth = firstTokenHealth(ttft)
  const localStages = spans
    .filter((s) => !s.neutral)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
  const longest = localStages[0] ?? null
  const scaleMax = Math.max(dur ?? 0, ...spans.map((s) => s.end), 1)
  const failed = row.statusCode != null && row.statusCode !== 200

  const verdict = failed
    ? `请求失败（HTTP ${row.statusCode}），先看下方尝试记录。`
    : ttft == null
      ? '首 token 数据缺失，无法判断响应速度。'
      : ttftHealth === 'good'
        ? `输出在约 ${formatDuration(ttft)} 后开始，处于正常区间。`
        : `输出在约 ${formatDuration(ttft)} 后才开始，偏慢；对照下方首字节与思考时间。`

  return (
    <div className='space-y-5'>
      <div className='rounded-lg border bg-card p-4'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <span className='font-mono text-sm font-semibold'>
            {row.model ?? row.originalModel ?? '—'}
          </span>
          <span className='text-xs text-muted-foreground'>
            {row.createdAt?.replace('T', ' ').slice(0, 19)}
          </span>
        </div>
        <div className='mt-1.5 break-all font-mono text-[11px] text-muted-foreground'>
          {row.requestId ?? '—'}
        </div>
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <MetricCard
          icon={ArrowRightLeft}
          iconClass='text-sky-600'
          bgClass='bg-sky-50 dark:bg-sky-950/30'
          label='首字节 TTFB'
          value={formatDuration(fb)}
          health={firstTokenHealth(fb)}
          hint='建连 + 上行 + 上游首包'
        />
        <MetricCard
          icon={Timer}
          iconClass='text-blue-600'
          bgClass='bg-blue-50 dark:bg-blue-950/30'
          label='首 Token（TTFT）'
          value={formatDuration(ttft)}
          health={ttftHealth}
          hint='从入站算起，含首字节'
        />
        <MetricCard
          icon={Clock}
          iconClass='text-violet-600'
          bgClass='bg-violet-50 dark:bg-violet-950/30'
          label='总耗时'
          value={formatDuration(dur)}
          health={durationHealth(dur)}
        />
        <MetricCard
          icon={Activity}
          iconClass='text-amber-600'
          bgClass='bg-amber-50 dark:bg-amber-950/30'
          label='上游思考'
          value={formatDuration(thinking)}
          health={firstTokenHealth(thinking)}
          hint='首字节 → 首 token'
        />
        <MetricCard
          icon={Server}
          iconClass='text-slate-600'
          bgClass='bg-slate-50 dark:bg-slate-900/40'
          label='上游生成窗口'
          value={formatDuration(gen)}
          health='neutral'
          hint='含不可见推理'
        />
        <MetricCard
          icon={Zap}
          iconClass='text-emerald-600'
          bgClass='bg-emerald-50 dark:bg-emerald-950/30'
          label='输出速率'
          value={rate == null ? '—' : `${rate.toFixed(1)} t/s`}
          health={tpsHealth(rate)}
        />
      </div>

      <Alert>
        <Gauge className='text-sky-600' />
        <AlertTitle>这次请求表现如何？</AlertTitle>
        <AlertDescription>
          <p>{verdict}</p>
          {longest ? (
            <p className='mt-1'>
              最长的非生成阶段：{longest.label}，
              {formatDuration(longest.end - longest.start)}
              。阶段可能重叠，不能直接相加。
            </p>
          ) : null}
          <div className='mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px]'>
            {(['good', 'warn', 'slow', 'critical', 'neutral'] as Health[]).map(
              (h) => (
                <span key={h} className='inline-flex items-center gap-1.5'>
                  <span className={cn('h-2 w-2 rounded-full', DOT[h])} />
                  {HEALTH_LABEL[h]}
                </span>
              ),
            )}
          </div>
          <details className='mt-2 text-[11px]'>
            <summary className='cursor-pointer text-muted-foreground'>
              颜色怎么读
            </summary>
            <p className='mt-1 leading-relaxed text-muted-foreground'>
              诊断参考带，不是 SLA。首 Token：绿 &lt;10s、黄 10–30s、橙 30–60s、红
              ≥60s；总耗时：绿 &lt;60s、黄 60–180s、橙 180–300s、红 ≥300s；
              本地与连接阶段：绿 &lt;200ms、黄 200ms–1s、橙 1–5s、红 ≥5s；
              TPS：≥20 正常、10–20 注意、&lt;10 严重。长输出天然更慢；字节数、
              速率、偏移一律按「信息」显示。
            </p>
          </details>
        </AlertDescription>
      </Alert>

      <div className='grid gap-4 lg:grid-cols-3'>
        <Card title='客户端 → 网关' icon={ArrowRightLeft} color='text-sky-600'>
          <FieldRow label='端点' value={row.endpoint ?? '—'} />
          <FieldRow label='协议' value={row.protocol ?? '—'} />
          <FieldRow label='流式' value={row.stream ? '是' : '否'} />
          <FieldRow
            label='入站消息量'
            value={`${formatTokenAmount(row.inputTokens)} tokens`}
          />
          <FieldRow label='请求体大小' value={null} missing />
          <FieldRow label='请求体读取耗时' value={null} missing />
          <FieldRow label='读取速率' value={null} missing />
        </Card>

        <Card title='网关内部' icon={Server} color='text-violet-600'>
          <FieldRow
            label='排队 / 调度'
            value={
              row.providerChain[0]?.queueWaitMs != null
                ? formatDuration(row.providerChain[0].queueWaitMs)
                : null
            }
            health={stageHealth(row.providerChain[0]?.queueWaitMs ?? null)}
            missing={row.providerChain[0]?.queueWaitMs == null}
          />
          <FieldRow label='鉴权与准入' value={null} missing />
          <FieldRow label='账号选择' value={null} missing />
          <FieldRow label='取上游凭据' value={null} missing />
          <FieldRow label='构建上游请求' value={null} missing />
          <FieldRow
            label='到上游首字节'
            value={formatDuration(fb)}
            health={firstTokenHealth(fb)}
          />
          <FieldRow
            label='上游思考'
            value={formatDuration(thinking)}
            health={firstTokenHealth(thinking)}
          />
        </Card>

        <Card title='结果与转发' icon={ListChecks} color='text-emerald-600'>
          <FieldRow
            label='状态码'
            value={row.statusCode == null ? '—' : String(row.statusCode)}
            health={row.statusCode === 200 ? 'good' : 'critical'}
          />
          <FieldRow
            label='尝试次数'
            value={String(row.attemptCount ?? row.providerChain.length ?? 1)}
          />
          <FieldRow label='终态' value={row.finalState ?? '—'} />
          <FieldRow
            label='输出 tokens'
            value={formatTokenAmount(row.outputTokens)}
          />
          <FieldRow
            label='缓存读取'
            value={formatTokenAmount(row.cacheReadInputTokens)}
          />
          <FieldRow
            label='回合门票'
            value={
              row.turnStateVerdict == null
                ? null
                : row.turnStateVerdict === 'ok'
                  ? `正常（${row.turnStateBlocks} 块）`
                  : row.turnStateVerdict === 'absent'
                    ? '上游未发（裸打）'
                    : row.turnStateVerdict === 'short'
                      ? `块数不足（${row.turnStateBlocks}）`
                      : row.turnStateVerdict === 'tall'
                        ? `块数超出（${row.turnStateBlocks}）`
                        : '信封不合法'
            }
            health={
              row.turnStateVerdict === 'ok'
                ? 'good'
                : row.turnStateVerdict === 'absent'
                  ? 'critical'
                  : 'slow'
            }
            missing={row.turnStateVerdict == null}
          />
          <FieldRow
            label='门票签发时间'
            value={row.turnStateIssuedAt?.replace('T', ' ').slice(0, 19) ?? null}
            missing={!row.turnStateIssuedAt}
          />
          <FieldRow label='下行写入字节' value={null} missing />
          <FieldRow label='下行写/刷耗时' value={null} missing />
          <FieldRow label='客户端断开' value={null} missing />
        </Card>
      </div>

      {spans.length ? (
        <section className='space-y-3 rounded-lg border bg-card p-4'>
          <SectionTitle icon={Timer} color='text-blue-600'>
            处理时间线
          </SectionTitle>
          <p className='text-[11px] text-muted-foreground'>
            起点相对入站。父子区间与读写可能重叠，不能相加；空白处没有埋点。
          </p>
          <div className='space-y-3'>
            {spans.map((s) => {
              const ms = s.end - s.start
              const left = (s.start / scaleMax) * 100
              const width = Math.max((ms / scaleMax) * 100, 0.6)
              return (
                <div key={s.label}>
                  <div className='flex justify-between gap-2 text-[11px]'>
                    <span>{s.label}</span>
                    <span className={TEXT[s.health]}>
                      {formatDuration(s.start)} → {formatDuration(s.end)} ·{' '}
                      <strong>{formatDuration(ms)}</strong>
                    </span>
                  </div>
                  <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-muted'>
                    <div
                      className={cn('h-full rounded-full', DOT[s.health])}
                      style={{ marginLeft: `${left}%`, width: `${width}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <AttemptBreakdown chain={row.providerChain} />

      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        计时以本网关观测为准，不含公网全链路；首 token 在事件解析阶段测得，
        写出成功不代表客户端已收到。单次尝试若未落 attempt 记录，
        「排队 vs 上游」无法拆分。
      </p>
    </div>
  )
}

function AttemptBreakdown({ chain }: { chain: ProviderChainItem[] }) {
  if (!chain.length) return null
  return (
    <div className='space-y-3'>
      {chain.map((a, i) => (
        <section
          key={`${a.attemptNumber}-${i}`}
          className='space-y-3 rounded-lg border bg-card p-4'
        >
          <SectionTitle icon={Server} color='text-slate-600'>
            上游尝试 #{a.attemptNumber} · 账号{' '}
            {a.providerName || a.accountId || '—'}
            {a.vmName || a.vmId ? ` · 槽位 ${a.vmName || a.vmId}` : ''}
          </SectionTitle>
          <div className='grid gap-x-8 gap-y-2 md:grid-cols-2'>
            <FieldRow
              label='尝试耗时'
              value={formatDuration(a.latencyMs)}
              health={stageHealth(a.latencyMs)}
            />
            <FieldRow
              label='状态'
              value={a.upstreamStatus == null ? '—' : String(a.upstreamStatus)}
              health={a.upstreamStatus === 200 ? 'good' : 'critical'}
            />
            <FieldRow
              label='排队'
              value={formatDuration(a.queueWaitMs)}
              health={stageHealth(a.queueWaitMs)}
              missing={a.queueWaitMs == null}
            />
            <FieldRow
              label='调度'
              value={formatDuration(a.schedulingMs)}
              health={stageHealth(a.schedulingMs)}
              missing={a.schedulingMs == null}
            />
            <FieldRow
              label='TTFT'
              value={formatDuration(a.ttftMs)}
              health={firstTokenHealth(a.ttftMs)}
              missing={a.ttftMs == null}
            />
            <FieldRow label='选择原因' value={a.selectionReason ?? '—'} />
            <FieldRow label='终态' value={a.terminalState ?? '—'} />
            <FieldRow
              label='错误域'
              value={a.errorScope ?? '—'}
              health={a.errorScope ? 'warn' : 'neutral'}
            />
            <FieldRow label='连接复用' value={null} missing />
            <FieldRow label='请求/响应字节' value={null} missing />
          </div>
        </section>
      ))}
    </div>
  )
}
