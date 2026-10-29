import { useQuery } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TONE_CLASS, continuityChip, ticketChip } from '@/lib/ticket-state'

type HarvestTicket = {
  model: string
  verdict: string | null
  len: number | null
  probe_verdict: string | null
}

type HarvestAccount = { id: string; models: HarvestTicket[] }

/**
 * 槽位卡里的门票摘要：只给一行计数（满血 N / 降智 N / 未探针 N）。
 * 每个模型的明细在打票页看，小卡里铺开太挤。
 */
export function CodexTicketMiniCard({ vm }: { vm: Vm }) {
  const snap = useQuery({
    queryKey: ['ops-harvest'],
    queryFn: () => api<{ accounts: HarvestAccount[] }>('/api/panel/ops/harvest'),
    refetchInterval: 30_000,
  })
  const account = (snap.data?.accounts || []).find((a) => a.id === vm.id)
  const models = account?.models || []

  const tally = { healthy: 0, degraded: 0, unknown: 0 }
  for (const t of models) {
    const chip = continuityChip({
      model: t.model,
      ticketVerdict: t.verdict,
      probeVerdict: t.probe_verdict,
    })
    if (chip.tone === 'ok') tally.healthy += 1
    else if (chip.tone === 'bad') tally.degraded += 1
    else tally.unknown += 1
  }

  return (
    <div className='flex items-center justify-between gap-3 text-xs'>
      <span className='font-medium'>门票</span>
      {models.length === 0 ? (
        <span className='text-[11px] text-muted-foreground'>未打票</span>
      ) : (
        <span className='flex items-center gap-1.5 text-[11px]'>
          {tally.healthy ? (
            <span className={cn('rounded border px-1', TONE_CLASS.ok)}>满血 {tally.healthy}</span>
          ) : null}
          {tally.degraded ? (
            <span className={cn('rounded border px-1', TONE_CLASS.bad)}>降智 {tally.degraded}</span>
          ) : null}
          {tally.unknown ? (
            <span className={cn('rounded border px-1', TONE_CLASS.muted)}>未验 {tally.unknown}</span>
          ) : null}
        </span>
      )}
    </div>
  )
}

/** Claude 槽位：只显示缓存档位一行。 */
export function ClaudeCacheMiniCard({ vm }: { vm: Vm }) {
  const claude = (vm as unknown as { claude?: { cache_ttl?: string; extra?: { cache_ttl?: string } } })?.claude
  const ttl = claude?.cache_ttl || claude?.extra?.cache_ttl || '默认 5m'
  return (
    <div className='flex items-center justify-between gap-3 text-xs'>
      <span className='font-medium'>缓存档位</span>
      <span className='font-mono text-[11px] text-muted-foreground'>{ttl}</span>
    </div>
  )
}

export { ticketChip }
