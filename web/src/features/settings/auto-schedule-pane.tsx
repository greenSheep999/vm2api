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
  use_traffic: boolean
  traffic_cap: number
  use_quota: boolean
  quota_warn_pct: number
  quota_heavy_pct: number
  hysteresis: number
  cooldown_seconds: number
  interval_minutes: number
}

type SlotStat = {
  vm_id: string
  n: number
  p50: number
  traffic_pct: number
  used_5h: number | null
  used_7d: number | null
  weight: number | null
  suggested: number
  reasons: string[]
}

type Payload = { policy: Policy; stats: SlotStat[] }

function fmtMs(ms: number) {
  if (!Number.isFinite(ms)) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${Math.round(v)}%`
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

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['auto-schedule'] })

  const save = useMutation({
    mutationFn: (next: Policy) =>
      api<{ policy: Policy }>('/api/panel/auto-schedule', {
        method: 'PUT',
        body: JSON.stringify(next),
      }),
    onSuccess: () => {
      toast.success('策略已保存')
      setDraft(null)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const runNow = useMutation({
    mutationFn: () =>
      api<{ applied: { vm_id: string; from: number; to: number }[]; count: number }>(
        '/api/panel/auto-schedule/run',
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: (r) => {
      toast.success(r.count ? `已调整 ${r.count} 个槽` : '无需调整')
      invalidate()
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
  const pendingChanges = stats.filter((s) => s.weight !== s.suggested).length

  return (
    <div className='space-y-3'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0'>
          <CardTitle>自动权重调度</CardTitle>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={runNow.isPending}
              onClick={() => runNow.mutate()}
            >
              {runNow.isPending ? '执行中…' : '立即执行一次'}
            </Button>
            <Button size='sm' disabled={!dirty || save.isPending} onClick={() => save.mutate(policy)}>
              保存策略
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-1'>
          <SettingRow
            label='启用'
            desc='按下面两组阈值自动调整每个槽的 weight（热更新，不重启）'
          >
            <Switch checked={policy.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </SettingRow>

          <div className='pt-3 pb-1 text-xs font-medium text-muted-foreground'>
            TTFT 分档（基础）
          </div>
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
          <NumField label='快槽权重' value={policy.fast_weight} onChange={(n) => set('fast_weight', n)} />
          <NumField label='中速权重' value={policy.mid_weight} onChange={(n) => set('mid_weight', n)} />
          <NumField label='慢槽权重' value={policy.slow_weight} onChange={(n) => set('slow_weight', n)} />

          <div className='pt-3 pb-1 text-xs font-medium text-muted-foreground'>
            流量因子（防「好槽被压垮」）
          </div>
          <SettingRow
            label='启用'
            desc='窗口内请求数超过上限 → 权重降一档。避免「TTFT 好→权重拉满→被压垮」的正反馈'
          >
            <Switch checked={policy.use_traffic} onCheckedChange={(v) => set('use_traffic', v)} />
          </SettingRow>
          <NumField
            label='流量上限（次/窗口）'
            desc={`窗口内请求数超过此值视为被压（当前窗口 ${policy.window_minutes} 分钟）`}
            value={policy.traffic_cap}
            onChange={(n) => set('traffic_cap', n)}
            width='w-28'
          />

          <div className='pt-3 pb-1 text-xs font-medium text-muted-foreground'>
            额度因子（防「额度打光」）
          </div>
          <SettingRow label='启用' desc='按 5h/7d 使用率降权'>
            <Switch checked={policy.use_quota} onCheckedChange={(v) => set('use_quota', v)} />
          </SettingRow>
          <NumField
            label='告警阈值（%）'
            desc='超过此使用率 → 权重降一档'
            value={policy.quota_warn_pct}
            onChange={(n) => set('quota_warn_pct', n)}
            width='w-24'
          />
          <NumField
            label='重载阈值（%）'
            desc='超过此使用率 → 直接压到最低权重'
            value={policy.quota_heavy_pct}
            onChange={(n) => set('quota_heavy_pct', n)}
            width='w-24'
          />

          <div className='pt-3 pb-1 text-xs font-medium text-muted-foreground'>防抖</div>
          <NumField
            label='滞回倍数'
            desc='新旧权重差距不到此倍数时不调整'
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
          <NumField
            label='执行间隔（分钟）'
            desc='外部执行器（systemd timer）的周期'
            value={policy.interval_minutes}
            onChange={(n) => set('interval_minutes', n)}
            width='w-24'
          />

          {dirty ? (
            <div className='flex justify-end gap-2 pt-2'>
              <Button variant='ghost' onClick={() => setDraft(null)}>
                取消
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0'>
          <CardTitle>
            实时状态（近 {policy.window_minutes} 分钟）
          </CardTitle>
          <span className='text-xs text-muted-foreground'>
            {stats.length} 个槽 · {pendingChanges} 个待调整
          </span>
        </CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className='text-sm text-muted-foreground'>窗口内暂无请求</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='text-left text-muted-foreground'>
                    <th className='py-1 font-normal'>槽位</th>
                    <th className='font-normal'>请求</th>
                    <th className='font-normal'>流量</th>
                    <th className='font-normal'>P50</th>
                    <th className='font-normal'>5h</th>
                    <th className='font-normal'>7d</th>
                    <th className='font-normal'>权重</th>
                    <th className='font-normal'>建议</th>
                    <th className='font-normal'>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.vm_id} className='border-t border-border/50'>
                      <td className='py-1 font-mono'>{s.vm_id}</td>
                      <td>{s.n}</td>
                      <td className='text-muted-foreground'>{s.traffic_pct}%</td>
                      <td>{fmtMs(s.p50)}</td>
                      <td>{fmtPct(s.used_5h)}</td>
                      <td>{fmtPct(s.used_7d)}</td>
                      <td>{s.weight ?? '—'}</td>
                      <td className={s.suggested !== s.weight ? 'text-amber-500' : ''}>
                        {s.suggested}
                      </td>
                      <td className='text-xs text-muted-foreground'>
                        {s.reasons.length ? s.reasons.join('；') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
