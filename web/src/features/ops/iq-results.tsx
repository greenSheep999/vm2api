import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, Grid2x2, List, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const CARD = 'rounded-lg border bg-card p-4'

type ResultRow = {
  id: string
  vm_id: string
  model: string | null
  verdict: string | null
  answer: number | null
  expected: number | null
  question_id: string | null
  question_kind: string | null
  question_title: string | null
  source: string | null
  started_at: string
  duration_ms: number | null
  keys: Array<{ id: string; name: string }>
}

type ResultsPayload = {
  items: ResultRow[]
  keys: Array<{ id: string; name: string }>
  keyByVm: Record<string, Array<{ id: string; name: string }>>
}

const KIND_LABEL: Record<string, string> = {
  probe: '门票探针',
  candy: '糖果题',
  pelican: '鹈鹕结构',
  numeric: '数值题',
  image: '结构题',
}

function fmt(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function tone(v?: string | null) {
  if (!v) return 'text-muted-foreground'
  if (['pass', 'structure_ok', 'recorded', 'healthy', 'healthy_same'].includes(v)) {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (['fail', 'structure_missing', 'degraded', 'route_changed', 'no_ticket', 'no_answer'].includes(v)) {
    return 'text-rose-600 dark:text-rose-400'
  }
  return 'text-amber-600 dark:text-amber-400'
}

/**
 * 智商测试结果：只展示成果，不提供策略入口。
 * 按 Key 聚合，可按题型筛选，支持网格与列表两种视图。
 */
export function IqResultsPage() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<string>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [keyId, setKeyId] = useState<string>('all')

  const q = useQuery({
    queryKey: ['iq-results', kind],
    queryFn: () =>
      api<ResultsPayload>(
        `/api/panel/ops/iq/results?limit=300${kind === 'all' ? '' : `&kind=${encodeURIComponent(kind)}`}`,
      ),
    refetchInterval: 30_000,
  })

  const rows = q.data?.items || []
  const keys = q.data?.keys || []

  const filtered = rows.filter((row) => {
    if (keyId === 'all') return true
    return row.keys.some((k) => k.id === keyId)
  })

  // 按 Key 聚合：没有归属 Key 的槽位归到「未绑定 Key」
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: ResultRow[] }>()
    for (const row of filtered) {
      const owners = row.keys.length ? row.keys : [{ id: '__none__', name: '未绑定 Key' }]
      for (const owner of owners) {
        const key = owner.id
        if (!map.has(key)) map.set(key, { label: owner.name || owner.id, rows: [] })
        map.get(key)!.rows.push(row)
      }
    }
    return Array.from(map.entries()).map(([id, value]) => ({ id, ...value }))
  }, [filtered])

  return (
    <PageHeader
      title='智商测试结果'
      description='按 Key 汇总检测成果：门票探针、糖果题、鹈鹕结构。策略与单次执行在「智能运营」里。'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <div className='flex flex-wrap gap-1'>
          {[
            ['all', '全部'],
            ['probe', '门票探针'],
            ['candy', '糖果题'],
            ['pelican', '鹈鹕结构'],
          ].map(([id, label]) => (
            <Button
              key={id}
              size='sm'
              variant={kind === id ? 'default' : 'outline'}
              className='h-7 px-2.5 text-[11px]'
              onClick={() => setKind(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <select
          className='h-7 rounded border bg-background px-1.5 text-[11px]'
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
        >
          <option value='all'>全部 Key</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name || k.id}
            </option>
          ))}
        </select>
        <div className='flex gap-1'>
          <Button
            size='sm'
            variant={view === 'grid' ? 'default' : 'outline'}
            className='h-7 px-2 text-[11px]'
            onClick={() => setView('grid')}
          >
            <Grid2x2 className='mr-1 h-3 w-3' />
            网格
          </Button>
          <Button
            size='sm'
            variant={view === 'list' ? 'default' : 'outline'}
            className='h-7 px-2 text-[11px]'
            onClick={() => setView('list')}
          >
            <List className='mr-1 h-3 w-3' />
            列表
          </Button>
        </div>
        <Button
          size='sm'
          variant='outline'
          className='h-7 px-2 text-[11px]'
          onClick={() => void q.refetch()}
        >
          {q.isFetching ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
          刷新
        </Button>
      </div>

      {q.isPending ? (
        <div className='py-10 text-center text-xs text-muted-foreground'>加载中…</div>
      ) : groups.length === 0 ? (
        <div className='py-10 text-center text-xs text-muted-foreground'>
          还没有检测结果 —— 去「智能运营 → 降智检测」跑一次单次检测或定时任务
        </div>
      ) : view === 'grid' ? (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {groups.map((group) => (
            <div key={group.id} className={CARD}>
              <div className='flex items-center justify-between'>
                <div className='min-w-0'>
                  <div className='truncate text-sm font-semibold'>{group.label}</div>
                  <div className='text-[11px] text-muted-foreground'>{group.rows.length} 条结果</div>
                </div>
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 px-1.5 text-[10px]'
                  onClick={() => void navigate({ to: '/ops/$tab', params: { tab: 'iq' } })}
                >
                  去检测
                  <ArrowUpRight className='ml-0.5 h-3 w-3' />
                </Button>
              </div>
              <div className='mt-2 space-y-1'>
                {group.rows.slice(0, 8).map((row) => (
                  <div key={row.id} className='flex items-center gap-2 border-b py-1 font-mono text-[11px] last:border-0'>
                    <span className='shrink-0'>{row.vm_id}</span>
                    <span className='shrink-0 rounded bg-muted px-1 text-[10px]'>
                      {KIND_LABEL[row.question_kind || row.question_id || ''] || row.question_id || '—'}
                    </span>
                    <span className={cn('shrink-0', tone(row.verdict))}>{row.verdict || '—'}</span>
                    {row.answer != null ? (
                      <span className={cn('shrink-0', tone(row.verdict))}>
                        {row.answer}/{row.expected ?? '—'}
                      </span>
                    ) : null}
                    <span className='flex-1 truncate text-right text-muted-foreground'>
                      {fmt(row.started_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={CARD}>
          <div className='space-y-1'>
            {filtered.map((row) => (
              <div key={row.id} className='flex items-center gap-2 border-b py-1 font-mono text-[11px] last:border-0'>
                <span className='w-36 shrink-0 text-muted-foreground'>{fmt(row.started_at)}</span>
                <span className='w-28 shrink-0 truncate'>
                  {row.keys.map((k) => k.name || k.id).join(', ') || '未绑定 Key'}
                </span>
                <span className='w-24 shrink-0'>{row.vm_id}</span>
                <span className='w-24 shrink-0 rounded bg-muted px-1 text-[10px]'>
                  {KIND_LABEL[row.question_kind || row.question_id || ''] || row.question_id || '—'}
                </span>
                <span className={cn('w-20 shrink-0', tone(row.verdict))}>{row.verdict || '—'}</span>
                {row.answer != null ? (
                  <span className={cn('w-16 shrink-0', tone(row.verdict))}>
                    {row.answer}/{row.expected ?? '—'}
                  </span>
                ) : null}
                <span className='flex-1 truncate text-right text-muted-foreground'>
                  {row.source === 'single' ? '单次' : '任务'} · {row.duration_ms ?? 0}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageHeader>
  )
}
