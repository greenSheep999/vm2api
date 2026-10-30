import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { openaiPlanLabel } from '@/lib/vm-status'

export type KeyPolicy = {
  keyId: string
  keyName: string
  groupType: string | null
  configured: boolean
  policy: {
    allow_migration: boolean
    sticky_minutes: number
    target_ratio: number
    force_continue: boolean
  }
  control?: { bustPermille: number; measuredRatio: number | null; samples: number }
}

/** 缓存控制：按 key 决定「能不能换号、粘多久、目标命中率」。 */
export function CacheControlSection() {
  const qc = useQueryClient()
  const policies = useQuery({
    queryKey: ['ops-cache-policies'],
    queryFn: () => api<{ items: KeyPolicy[] }>('/api/panel/ops/cache/policies'),
  })
  const [drafts, setDrafts] = useState<Record<string, KeyPolicy['policy']>>({})

  const save = useMutation({
    mutationFn: (input: { keyId: string; policy: KeyPolicy['policy'] }) =>
      api('/api/panel/ops/cache/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: input.keyId, policy: input.policy }),
      }),
    onSuccess: () => {
      toast.success('缓存策略已保存')
      void qc.invalidateQueries({ queryKey: ['ops-cache-policies'] })
    },
    onError: (e) => toast.error(`保存失败：${(e as Error).message}`),
  })

  const items = policies.data?.items || []
  const valueOf = (k: KeyPolicy) => drafts[k.keyId] || k.policy
  const patch = (k: KeyPolicy, next: Partial<KeyPolicy['policy']>) =>
    setDrafts((d) => ({ ...d, [k.keyId]: { ...valueOf(k), ...next } }))

  return (
    <section className='rounded-lg border p-3'>
      <h4 className='text-sm font-semibold'>缓存控制</h4>
      <p className='mt-1 text-[11px] text-muted-foreground'>
        缓存是按「客户会话 + 账号」滚动的：换一次号就丢掉已经滚起来的前缀缓存。
        是否允许换号按 Key 配，槽位只作为执行对象。
      </p>
      <div className='mt-2 overflow-x-auto'>
        <table className='w-full text-[11px]'>
          <thead>
            <tr className='text-muted-foreground'>
              <th className='py-1 text-left'>Key</th>
              <th className='py-1 text-center'>允许换号</th>
              <th className='py-1 text-center'>粘性（分钟）</th>
              <th className='py-1 text-center'>强制续接</th>
              <th className='py-1 text-center'>目标命中率</th>
              <th className='py-1 text-center'>实测 / 打散</th>
              <th className='py-1' />
            </tr>
          </thead>
          <tbody>
            {items.map((k) => {
              const v = valueOf(k)
              const dirty = Boolean(drafts[k.keyId])
              return (
                <tr key={k.keyId} className='border-t'>
                  <td className='py-1'>
                    <span className='font-mono'>{k.keyName}</span>
                    {k.configured ? <span className='ml-1 text-[10px] text-muted-foreground'>已配置</span> : null}
                  </td>
                  <td className='py-1 text-center'>
                    <Switch checked={v.allow_migration} onCheckedChange={(x) => patch(k, { allow_migration: x })} />
                  </td>
                  <td className='py-1 text-center'>
                    <Input
                      type='number'
                      min={1}
                      max={120}
                      className='mx-auto h-7 w-16 text-center text-[11px]'
                      value={v.sticky_minutes}
                      onChange={(e) => patch(k, { sticky_minutes: Number(e.target.value) || 1 })}
                    />
                  </td>
                  <td className='py-1 text-center'>
                    <Switch checked={v.force_continue} onCheckedChange={(x) => patch(k, { force_continue: x })} />
                  </td>
                  <td className='py-1 text-center'>
                    <Input
                      type='number'
                      min={0}
                      max={100}
                      className='mx-auto h-7 w-16 text-center text-[11px]'
                      value={Math.round((v.target_ratio || 0) * 100)}
                      onChange={(e) =>
                        patch(k, { target_ratio: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })
                      }
                    />
                  </td>
                  <td className='py-1 text-center text-[11px] tabular-nums text-muted-foreground'>
                    {k.control?.measuredRatio == null
                      ? '—'
                      : `${(k.control.measuredRatio * 100).toFixed(0)}% / ${((k.control.bustPermille || 0) / 10).toFixed(0)}%`}
                  </td>
                  <td className='py-1 text-right'>
                    <Button
                      size='sm'
                      variant={dirty ? 'default' : 'outline'}
                      className='h-6 border px-2 text-[10px]'
                      disabled={!dirty || save.isPending}
                      title={dirty ? '保存这个 Key 的缓存策略' : '没有改动'}
                      onClick={() => save.mutate({ keyId: k.keyId, policy: v })}
                    >
                      {save.isPending && save.variables?.keyId === k.keyId ? '保存中…' : '保存'}
                    </Button>
                  </td>
                </tr>
              )
            })}
            {!items.length ? (
              <tr>
                <td colSpan={7} className='py-3 text-center text-muted-foreground'>
                  没有可配置的 Key
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className='mt-1 text-[10px] leading-relaxed text-muted-foreground'>
        强制续接 = 客户端没带 previous_response_id 时，由网关补上该会话上一次的 response id，
        让上游继续滚同一段前缀缓存（缓存按「前缀 + 后继」滚动，断链就掉命中率）。
        <br />
        目标命中率 = 闭环控制：设了 70%，控制器每 5 分钟对比实测值，自动调节「主动打散」的会话比例；
        打散的会话缓存失效，会明显变慢（TTFT 几十秒）。
        <br />
        注：不做「保活」——上游前缀缓存是按那段前缀本身计时的，发别的请求（哪怕极小）并不会给客户的前缀续命，
        要续命只能重放原始大前缀，代价比收益高。
      </p>
    </section>
  )
}

type Stats = {
  keyRows: Array<{ keyId: string; keyName: string; samples: number; hitRatio: number; avgTtftMs: number | null }>
  slotRows: Array<{ vmId: string; plan: string; samples: number; hitRatio: number; avgTtftMs: number | null }>
}

/** 缓存观测：谁在拖低命中率、命中率与 TTFT 的关系。 */
export function CacheObserveSection() {
  const q = useQuery({
    queryKey: ['ops-cache-stats-observe'],
    queryFn: () => api<Stats>('/api/panel/ops/cache/stats?hours=12'),
    refetchInterval: 60_000,
  })
  const tone = (v: number) => (v >= 0.8 ? 'text-emerald-600 dark:text-emerald-400' : v >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400')
  return (
    <section className='grid gap-3 rounded-lg border p-3 lg:grid-cols-2'>
      <div>
        <h4 className='text-sm font-semibold'>按 Key 观测（近 12 小时）</h4>
        <table className='mt-2 w-full text-[11px]'>
          <thead>
            <tr className='text-muted-foreground'>
              <th className='py-1 text-left'>Key</th>
              <th className='py-1 text-right'>请求</th>
              <th className='py-1 text-right'>命中率</th>
              <th className='py-1 text-right'>平均 TTFT</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.keyRows || []).map((k) => (
              <tr key={k.keyId} className='border-t'>
                <td className='py-1 font-mono'>{k.keyName}</td>
                <td className='py-1 text-right tabular-nums'>{k.samples}</td>
                <td className={cn('py-1 text-right tabular-nums', tone(k.hitRatio))}>{(k.hitRatio * 100).toFixed(1)}%</td>
                <td className='py-1 text-right tabular-nums text-muted-foreground'>{k.avgTtftMs ?? '—'}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h4 className='text-sm font-semibold'>按槽位观测</h4>
        <table className='mt-2 w-full text-[11px]'>
          <thead>
            <tr className='text-muted-foreground'>
              <th className='py-1 text-left'>槽位</th>
              <th className='py-1 text-right'>套餐</th>
              <th className='py-1 text-right'>请求</th>
              <th className='py-1 text-right'>命中率</th>
              <th className='py-1 text-right'>平均 TTFT</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.slotRows || []).slice(0, 8).map((s) => (
              <tr key={s.vmId} className='border-t'>
                <td className='py-1 font-mono'>{s.vmId}</td>
                <td className='py-1 text-right text-muted-foreground'>{openaiPlanLabel(s.plan)}</td>
                <td className='py-1 text-right tabular-nums'>{s.samples}</td>
                <td className={cn('py-1 text-right tabular-nums', tone(s.hitRatio))}>{(s.hitRatio * 100).toFixed(1)}%</td>
                <td className='py-1 text-right tabular-nums text-muted-foreground'>{s.avgTtftMs ?? '—'}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
