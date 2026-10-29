import { useQuery } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TONE_CLASS, ticketChip, continuityChip } from '@/lib/ticket-state'

type HarvestTicket = {
  model: string
  verdict: string | null
  len: number | null
  probe_verdict: string | null
}

type HarvestAccount = { id: string; models: HarvestTicket[] }

/**
 * 槽位卡里的门票小卡：只显示这个槽位每个模型的票与续接结论。
 * 数据来自打票概览，和打票页同源，避免两处显示不一致。
 */
export function CodexTicketMiniCard({ vm }: { vm: Vm }) {
  const snap = useQuery({
    queryKey: ['ops-harvest'],
    queryFn: () => api<{ accounts: HarvestAccount[] }>('/api/panel/ops/harvest'),
    refetchInterval: 30_000,
  })
  const account = (snap.data?.accounts || []).find((a) => a.id === vm.id)
  const models = account?.models || []

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm'>门票</CardTitle>
      </CardHeader>
      <CardContent className='space-y-1'>
        {models.length === 0 ? (
          <p className='text-[11px] text-muted-foreground'>还没有打票记录</p>
        ) : (
          models.map((t) => {
            const chips = t.verdict
              ? [
                  ticketChip({ ticketVerdict: t.verdict, ticketLen: t.len, probeVerdict: t.probe_verdict, model: t.model }),
                  continuityChip({ ticketVerdict: t.verdict, probeVerdict: t.probe_verdict, model: t.model }),
                ]
              : [{ label: '未打票', tone: 'muted' as const, hint: '还没打过票' }]
            return (
              <div key={t.model} className='flex items-center justify-between gap-2 text-[11px]'>
                <span className='truncate font-mono'>{t.model}</span>
                <span className='flex shrink-0 items-center gap-1'>
                  {chips.map((chip) => (
                    <span
                      key={chip.label}
                      title={chip.hint}
                      className={cn('rounded border px-1 text-[10px]', TONE_CLASS[chip.tone])}
                    >
                      {chip.label}
                    </span>
                  ))}
                </span>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

/** Claude 槽位卡里的缓存小卡：显示缓存档位与今日缓存量，不做能力判定。 */
export function ClaudeCacheMiniCard({ vm }: { vm: Vm }) {
  const claude = (vm as unknown as { claude?: { cache_ttl?: string; extra?: { cache_ttl?: string } } })?.claude
  const ttl = claude?.cache_ttl || claude?.extra?.cache_ttl || '默认（5m）'
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm'>缓存</CardTitle>
      </CardHeader>
      <CardContent className='space-y-1 text-[11px] text-muted-foreground'>
        <div className='flex items-center justify-between'>
          <span>缓存档位</span>
          <span className='font-mono text-foreground'>{ttl}</span>
        </div>
        <p className='text-[10px]'>
          Claude 走隐式缓存：上游只回「缓存读取」，不单独上报写入量。
        </p>
      </CardContent>
    </Card>
  )
}
