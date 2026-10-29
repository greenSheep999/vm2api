import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { QueryGate } from '@/components/query-gate'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { OpsSummary } from './types'

const CARD = 'rounded-lg border bg-card p-4'

function fmt(v?: string | null) {
  if (!v) return '—'
  return v.replace('T', ' ').replace('Z', '').slice(0, 19)
}

/**
 * 降智结果列表。
 *
 * 只列**硬事实**（模型被换 / effort 被降 / 门票异常），不列「感觉变笨」。
 * 管理动作（开关打票、看策略）都在「智能运营」页里做，这里只看结果。
 */
export function IqResultsPage() {
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ['ops-summary', 24],
    queryFn: () => api<OpsSummary>('/api/panel/ops/summary?hours=24'),
    refetchInterval: 60_000,
  })

  return (
    <PageHeader
      title='降智结果'
      description='按账号聚合的三类硬事实：上游换模型、上游降 effort、门票异常。只列结果，管理入口在「智能运营」。'
    >
      <QueryGate loading={q.isPending} error={q.error}>
        {q.data ? <Body data={q.data} onManage={() => void navigate({ to: '/ops/$tab', params: { tab: 'ticket' } })} /> : null}
      </QueryGate>
    </PageHeader>
  )
}

function Body({ data, onManage }: { data: OpsSummary; onManage: () => void }) {
  const rows = (data.iqResults || []).filter((r) => r.vm_id)
  const suspicious = rows.filter((r) => r.model_mismatch > 0 || r.effort_drop > 0 || r.ticket_bad > 0)

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-3'>
        <div className={CARD}>
          <div className='text-xs text-muted-foreground'>窗口内账号</div>
          <div className='mt-1 font-mono text-lg font-semibold'>{rows.length}</div>
        </div>
        <div className={CARD}>
          <div className='text-xs text-muted-foreground'>有硬事实命中的账号</div>
          <div
            className={cn(
              'mt-1 font-mono text-lg font-semibold',
              suspicious.length ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600',
            )}
          >
            {suspicious.length}
          </div>
        </div>
        <div className={CARD}>
          <div className='text-xs text-muted-foreground'>窗口</div>
          <div className='mt-1 font-mono text-lg font-semibold'>{data.hours}h</div>
        </div>
      </div>

      <section className={CARD}>
        <div className='mb-3 flex items-center justify-between'>
          <h4 className='text-sm font-semibold'>按账号</h4>
          <Button size='sm' variant='outline' className='h-7 text-[11px]' onClick={onManage}>
            去管理 <ArrowUpRight className='ml-1 h-3 w-3' />
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className='text-xs text-muted-foreground'>窗口内没有请求。</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-xs'>
              <thead className='text-left text-muted-foreground'>
                <tr className='border-b'>
                  <th className='py-1.5 pr-3 font-medium'>账号</th>
                  <th className='py-1.5 pr-3 font-medium'>请求</th>
                  <th className='py-1.5 pr-3 font-medium'>模型被换</th>
                  <th className='py-1.5 pr-3 font-medium'>effort 被降</th>
                  <th className='py-1.5 pr-3 font-medium'>门票异常</th>
                  <th className='py-1.5 font-medium'>最近请求</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const flagged = r.model_mismatch > 0 || r.effort_drop > 0 || r.ticket_bad > 0
                  return (
                    <tr
                      key={String(r.vm_id)}
                      className={cn('border-b last:border-0', flagged && 'bg-rose-50/40 dark:bg-rose-950/20')}
                    >
                      <td className='py-1.5 pr-3 font-mono'>
                        {r.vm_id}
                        {flagged ? (
                          <Badge
                            variant='outline'
                            className='ml-2 border-rose-300 px-1 py-0 text-[10px] text-rose-700 dark:text-rose-300'
                          >
                            可疑
                          </Badge>
                        ) : null}
                      </td>
                      <td className='py-1.5 pr-3 font-mono tabular-nums'>{r.n}</td>
                      <td className='py-1.5 pr-3 font-mono tabular-nums'>{r.model_mismatch}</td>
                      <td className='py-1.5 pr-3 font-mono tabular-nums'>{r.effort_drop}</td>
                      <td className='py-1.5 pr-3 font-mono tabular-nums'>{r.ticket_bad}</td>
                      <td className='py-1.5 font-mono text-[11px] text-muted-foreground'>{fmt(r.last_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className='flex gap-2 text-[11px] leading-relaxed text-muted-foreground'>
        <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
        这里只统计确定性信号。题库与鹈鹕能力检测尚未接入；在接入之前，
        「门票异常 = 全部 absent」会让每个有流量的账号都显示门票命中，这是事实，不是误报。
      </p>
    </div>
  )
}
