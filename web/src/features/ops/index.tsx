import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/page-header'
import { QueryGate } from '@/components/query-gate'
import {
  OPS_DESCRIPTIONS,
  OPS_ICONS,
  OPS_TABS,
  opsTabId,
  type OpsTabId,
} from './navigation'
import type { OpsSummary } from './types'
import { CachePane, IqPane, SchedPane } from './panes'
import { HarvestPane } from './harvest-pane'

export function opsSummaryQueryOptions(hours = 24) {
  return {
    queryKey: ['ops-summary', hours],
    queryFn: () => api<OpsSummary>(`/api/panel/ops/summary?hours=${hours}`),
    refetchInterval: 60_000,
  } as const
}

function OpsNav({ active }: { active: OpsTabId }) {
  const navigate = useNavigate()
  return (
    <nav aria-label='智能运营分区' className='space-y-1'>
      {OPS_TABS.map(([id, label]) => {
        const Icon = OPS_ICONS[id]
        const on = id === active
        return (
          <button
            key={id}
            type='button'
            onClick={() => void navigate({ to: '/ops/$tab', params: { tab: id } })}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
              on
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className='h-4 w-4 shrink-0' />
            {label}
          </button>
        )
      })}
    </nav>
  )
}

export function OpsPage() {
  const params = useParams({ strict: false }) as { tab?: string }
  const tab = opsTabId(params.tab)
  const summary = useQuery(opsSummaryQueryOptions(24))

  return (
    <PageHeader title='智能运营' description={OPS_DESCRIPTIONS[tab]}>
      <div className='@2xl/content:grid @2xl/content:grid-cols-[10.5rem_1fr] @2xl/content:gap-8'>
        <OpsNav active={tab} />
        <div className='mt-4 min-w-0 @2xl/content:mt-0'>
          <QueryGate loading={summary.isPending} error={summary.error}>
            {summary.data ? (
              <>
                {tab === 'ticket' ? <HarvestPane /> : null}
                {tab === 'iq' ? <IqPane /> : null}
                {tab === 'cache' ? <CachePane data={summary.data} /> : null}
                {tab === 'sched' ? <SchedPane data={summary.data} /> : null}
              </>
            ) : null}
          </QueryGate>
        </div>
      </div>
    </PageHeader>
  )
}
