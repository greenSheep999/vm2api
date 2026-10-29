import { useState } from 'react'
import { Clock, TicketX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration, formatTokenAmount } from '@/lib/usage-format'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import type { IqRun, IqTask, OpsSummary } from './types'

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

const KIND_LABEL: Record<string, string> = { probe: '门票探针', candy: '糖果题', pelican: '鹈鹕结构' }

function fmtAt(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function verdictTone(v?: string | null) {
  if (!v) return 'text-muted-foreground'
  if (['healthy', 'healthy_same', 'pass', 'recorded'].includes(v)) return 'text-emerald-600 dark:text-emerald-400'
  if (['degraded', 'route_changed', 'fail', 'no_answer', 'no_ticket'].includes(v)) return 'text-rose-600 dark:text-rose-400'
  return 'text-amber-600 dark:text-amber-400'
}

/** 降智检测：有状态、可调度、带运行历史的检测任务。 */
export function IqPane() {
  const qc = useQueryClient()
  const tasks = useQuery({
    queryKey: ['iq-tasks'],
    queryFn: () => api<{ items: IqTask[]; latest: Array<{ vm_id: string; kind: string; verdict: string; started_at: string }> }>('/api/panel/ops/iq/tasks'),
    refetchInterval: 15_000,
  })
  const runs = useQuery({
    queryKey: ['iq-runs'],
    queryFn: () => api<{ items: IqRun[] }>('/api/panel/ops/iq/runs?limit=30'),
    refetchInterval: 15_000,
  })
  const [running, setRunning] = useState<string | null>(null)

  async function runNow(id: string) {
    setRunning(id)
    try {
      const r = await api<{ ran: number; failed: number }>(`/api/panel/ops/iq/tasks/${id}/run`, { method: 'POST' })
      toast.success(`执行完成：${r.ran} 个账号，失败 ${r.failed}`)
      void qc.invalidateQueries({ queryKey: ['iq-tasks'] })
      void qc.invalidateQueries({ queryKey: ['iq-runs'] })
    } catch (e) {
      toast.error(`执行失败：${(e as Error).message}`)
    } finally {
      setRunning(null)
    }
  }

  async function toggle(task: IqTask) {
    await api(`/api/panel/ops/iq/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: task.enabled !== 1 }),
    })
    void qc.invalidateQueries({ queryKey: ['iq-tasks'] })
  }

  const items = tasks.data?.items || []
  const latest = tasks.data?.latest || []

  return (
    <div className='space-y-3'>
      <div className='grid gap-3 md:grid-cols-3'>
        {items.map((task) => (
          <div key={task.id} className={CARD}>
            <div className='flex items-start justify-between'>
              <div>
                <div className='text-sm font-semibold'>{task.name}</div>
                <div className='mt-0.5 text-[11px] text-muted-foreground'>
                  {KIND_LABEL[task.kind] || task.kind} · 每 {Math.round(task.interval_sec / 60)} 分钟
                  {task.only_healthy ? ' · 仅满血号' : ''}
                </div>
              </div>
              <Button
                size='sm'
                variant={task.enabled === 1 ? 'secondary' : 'outline'}
                className='h-6 px-2 text-[11px]'
                onClick={() => void toggle(task)}
              >
                {task.enabled === 1 ? '已启用' : '已停用'}
              </Button>
            </div>
            <div className='mt-2 space-y-1 text-[11px]'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>上次执行</span>
                <span className='font-mono'>{fmtAt(task.last_run_at)}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>下次执行</span>
                <span className='font-mono'>{fmtAt(task.next_run_at)}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>运行 / 失败</span>
                <span className='font-mono'>
                  {task.run_count} / <span className={task.fail_count ? 'text-rose-600 dark:text-rose-400' : ''}>{task.fail_count}</span>
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>最近结论</span>
                <span className={cn('font-mono', verdictTone(task.last_verdict))}>
                  {task.last_verdict || '—'}
                </span>
              </div>
            </div>
            <Button
              size='sm'
              variant='outline'
              className='mt-2 h-6 w-full text-[11px]'
              disabled={running === task.id}
              onClick={() => void runNow(task.id)}
            >
              {running === task.id ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : <Play className='mr-1 h-3 w-3' />}
              立即执行
            </Button>
          </div>
        ))}
      </div>

      <div className={CARD}>
        <div className='flex items-center justify-between'>
          <div className='text-sm font-semibold'>账号最新结论</div>
          <span className='text-[11px] text-muted-foreground'>
            按账号 × 检测类型取最近一次
          </span>
        </div>
        <div className='mt-2 flex flex-wrap gap-2'>
          {latest.length === 0 ? (
            <span className='text-xs text-muted-foreground'>还没有运行记录</span>
          ) : (
            latest.map((row) => (
              <span key={`${row.vm_id}-${row.kind}`} className='rounded border px-2 py-1 font-mono text-[11px]'>
                {row.vm_id}
                <span className='mx-1 text-muted-foreground'>{KIND_LABEL[row.kind] || row.kind}</span>
                <span className={verdictTone(row.verdict)}>{row.verdict}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className={CARD}>
        <div className='text-sm font-semibold'>运行历史</div>
        <div className='mt-2 space-y-1'>
          {(runs.data?.items || []).length === 0 ? (
            <div className='py-3 text-center text-xs text-muted-foreground'>还没有历史</div>
          ) : (
            (runs.data?.items || []).map((run) => (
              <div key={run.id} className='flex items-center justify-between gap-2 border-b py-1 font-mono text-[11px] last:border-0'>
                <span className='shrink-0 text-muted-foreground'>{fmtAt(run.started_at)}</span>
                <span className='shrink-0'>{run.vm_id}</span>
                <span className={cn('shrink-0', verdictTone(run.verdict))}>{run.verdict}</span>
                {run.answer != null ? (
                  <span className={cn('shrink-0', verdictTone(run.verdict))}>
                    答 {run.answer}/{run.expected ?? '—'}
                  </span>
                ) : null}
                <span className='flex-1 truncate text-right text-muted-foreground'>{run.duration_ms ?? 0}ms</span>
              </div>
            ))
          )}
        </div>
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
