import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, Boxes, Brain, Handshake, Loader2, Play, TicketCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { PolicyCard } from './policy-card'

export type HarvestTicket = {
  model: string
  verdict: string | null
  blocks: number | null
  len: number | null
  issued_at?: string | null
  expires_at?: string | null
  proxy?: string | null
  checked_at?: string | null
  http_status?: number | null
  edge_ip?: string | null
  probe_verdict?: string | null
  probe_at?: string | null
  probe_detail?: string | null
}

export type HarvestAccount = {
  id: string
  name: string
  status: string
  schedulable: boolean
  plan_type: string | null
  skip_harvest: boolean
  expected_blocks: number
  proxy: string | null
  models: HarvestTicket[]
}

export type HarvestEvent = {
  id: number
  at: string
  kind: string
  vm_id: string | null
  model: string | null
  http_status: number | null
  result: string | null
  reason: string | null
  detail: string | null
  proxy: string | null
}

export type HarvestSnapshot = {
  accounts: HarvestAccount[]
  events: HarvestEvent[]
  policy: import('./types').OpsTicketPolicy | null
}

const CARD = 'rounded-lg border bg-card p-4'

function fmtAgo(iso?: string | null) {
  if (!iso) return '—'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  if (ms < 0) return '刚刚'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} 分钟前`
  return `${Math.round(min / 60)} 小时前`
}

function fmtLeft(iso?: string | null) {
  if (!iso) return '有效期 —'
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms)) return '有效期 —'
  if (ms <= 0) return '已过期'
  const min = Math.floor(ms / 60_000)
  return min >= 60 ? `剩 ${Math.floor(min / 60)} 小时 ${min % 60} 分` : `剩 ${min} 分钟`
}

function fmtClock(v?: string | null) {
  if (!v) return '—'
  return v.replace('T', ' ').replace('Z', '').slice(11, 19)
}

type TicketState = 'valid' | 'expiring' | 'expired' | 'missing' | 'error' | 'unknown'

/**
 * 票的生命周期状态。卡片颜色只跟着这个走：
 *   有效（绿）→ 即将过期（黄）→ 已过期（灰，无色）→ 无票（灰）→ 异常（红）
 */
function ticketState(t: HarvestTicket): TicketState {
  if (!t.verdict) return 'unknown'
  if (t.verdict === 'absent') return 'missing'
  if (t.verdict !== 'ok') return 'error'
  const exp = t.expires_at ? Date.parse(t.expires_at) : NaN
  if (!Number.isFinite(exp)) return 'valid'
  const left = exp - Date.now()
  if (left <= 0) return 'expired'
  if (left < 5 * 60_000) return 'expiring'
  return 'valid'
}

function chipClass(t: HarvestTicket) {
  switch (ticketState(t)) {
    case 'valid':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
    case 'expiring':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
    case 'expired':
      // 掉了就没有颜色：中性灰，不再显示成「有票」的绿色
      return 'bg-muted/60 text-muted-foreground'
    case 'missing':
      return 'bg-muted text-muted-foreground'
    case 'error':
      return 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function remainingText(t: HarvestTicket) {
  if (!t.expires_at) return '有效期 —'
  const ms = Date.parse(t.expires_at) - Date.now()
  if (!Number.isFinite(ms)) return '有效期 —'
  if (ms <= 0) return '已过期'
  const m = Math.floor(ms / 60_000)
  return m >= 60 ? `剩余 ${Math.floor(m / 60)}h${m % 60}m` : `剩余 ${m}m`
}

export function HarvestPane() {
  const qc = useQueryClient()
  const [running, setRunning] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)
  const [borrowing, setBorrowing] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [capResults, setCapResults] = useState<Record<string, string>>({})
  const [borrowResults, setBorrowResults] = useState<Record<string, string>>({})
  const [probeResults, setProbeResults] = useState<Record<string, { verdict: string; shoot: any }>>({})
  const [filter, setFilter] = useState<'all' | 'ticket' | 'probe' | 'select' | 'candy'>('all')
  // 相对时间心跳：让「N 秒前 / 剩余 N 分钟」自己走动，不用等轮询。
  const [, forceTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const snap = useQuery({
    queryKey: ['ops-harvest'],
    queryFn: () => api<HarvestSnapshot>('/api/panel/ops/harvest'),
    // 打票/探测进行中要能实时看到状态推进，空闲时也要跟得上票的有效期变化。
    refetchInterval: running || probing || borrowing || checking ? 2000 : 5000,
  })

  const toggle = useMutation({
    mutationFn: (input: { vm_id: string; skip: boolean }) =>
      api('/api/panel/ops/harvest/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ops-harvest'] }),
    onError: (e) => toast.error(`操作失败：${(e as Error).message}`),
  })

  async function run(vmId: string, model: string) {
    const key = `${vmId}\u0000${model}`
    setRunning(key)
    try {
      const result = await api<{ ok: boolean; verdict: string; blocks: number | null; http_status: number }>(
        '/api/panel/ops/harvest/run',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vm_id: vmId, model }),
        },
      )
      if (result.ok) toast.success(`${vmId} 打票成功（${result.blocks ?? '?'} 块）`)
      else toast.warning(`${vmId} 打票未成功：${result.verdict}（HTTP ${result.http_status}）`)
      void qc.invalidateQueries({ queryKey: ['ops-harvest'] })
    } catch (e) {
      toast.error(`打票失败：${(e as Error).message}`)
    } finally {
      setRunning(null)
    }
  }

  async function capability(vmId: string, model: string, question = 'candy') {
    const key = `${vmId}\u0000${model}`
    setChecking(key)
    try {
      const r = await api<{ ok: boolean; answer: number | null; expected: number | null; verdict: string; http: number }>(
        '/api/panel/ops/harvest/capability',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vm_id: vmId, model, question }),
        },
      )
      const text =
        r.verdict === 'pass'
          ? `能力题通过 · 答 ${r.answer}（期望 ${r.expected}）`
          : r.verdict === 'recorded'
            ? `能力题已记录 · 答 ${r.answer ?? '—'}（未校准，不判分）`
            : `能力题未通过 · 答 ${r.answer ?? '—'}（期望 ${r.expected ?? '—'}）`
      setCapResults((cur) => ({ ...cur, [key]: text }))
      if (r.verdict === 'pass' || r.verdict === 'recorded') toast.success(text)
      else toast.warning(text)
    } catch (e) {
      toast.error(`能力题失败：${(e as Error).message}`)
    } finally {
      setChecking(null)
    }
  }

  async function borrow(vmId: string, model: string) {
    const key = `${vmId}\u0000${model}`
    setBorrowing(key)
    try {
      const r = await api<{ ok: boolean; reason: string; donor?: string; ticket_len?: number }>(
        '/api/panel/ops/harvest/borrow',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vm_id: vmId, model }),
        },
      )
      const text = r.ok
        ? `借票成功 · 来源 ${r.donor} · 票 ${r.ticket_len} 字符（已验证入库）`
        : `借票失败 · ${r.reason}${r.donor ? ` · 来源 ${r.donor}` : ''}`
      setBorrowResults((cur) => ({ ...cur, [key]: text }))
      if (r.ok) toast.success(text)
      else toast.warning(text)
      void qc.invalidateQueries({ queryKey: ['ops-harvest'] })
    } catch (e) {
      toast.error(`借票出错：${(e as Error).message}`)
    } finally {
      setBorrowing(null)
    }
  }

  async function probe(vmId: string, model: string) {
    const key = `${vmId}\u0000${model}`
    setProbing(key)
    try {
      const result = await api<{
        ok: boolean
        verdict: string
        shot1: { http: number; ticket_len: number; model: string | null }
        shot2: { http: number; new_ticket: boolean; ticket_len: number; model: string | null } | null
      }>('/api/panel/ops/harvest/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vm_id: vmId, model }),
      })
      setProbeResults((cur) => ({ ...cur, [key]: { verdict: result.verdict, shoot: result } }))
      const label =
        result.verdict === 'healthy'
          ? '满血（续接未重铸票）'
          : result.verdict === 'healthy_same'
            ? '满血（同一张票）'
            : result.verdict === 'degraded'
              ? '降智（续接被重铸新票）'
              : '无票（上游不铸）'
      if (result.ok) toast.success(`${vmId} ${label}`)
      else toast.warning(`${vmId} ${label}`)
      void qc.invalidateQueries({ queryKey: ['ops-harvest'] })
    } catch (e) {
      toast.error(`探针失败：${(e as Error).message}`)
    } finally {
      setProbing(null)
    }
  }

  if (snap.isPending) return <div className={`${CARD} text-sm text-muted-foreground`}>正在读取打票状态…</div>
  if (snap.error) return <div className={`${CARD} text-sm text-rose-600`}>读取失败：{(snap.error as Error).message}</div>
  const data = snap.data!
  const accounts = data.accounts || []
  const events = (data.events || []).filter((e) => (filter === 'all' ? true : e.kind === filter))
  const ready = accounts.filter((a) => a.models.some((m) => m.verdict === 'ok')).length
  const enabled = accounts.filter((a) => !a.skip_harvest).length

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <div className={CARD}>
          <div className='text-xs text-muted-foreground'>账号</div>
          <div className='mt-1 font-mono text-lg font-semibold'>{accounts.length}</div>
          <div className='text-[10px] text-muted-foreground'>参与打票 {enabled}</div>
        </div>
        <div className={CARD}>
          <div className='text-xs text-muted-foreground'>有票账号</div>
          <div
            className={cn(
              'mt-1 font-mono text-lg font-semibold',
              ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
            )}
          >
            {ready}
          </div>
          <div className='text-[10px] text-muted-foreground'>至少一个模型有票</div>
        </div>
        <div className={CARD}>
          <div className='text-xs text-muted-foreground'>最近事件</div>
          <div className='mt-1 font-mono text-lg font-semibold'>{events.length}</div>
          <div className='text-[10px] text-muted-foreground'>按类型可筛选</div>
        </div>
        <div className={CARD}>
          <div className='text-xs text-muted-foreground'>策略</div>
          <div className='mt-1 text-sm font-semibold'>
            {data.policy?.enabled ? '已启用' : '未启用'}
          </div>
          <div className='text-[10px] text-muted-foreground'>
            {data.policy?.fail_closed ? 'fail_closed' : 'fail_open'}
          </div>
        </div>
      </div>

      {(() => {
        const lastTicket = (data.events || []).find((e) => e.kind === 'ticket')
        const lastProbe = (data.events || []).find((e) => e.kind === 'probe')
        const stored = accounts.reduce(
          (n, a) => n + a.models.filter((m) => m.verdict === 'ok').length,
          0,
        )
        const stages = [
          {
            key: 'node',
            label: '节点轮换',
            status: data.policy?.edge_ips?.length ? 'ok' : 'idle',
            detail: data.policy?.edge_ips?.length
              ? `边缘 ${data.policy.edge_ips.length} 个`
              : '未配置边缘/备用出口',
          },
          {
            key: 'mint',
            label: '打票探测',
            status: lastTicket ? (lastTicket.result === 'ok' ? 'ok' : 'bad') : 'idle',
            detail: lastTicket
              ? `${lastTicket.vm_id} · ${lastTicket.reason || '—'} · HTTP ${lastTicket.http_status ?? '—'}`
              : '还没有打票记录',
          },
          {
            key: 'verify',
            label: '探针校验',
            status: lastProbe ? (lastProbe.result === 'ok' ? 'ok' : 'bad') : 'idle',
            detail: lastProbe
              ? `${lastProbe.vm_id} · ${lastProbe.reason || '—'}`
              : '还没有两发探针',
          },
          {
            key: 'store',
            label: '门票入库',
            status: stored > 0 ? 'ok' : 'idle',
            detail: `${stored} 张有效票`,
          },
          {
            key: 'gate',
            label: '号池调度',
            status: data.policy?.gate_scheduling ? 'ok' : 'idle',
            detail: data.policy?.gate_scheduling ? '无票即暂停调度' : '仅注入，不影响调度',
          },
        ]
        return (
          <div className='grid gap-2 sm:grid-cols-3 lg:grid-cols-5'>
            {stages.map((st, i) => (
              <div
                key={st.key}
                className={cn(
                  'rounded-lg border p-3',
                  st.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
                    : st.status === 'bad'
                      ? 'border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20'
                      : 'border-dashed bg-muted/30',
                )}
              >
                <div className='flex items-center justify-between text-[10px] text-muted-foreground'>
                  <span>{i + 1} / 5</span>
                  <span
                    className={cn(
                      st.status === 'ok'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : st.status === 'bad'
                          ? 'text-rose-600 dark:text-rose-400'
                          : '',
                    )}
                  >
                    {st.status === 'ok' ? '正常' : st.status === 'bad' ? '失败' : '等待'}
                  </span>
                </div>
                <div className='mt-1 text-sm font-semibold'>{st.label}</div>
                <div className='mt-0.5 truncate font-mono text-[10px] text-muted-foreground'>
                  {st.detail}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      <div className='flex justify-end'>
        <Button size='sm' variant='outline' className='h-7 text-[11px]' asChild>
          <Link to='/ops/$tab' params={{ tab: 'iq' }}>
            去降智检测
          </Link>
        </Button>
      </div>

      <PoolCard />

      {data.policy ? <PolicyCard policy={data.policy} /> : null}

      <section className='space-y-3'>
        <div className='flex items-baseline justify-between'>
          <h4 className='text-sm font-semibold'>账号 · 打票控制</h4>
          <span className='text-[11px] text-muted-foreground'>逐账号启停，票卡显示状态 / 出口 / 探针</span>
        </div>
        <div className='grid gap-3 xl:grid-cols-2'>
          {accounts.map((a) => (
            <div key={a.id} className={cn(CARD, 'flex flex-col')}>
              <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-mono text-sm font-semibold'>{a.id}</span>
                    <Badge variant='outline' className='px-1.5 py-0 text-[10px] leading-tight'>
                      {a.status}
                    </Badge>
                    <Badge
                      variant='outline'
                      className={cn(
                        'px-1.5 py-0 text-[10px] leading-tight',
                        a.skip_harvest
                          ? 'border-zinc-300 text-zinc-600 dark:text-zinc-400'
                          : 'border-emerald-300 text-emerald-700 dark:text-emerald-300',
                      )}
                    >
                      {a.skip_harvest ? '已跳过打票' : '参与打票'}
                    </Badge>
                  </div>
                  <div className='mt-1 text-[11px] text-muted-foreground'>
                    套餐 {a.plan_type || '未采集'} · 期望 {a.expected_blocks} 块 · 出口{' '}
                    <span className='font-mono'>{a.proxy ? '已绑定' : '未绑定'}</span>
                  </div>
                </div>
                <Button
                  size='sm'
                  variant={a.skip_harvest ? 'default' : 'outline'}
                  className='h-7 shrink-0 px-2 text-[11px]'
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ vm_id: a.id, skip: !a.skip_harvest })}
                >
                  {a.skip_harvest ? '启用打票' : '跳过打票'}
                </Button>
              </div>

              <div className='mt-3 space-y-1.5'>
                {a.models.map((t) => {
                  const key = `${a.id}\u0000${t.model}`
                  return (
                    <div
                      key={t.model}
                      className={cn('rounded-md px-2.5 py-2 text-xs', chipClass(t))}
                    >
                      <div className='flex flex-wrap items-center justify-between gap-2'>
                        <span className='flex flex-wrap items-center gap-2 font-mono font-medium'>
                          {t.model}
                          {/* 主状态 = 账号档位（票能不能续）；票本身几乎每次都有，不作为主状态。 */}
                          <span
                            className={cn(
                              'rounded px-1 text-[10px]',
                              t.probe_verdict === 'healthy' || t.probe_verdict === 'healthy_same'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : t.probe_verdict === 'degraded' || t.probe_verdict === 'route_changed'
                                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                  : 'bg-black/5 text-muted-foreground dark:bg-white/10',
                            )}
                          >
                            {t.probe_verdict === 'healthy' || t.probe_verdict === 'healthy_same'
                              ? '满血'
                              : t.probe_verdict === 'degraded'
                                ? '降智'
                                : t.probe_verdict === 'route_changed'
                                  ? '路由漂移'
                                  : '未探针'}
                          </span>
                          <span className='text-[10px] text-muted-foreground'>
                            {t.verdict === 'ok'
                              ? `票 ${t.len ?? 0} 字 · ${remainingText(t)}`
                              : t.verdict === 'absent'
                                ? '上游未铸票'
                                : '票异常'}
                          </span>
                          {t.probe_verdict ? (
                            <span
                              className={cn(
                                'rounded px-1 text-[10px]',
                                t.probe_verdict === 'healthy' || t.probe_verdict === 'healthy_same'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : t.probe_verdict === 'degraded'
                                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                              )}
                              title={t.probe_detail || undefined}
                            >
                              {t.probe_verdict === 'healthy' || t.probe_verdict === 'healthy_same'
                                ? '探针：满血'
                                : t.probe_verdict === 'degraded'
                                  ? '探针：降智'
                                  : '探针：无票'}
                            </span>
                          ) : (
                            <span className='rounded bg-muted px-1 text-[10px] text-muted-foreground'>
                              未探针
                            </span>
                          )}
                        </span>
                        <span className='flex items-center gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-6 px-1.5 text-[11px]'
                          disabled={probing === key}
                          onClick={() => void probe(a.id, t.model)}
                          title='两发探针：裸打铸票 → 带票续接，看上游是否重铸'
                        >
                          {probing === key ? (
                            <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                          ) : (
                            <Activity className='mr-1 h-3 w-3' />
                          )}
                          探针
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-6 px-1.5 text-[11px]'
                          disabled={borrowing === key}
                          onClick={() => void borrow(a.id, t.model)}
                          title='借票：拿已验证的来源票当引子，让本账号铸一张自己的票并续接验证'
                        >
                          {borrowing === key ? (
                            <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                          ) : (
                            <Handshake className='mr-1 h-3 w-3' />
                          )}
                          借票
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-6 px-1.5 text-[11px]'
                          disabled={checking === key}
                          onClick={() => void capability(a.id, t.model)}
                          title='能力题：糖果题答对说明档位正常（期望 21；降智号通常答 29）'
                        >
                          {checking === key ? (
                            <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                          ) : (
                            <Brain className='mr-1 h-3 w-3' />
                          )}
                          能力题
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-6 px-1.5 text-[11px]'
                          disabled={running === key || a.skip_harvest}
                          onClick={() => void run(a.id, t.model)}
                        >
                          {running === key ? (
                            <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                          ) : (
                            <Play className='mr-1 h-3 w-3' />
                          )}
                          打票
                        </Button>
                        </span>
                      </div>
                      {capResults[key] ? (
                        <div className='mt-1 rounded bg-black/5 px-2 py-1 font-mono text-[10px] dark:bg-white/10'>
                          {capResults[key]}
                        </div>
                      ) : null}
                      {borrowResults[key] ? (
                        <div className='mt-1 rounded bg-black/5 px-2 py-1 font-mono text-[10px] dark:bg-white/10'>
                          {borrowResults[key]}
                        </div>
                      ) : null}
                      {probeResults[key] ? (
                        <div className='mt-1 rounded bg-black/5 px-2 py-1 font-mono text-[10px] dark:bg-white/10'>
                          探针 {probeResults[key].verdict} · 第一发 HTTP{' '}
                          {probeResults[key].shoot?.shot1?.http ?? '—'} 票长{' '}
                          {probeResults[key].shoot?.shot1?.ticket_len ?? 0} · 第二发 HTTP{' '}
                          {probeResults[key].shoot?.shot2?.http ?? '—'} 新票{' '}
                          {probeResults[key].shoot?.shot2?.new_ticket ? '是' : '否'}
                        </div>
                      ) : null}
                      <div className='mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] opacity-80'>
                        <span>块数 {t.blocks ?? '—'}</span>
                        <span>长度 {t.len ?? '—'}</span>
                        <span>{remainingText(t)}</span>
                        <span>签发 {t.issued_at ? fmtClock(t.issued_at) : '—'}</span>
                        <span>
                          {t.checked_at ? `采集 ${fmtAgo(t.checked_at)}` : '尚未采集'}
                          {t.expires_at ? ` · ${fmtLeft(t.expires_at)}` : ''}
                        </span>
                        <span>HTTP {t.http_status ?? '—'}</span>
                        {(() => {
                          const candy = (data.events || []).find(
                            (e) =>
                              e.kind === 'candy' &&
                              e.vm_id === a.id &&
                              (!e.model || e.model === t.model),
                          )
                          return candy ? (
                            <span className='opacity-70'>
                              糖果 {candy.reason?.replace('answer_', '') ?? '—'}
                            </span>
                          ) : null
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={CARD}>
        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
          <h4 className='flex items-center gap-2 text-sm font-semibold'>
            <TicketCheck className='h-4 w-4 text-blue-600' />
            事件流
          </h4>
          <div className='flex flex-wrap gap-1'>
            {(['all', 'ticket', 'probe', 'select', 'candy'] as const).map((f) => (
              <button
                key={f}
                type='button'
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px]',
                  filter === f
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {f === 'all'
                  ? '全部'
                  : f === 'ticket'
                    ? '打票'
                    : f === 'probe'
                      ? '探针'
                      : f === 'select'
                        ? '选择'
                        : '糖果'}
              </button>
            ))}
          </div>
        </div>
        {events.length === 0 ? (
          <p className='text-xs text-muted-foreground'>还没有事件。点任意一张票卡上的「打票」开始。</p>
        ) : (
          <ol className='max-h-[420px] space-y-1.5 overflow-auto pr-1'>
            {events.map((e) => (
              <li key={e.id} className='flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs'>
                <span
                  className={cn(
                    'mt-1 h-2 w-2 shrink-0 rounded-full',
                    e.result === 'ok'
                      ? 'bg-emerald-500'
                      : e.result === 'skip'
                        ? 'bg-zinc-400'
                        : 'bg-rose-500',
                  )}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='font-medium'>
                      {e.kind === 'ticket'
                        ? '打票'
                        : e.kind === 'probe'
                          ? '探针'
                          : e.kind === 'candy'
                            ? '糖果'
                            : '选择'}
                      {e.vm_id ? ` · ${e.vm_id}` : ''}
                      {e.model ? ` · ${e.model}` : ''}
                    </span>
                    <span className='font-mono text-[10px] text-muted-foreground'>{fmtClock(e.at)}</span>
                  </div>
                  <div className='font-mono text-[10px] text-muted-foreground'>
                    {e.result || '—'} · {e.reason || '—'}
                    {e.http_status ? ` · HTTP ${e.http_status}` : ''}
                    {e.proxy ? ' · 出口已用' : ''}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className='flex gap-2 text-[11px] leading-relaxed text-muted-foreground'>
        <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
        打票会真实向该账号发一次最小请求（约几十 token）。票只记录长度/块数/签发时间，
        不保存票原文。自动打票调度尚未接入，目前只有手动按钮。
      </p>
    </div>
  )
}


type PoolItem = {
  vm_id: string
  model: string
  source: string | null
  verdict: string
  len: number | null
  expires_at: string | null
  updated_at: string | null
}

/** 统一门票库：只有已验证的票会被业务注入，所以这里就是「当前可以借的票」。 */
function PoolCard() {
  const q = useQuery({
    queryKey: ['ops-pool'],
    queryFn: () => api<{ items: PoolItem[] }>('/api/panel/ops/pool'),
    refetchInterval: 30_000,
  })
  const items = q.data?.items || []
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          <Boxes className='h-4 w-4' />
          门票库
          <span className='rounded bg-muted px-1.5 text-[10px] font-normal text-muted-foreground'>
            {items.length} 张已验证
          </span>
        </CardTitle>
        <span className='text-[11px] text-muted-foreground'>
          只有续接验证通过的票会入库，供业务注入与借票使用
        </span>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className='py-3 text-center text-xs text-muted-foreground'>
            还没有已验证的票 —— 打票/探针通过、或借票验证成功后才会出现在这里
          </p>
        ) : (
          <div className='flex flex-wrap gap-2'>
            {items.map((it) => (
              <div
                key={`${it.vm_id}-${it.model}`}
                className='rounded-md border px-2 py-1.5 font-mono text-[11px]'
              >
                <span className='font-medium'>{it.vm_id}</span>
                <span className='mx-1 text-muted-foreground'>·</span>
                {it.model}
                <span className='ml-2 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-700 dark:text-emerald-300'>
                  {it.len ?? 0} 字符
                </span>
                {it.source ? (
                  <span className='ml-2 text-[10px] text-muted-foreground'>来源 {it.source}</span>
                ) : null}
                <span className='ml-2 text-[10px] text-muted-foreground'>
                  {it.expires_at ? `${new Date(it.expires_at).toLocaleTimeString()} 过期` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
