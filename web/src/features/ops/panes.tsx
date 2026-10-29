import { AlertTriangle, CheckCircle2, Clock, TicketX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatTokenAmount, formatDuration } from '@/lib/usage-format'
import { cn } from '@/lib/utils'
import type { OpsSummary } from './types'

const CARD = 'rounded-lg border bg-card p-4'

function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
  hint?: string
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-foreground'
  return (
    <div className={CARD}>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className={cn('mt-1 font-mono text-lg font-semibold tabular-nums', color)}>
        {value}
      </div>
      {hint ? <div className='mt-0.5 text-[10px] text-muted-foreground'>{hint}</div> : null}
    </div>
  )
}

function verdictLabel(v: string) {
  switch (v) {
    case 'ok':
      return '正常'
    case 'short':
      return '块数不足'
    case 'tall':
      return '块数超出'
    case 'malformed':
      return '信封不合法'
    case 'absent':
      return '无票（裸打）'
    default:
      return '未采集'
  }
}

function verdictTone(v: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (v === 'ok') return 'good'
  if (v === 'uncollected') return 'neutral'
  if (v === 'short' || v === 'tall' || v === 'malformed') return 'warn'
  return 'bad'
}

export function TicketPane({ data }: { data: OpsSummary }) {
  const total = data.totals.requests || 0
  const bucket = (v: string) => data.tickets.find((t) => t.verdict === v)?.n ?? 0
  const absent = bucket('absent')
  const ok = bucket('ok')
  const bad = bucket('short') + bucket('tall') + bucket('malformed')

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Stat label='请求数（24h）' value={String(total)} />
        <Stat label='门票正常' value={String(ok)} tone={ok ? 'good' : 'neutral'} />
        <Stat
          label='无票（裸打）'
          value={String(absent)}
          tone={absent ? 'bad' : 'good'}
          hint={total ? `${Math.round((absent / total) * 100)}% 的请求没有回带门票` : undefined}
        />
        <Stat
          label='块数异常'
          value={String(bad)}
          tone={bad ? 'warn' : 'good'}
          hint='不足 / 超出 / 信封不合法'
        />
      </div>

      {absent > 0 ? (
        <div className='flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'>
          <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
          <span>
            上游没有给我们铸票。按 sub2api 的模型，无票请求会被当成非正常客户端、
            可能被降档服务（表现为「变笨」）。下一步是区分「上游不铸」还是「transport 丢头」。
          </span>
        </div>
      ) : null}

      <section className={CARD}>
        <h4 className='mb-3 text-sm font-semibold'>按账号</h4>
        <div className='space-y-1.5'>
          {data.ticketSlots.length === 0 ? (
            <p className='text-xs text-muted-foreground'>窗口内没有请求。</p>
          ) : (
            data.ticketSlots.map((s) => (
              <div
                key={`${s.vm_id}-${s.verdict}`}
                className='flex items-center justify-between gap-3 text-xs'
              >
                <span className='font-mono'>{s.vm_id ?? '—'}</span>
                <span className='flex items-center gap-2'>
                  <Badge
                    variant='outline'
                    className={cn(
                      'px-1 py-0 text-[10px] leading-tight',
                      verdictTone(s.verdict) === 'good'
                        ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                        : verdictTone(s.verdict) === 'bad'
                          ? 'border-rose-300 text-rose-700 dark:text-rose-300'
                          : verdictTone(s.verdict) === 'warn'
                            ? 'border-amber-300 text-amber-700 dark:text-amber-300'
                            : 'text-muted-foreground',
                    )}
                  >
                    {verdictLabel(s.verdict)}
                  </Badge>
                  <span className='tabular-nums text-muted-foreground'>n={s.n}</span>
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        判据：base64url → 0x80 信封 → 块数 = (len-57)/16；个人版期望 10 块、Team 系 12 块，
        只有恰好相等才算正常。详见 docs/ops/ticketing.md。
      </p>
    </div>
  )
}

export function IqPane({ data }: { data: OpsSummary }) {
  const downgraded = data.effort.filter(
    (e) => e.got !== '(未采集)' && e.asked !== e.got && e.asked !== '(空)',
  )
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <Stat
          label='模型被替换'
          value={data.modelMismatch ? String(data.modelMismatch) : '0'}
          tone={data.modelMismatch ? 'bad' : 'good'}
          hint='发出模型 ≠ 上游回包模型'
        />
        <Stat
          label='effort 被降档'
          value={String(downgraded.reduce((a, b) => a + b.n, 0))}
          tone={downgraded.length ? 'bad' : 'good'}
          hint='请求档位 > 上游回显档位'
        />
        <Stat
          label='无票请求'
          value={String(data.tickets.find((t) => t.verdict === 'absent')?.n ?? 0)}
          tone='warn'
          hint='门票缺失也会让上游降档'
        />
      </div>

      <section className={CARD}>
        <h4 className='mb-3 text-sm font-semibold'>effort 请求 vs 上游回显</h4>
        <div className='space-y-1.5 text-xs'>
          {data.effort.length === 0 ? (
            <p className='text-muted-foreground'>窗口内没有请求。</p>
          ) : (
            data.effort.map((e) => (
              <div key={`${e.asked}-${e.got}`} className='flex justify-between gap-3'>
                <span className='font-mono'>
                  {e.asked} → {e.got}
                </span>
                <span className='tabular-nums text-muted-foreground'>n={e.n}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <div className='flex gap-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300'>
        <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
        <span>
          先用硬事实排除：模型没被换、effort 没被降，剩下的才是「能力真的下降」。
          题库（candy）与鹈鹕结构指纹尚未接入，计划接 probe 的判据，详见 docs/ops/iq-detection.md。
        </span>
      </div>
    </div>
  )
}

export function CachePane({ data }: { data: OpsSummary }) {
  const t = data.totals
  const rate = t.cache_hit_rate == null ? null : t.cache_hit_rate * 100
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Stat
          label='命中率'
          value={rate == null ? '—' : `${rate.toFixed(1)}%`}
          tone={rate == null ? 'neutral' : rate >= 50 ? 'good' : rate >= 30 ? 'warn' : 'bad'}
        />
        <Stat label='读命中' value={formatTokenAmount(t.cache_read_tokens)} />
        <Stat
          label='写入'
          value={formatTokenAmount(t.cache_creation_tokens)}
          hint='隐式缓存链路恒 0，不算异常'
        />
        <Stat label='输入（全价）' value={formatTokenAmount(t.input_tokens)} />
      </div>
      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        命中率 = 读命中 ÷（输入 + 读命中 + 写入）。Codex/ChatGPT 是隐式缓存，上游只回命中读取，
        不单独上报写入量，所以「写入 0」是正常现象。详见 docs/ops/cache.md。
      </p>
    </div>
  )
}

export function SchedPane({ data }: { data: OpsSummary }) {
  const c = data.config
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Stat
          label='会话粘性'
          value={c.sticky_ttl_seconds == null ? '—' : `${Math.round(c.sticky_ttl_seconds / 60)} 分钟`}
          tone={c.sticky_ttl_seconds && c.sticky_ttl_seconds > 7200 ? 'warn' : 'good'}
          hint='过长会把额度堆在一个号上'
        />
        <Stat
          label='5h 闸线'
          value={c.quota_limit_5h == null ? '—' : `${Math.round(c.quota_limit_5h * 100)}%`}
          tone='neutral'
        />
        <Stat
          label='7d 闸线'
          value={c.quota_limit_7d == null ? '—' : `${Math.round(c.quota_limit_7d * 100)}%`}
          tone='neutral'
        />
        <Stat
          label='用量探测'
          value={c.usage_probe_enabled == null ? '—' : c.usage_probe_enabled ? '已开启' : '已关闭'}
          tone={c.usage_probe_enabled ? 'good' : 'bad'}
          hint='不探测就看不到额度爬升'
        />
      </div>
      <div className='flex gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground'>
        <Clock className='mt-0.5 h-4 w-4 shrink-0' />
        <span>
          这些值来自 routing.json 的当前配置。修改入口在「设置 → 粘性 / 配额 / OpenAI」，
          改完保存立即生效，不需要重启。
        </span>
      </div>
      <div className='flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'>
        <TicketX className='mt-0.5 h-4 w-4 shrink-0' />
        <span>
          本轮巡检平均 TTFT {formatDuration(data.totals.avg_ttft_ms)}、首字节{' '}
          {formatDuration(data.totals.avg_first_byte_ms)}。首字节占大头时先查代理，
          思考占大头时先查 effort 与门票。
        </span>
      </div>
    </div>
  )
}
