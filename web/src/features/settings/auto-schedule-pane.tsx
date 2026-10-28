import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/setting-row'
import { api } from '@/lib/api'

type Policy = {
  enabled: boolean
  window_minutes: number
  min_samples: number
  fast_ms: number
  slow_ms: number
  fast_weight: number
  mid_weight: number
  slow_weight: number
  hysteresis: number
  cooldown_seconds: number
  interval_minutes: number
}

type SlotStat = { vm_id: string; n: number; p50: number; weight: number | null }

type Payload = { policy: Policy; stats: SlotStat[] }

function fmtMs(ms: number) {
  if (!Number.isFinite(ms)) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function NumField({
  label,
  desc,
  value,
  onChange,
  width = 'w-24',
}: {
  label: string
  desc?: string
  value: number
  onChange: (n: number) => void
  width?: string
}) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <SettingRow label={label} desc={desc}>
      <Input
        className={width}
        value={raw ?? String(value)}
        onChange={(e) => {
          setRaw(e.target.value)
          const n = Math.round(Number(e.target.value))
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => setRaw(null)}
      />
    </SettingRow>
  )
}

export function AutoSchedulePane() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['auto-schedule'],
    queryFn: () => api<Payload>('/api/panel/auto-schedule'),
    refetchInterval: 15000,
  })
  const [draft, setDraft] = useState<Policy | null>(null)
  const policy = draft ?? q.data?.policy ?? null
  const stats = q.data?.stats ?? []

  const save = useMutation({
    mutationFn: (next: Policy) =>
      api<{ policy: Policy }>('/api/panel/auto-schedule', {
        method: 'PUT',
        body: JSON.stringify(next),
      }),
    onSuccess: () => {
      toast.success('策略已保存')
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['auto-schedule'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!policy) {
    return (
      <Card>
        <CardContent className='p-6 text-sm text-muted-foreground'>加载中…</CardContent>
      </Card>
    )
  }

  const set = <K extends keyof Policy>(key: K, value: Policy[K]) =>
    setDraft({ ...policy, [key]: value })
  const dirty = draft !== null

  return (
    <div className='space-y-3'>
      <Card>
        <CardHeader>
          <CardTitle>自动权重调度</CardTitle>
        </CardHeader>
        <CardContent className='space-y-1'>
          <SettingRow
            label='启用'
            desc='按最近窗口的 TTFT 自动调整每个槽的 weight，每 10 分钟执行一次。热更新，不重启。'
          >
            <Switch checked={policy.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </SettingRow>
          <NumField
            label='统计窗口（分钟）'
            desc='读取最近多少分钟的请求计算 P50'
            value={policy.window_minutes}
            onChange={(n) => set('window_minutes', n)}
          />
          <NumField
            label='最小样本数'
            desc='样本不足时跳过该槽，避免小样本误判'
            value={policy.min_samples}
            onChange={(n) => set('min_samples', n)}
          />
          <NumField
            label='快槽阈值（ms）'
            desc='P50 低于此值 → 快槽权重'
            value={policy.fast_ms}
            onChange={(n) => set('fast_ms', n)}
            width='w-28'
          />
          <NumField
            label='慢槽阈值（ms）'
            desc='P50 高于此值 → 慢槽权重'
            value={policy.slow_ms}
            onChange={(n) => set('slow_ms', n)}
            width='w-28'
          />
          <NumField
            label='快槽权重'
            value={policy.fast_weight}
            onChange={(n) => set('fast_weight', n)}
          />
          <NumField
            label='中速权重'
            value={policy.mid_weight}
            onChange={(n) => set('mid_weight', n)}
          />
          <NumField
            label='慢槽权重'
            value={policy.slow_weight}
            onChange={(n) => set('slow_weight', n)}
          />
          <NumField
            label='滞回倍数'
            desc='新旧权重差距不到此倍数时不调整，防止抖动'
            value={policy.hysteresis}
            onChange={(n) => set('hysteresis', n)}
          />
          <NumField
            label='冷却（秒）'
            desc='同一槽多少秒内不重复调整'
            value={policy.cooldown_seconds}
            onChange={(n) => set('cooldown_seconds', n)}
            width='w-28'
          />
          <div className='flex justify-end gap-2 pt-2'>
            {dirty ? (
              <Button variant='ghost' onClick={() => setDraft(null)}>
                取消
              </Button>
            ) : null}
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(policy)}>
              保存策略
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>实时 TTFT（近 {policy.window_minutes} 分钟）</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className='text-sm text-muted-foreground'>窗口内暂无请求</p>
          ) : (
            <table className='w-full text-sm'>
              <thead>
                <tr className='text-left text-muted-foreground'>
                  <th className='py-1 font-normal'>槽位</th>
                  <th className='font-normal'>样本</th>
                  <th className='font-normal'>P50</th>
                  <th className='font-normal'>当前权重</th>
                  <th className='font-normal'>目标权重</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => {
                  const target =
                    s.p50 < policy.fast_ms
                      ? policy.fast_weight
                      : s.p50 < policy.slow_ms
                        ? policy.mid_weight
                        : policy.slow_weight
                  return (
                    <tr key={s.vm_id} className='border-t border-border/50'>
                      <td className='py-1 font-mono'>{s.vm_id}</td>
                      <td>{s.n}</td>
                      <td>{fmtMs(s.p50)}</td>
                      <td>{s.weight ?? '—'}</td>
                      <td className={target !== s.weight ? 'text-amber-500' : ''}>{target}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
