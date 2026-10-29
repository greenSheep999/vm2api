import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Grid2x2, List, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'


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
  artifact?: string | null
  effort?: string | null
  judge_rule?: string | null
  keys: Array<{ id: string; name: string }>
}

type ResultsPayload = {
  items: ResultRow[]
  keys: Array<{ id: string; name: string; status?: string; slots?: number }>
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

function verdictLabel(row: ResultRow) {
  const v = row.verdict
  if (v === 'pass') return '通过'
  if (v === 'fail') return '未通过'
  if (v === 'structure_ok') return '结构正常'
  if (v === 'structure_missing') return '无结构'
  if (v === 'recorded') return '已记录'
  if (v === 'healthy' || v === 'healthy_same') return '满血'
  if (v === 'degraded') return '降智'
  if (v === 'route_changed') return '路由漂移'
  if (v === 'no_ticket') return '无票'
  return v || '—'
}

function verdictPill(v?: string | null) {
  if (!v) return 'bg-muted text-muted-foreground'
  if (['pass', 'structure_ok', 'recorded', 'healthy', 'healthy_same'].includes(v)) {
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  }
  if (['fail', 'structure_missing', 'degraded', 'route_changed', 'no_ticket', 'no_answer'].includes(v)) {
    return 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
  }
  return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
}

/**
 * 直接渲染产物：
 * - 结构题（鹈鹕）→ 沙箱 iframe 渲染 HTML/SVG
 * - 数值题（糖果）→ 数字卡片 + 期望值对照
 * - 探针 → 结论与票长
 */
function renderArtifact(row: ResultRow) {
  const artifact = String(row.artifact || '')
  if (row.question_kind === 'image' || /<svg[\s>]/i.test(artifact)) {
    const html = /<html[\s>]/i.test(artifact)
      ? artifact
      : `<!doctype html><html><body style="margin:0;display:grid;place-items:center;background:#fafaf7">${artifact}</body></html>`
    return (
      <iframe
        title={row.id}
        sandbox=''
        srcDoc={html}
        className='h-44 w-full border-0 bg-white'
        loading='lazy'
      />
    )
  }
  if (row.question_kind === 'numeric') {
    const ok = row.verdict === 'pass'
    return (
      <div className={cn('flex h-24 items-center justify-center font-mono text-3xl font-semibold', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
        {row.answer ?? '—'}
        {row.expected != null ? <span className='ml-2 text-sm text-muted-foreground'>/ {row.expected}</span> : null}
      </div>
    )
  }
  return (
    <div className='flex h-24 items-center justify-center px-3 text-center font-mono text-[11px] text-muted-foreground'>
      {row.verdict || '—'}
    </div>
  )
}

/**
 * 智商测试结果：只展示成果，不提供策略入口。
 * 按 Key 聚合，可按题型筛选，支持网格与列表两种视图。
 */
export function IqResultsPage() {
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

  // 按 Key 分段：所有 Key 都出现（0 结果也给空态），未绑定 Key 的槽位单独一段。
  const groups = useMemo(() => {
    const rowsByKey = new Map<string, ResultRow[]>()
    for (const row of filtered) {
      const owners = row.keys.length ? row.keys : [{ id: '__none__', name: '未绑定 Key' }]
      for (const owner of owners) {
        if (!rowsByKey.has(owner.id)) rowsByKey.set(owner.id, [])
        rowsByKey.get(owner.id)!.push(row)
      }
    }
    const list = keys
      .filter((k) => keyId === 'all' || k.id === keyId)
      .map((k) => ({
        id: k.id,
        label: k.name || k.id,
        status: k.status || 'active',
        slots: k.slots ?? 0,
        rows: rowsByKey.get(k.id) || [],
      }))
    const unbound = rowsByKey.get('__none__') || []
    if (unbound.length && keyId === 'all') {
      list.push({ id: '__none__', label: '未绑定 Key', status: 'none', slots: 0, rows: unbound })
    }
    // 启用的排前面，其次按结果数量降序
    return list.sort((a, b) => {
      const rank = (x: { status: string; rows: ResultRow[] }) =>
        x.status === 'active' ? 0 : x.status === 'none' ? 2 : 1
      return rank(a) - rank(b) || b.rows.length - a.rows.length
    })
  }, [filtered, keys, keyId])

  return (
    <PageHeader
      title='智商测试结果'
      description='按 Key 汇总检测成果：门票探针、糖果题、鹈鹕结构。策略与单次执行在「智能运营」里。'
    >
      <div className='space-y-5'>
        {/* 筛选栏：左边筛选，右边刷新与上次刷新时间 */}
        <div className='flex flex-wrap items-center justify-between gap-3'>
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
          </div>

          <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
            <span>上次刷新 {q.dataUpdatedAt ? fmt(new Date(q.dataUpdatedAt).toISOString()) : '—'}</span>
            <Button
              size='sm'
              variant='outline'
              className='h-7 px-2 text-[11px]'
              onClick={() => void q.refetch()}
            >
              {q.isFetching ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : <RefreshCw className='mr-1 h-3 w-3' />}
              刷新
            </Button>
          </div>
        </div>

        {q.isPending ? (
          <div className='py-10 text-center text-xs text-muted-foreground'>加载中…</div>
        ) : groups.length === 0 ? (
          <div className='py-10 text-center text-xs text-muted-foreground'>
            还没有检测结果 —— 去「智能运营 → 降智检测」跑一次单次检测或定时任务
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id} className='space-y-2.5'>
              {/* 每个 Key 一段：标题 + 状态 + 槽位数 + 结果数 */}
              <div className='flex flex-wrap items-center gap-2 border-b pb-1.5'>
                <span className='text-sm font-semibold'>{group.label}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px]',
                    group.status === 'active'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {group.status === 'active' ? '启用' : group.status === 'none' ? '未绑定' : '停用'}
                </span>
                <span className='text-[11px] text-muted-foreground'>
                  {group.slots > 0 ? `${group.slots} 个槽位 · ` : ''}
                  {group.rows.length} 条结果
                </span>
              </div>

              {group.rows.length === 0 ? (
                <div className='rounded-lg border border-dashed py-6 text-center text-[11px] text-muted-foreground'>
                  这个 Key 还没有检测结果
                </div>
              ) : view === 'grid' ? (
                <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
                  {group.rows.map((row) => (
                    <div key={`${group.id}-${row.id}`} className='overflow-hidden rounded-xl border bg-card shadow-sm'>
                      <div className='flex items-start justify-between gap-2 px-3.5 pt-3'>
                        <div className='min-w-0'>
                          <div className='flex items-center gap-1.5 font-mono text-[11px]'>
                            <span className='font-semibold'>{row.vm_id}</span>
                            <span className='text-muted-foreground'>·</span>
                            <span className='text-muted-foreground'>
                              {KIND_LABEL[row.question_kind || row.question_id || ''] || row.question_id || '—'}
                            </span>
                          </div>
                          <div className='mt-0.5 font-mono text-[10px] text-muted-foreground'>
                            {row.model || '—'}
                            {row.effort ? ` · ${row.effort}` : ''}
                          </div>
                        </div>
                        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', verdictPill(row.verdict))}>
                          {verdictLabel(row)}
                        </span>
                      </div>

                      <div className='mt-2.5'>{renderArtifact(row)}</div>

                      <div className='flex items-center justify-between px-3.5 py-2.5 font-mono text-[10px] text-muted-foreground'>
                        <span>{fmt(row.started_at)}</span>
                        <span>
                          {row.answer != null
                            ? `答 ${row.answer}${row.expected != null ? `/${row.expected}` : ''}`
                            : '—'}
                          {row.duration_ms ? ` · ${Math.round(row.duration_ms / 100) / 10}s` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='rounded-lg border'>
                  {group.rows.map((row) => (
                    <div
                      key={`${group.id}-${row.id}`}
                      className='flex items-center gap-3 border-b px-3 py-2 font-mono text-[11px] last:border-0'
                    >
                      <span className='w-36 shrink-0 text-muted-foreground'>{fmt(row.started_at)}</span>
                      <span className='w-24 shrink-0'>{row.vm_id}</span>
                      <span className='w-24 shrink-0 rounded bg-muted px-1 text-[10px]'>
                        {KIND_LABEL[row.question_kind || row.question_id || ''] || row.question_id || '—'}
                      </span>
                      <span className={cn('w-20 shrink-0', tone(row.verdict))}>{verdictLabel(row)}</span>
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
              )}
            </section>
          ))
        )}
      </div>
    </PageHeader>
  )
}
