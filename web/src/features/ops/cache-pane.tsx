import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type BucketRow = { plan: string; bucket: string; samples: number; hitRatio: number }
type SlotRow = { vmId: string; plan: string; samples: number; hitRatio: number }
type KeyRow = { keyId: string; keyName: string; samples: number; hitRatio: number }
type Stats = { bucketRows: BucketRow[]; slotRows: SlotRow[]; keyRows: KeyRow[]; hours: number }
type TestRound = { round: number; status?: number; cachedTokens: number; inputTokens: number; hitRatio: number; totalMs?: number }

const BUCKET_ORDER = ['0-1min', '1-5min', '5-15min', '15-60min', '1-6h', '>6h']

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

function tone(v: number) {
  return v >= 0.8 ? 'text-emerald-600 dark:text-emerald-400' : v >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
}

/**
 * 缓存实验台：命中率随空闲间隔的变化 + 主动测试。
 * 「缓存比例」不是能直接设的数字，而是由空闲间隔、是否换号、请求键是否稳定共同决定。
 */
export function CacheLabPane() {
  const [keyId, setKeyId] = useState('')
  const [vmId, setVmId] = useState('')
  const [model, setModel] = useState('gpt-5.6-sol')
  const [count, setCount] = useState(3)
  const [gapSec, setGapSec] = useState(5)

  const stats = useQuery({
    queryKey: ['ops-cache-stats'],
    queryFn: () => api<Stats>('/api/panel/ops/cache/stats?hours=12'),
    refetchInterval: 60_000,
  })

  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; results: TestRound[]; reason?: string }>('/api/panel/ops/cache/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: keyId, vm_id: vmId || null, model, count, gap_ms: gapSec * 1000 }),
      }),
    onSuccess: (r) => {
      if (!r?.ok) toast.warning(`测试未成功：${r?.reason || 'unknown'}`)
      else toast.success(`完成 ${r.results.length} 发`)
    },
    onError: (e) => toast.error(`测试失败：${(e as Error).message}`),
  })

  const plans = [...new Set((stats.data?.bucketRows || []).map((r) => r.plan))].sort()

  return (
    <div className='space-y-4'>
      <section className='rounded-lg border p-3'>
        <h4 className='text-sm font-semibold'>命中率 × 空闲间隔（近 12 小时真实流量）</h4>
        <div className='mt-2 overflow-x-auto'>
          <table className='w-full text-[11px]'>
            <thead>
              <tr className='text-muted-foreground'>
                <th className='py-1 text-left'>套餐</th>
                {BUCKET_ORDER.map((b) => (
                  <th key={b} className='py-1 text-right'>{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p} className='border-t'>
                  <td className='py-1 font-mono'>{p}</td>
                  {BUCKET_ORDER.map((b) => {
                    const row = (stats.data?.bucketRows || []).find((r) => r.plan === p && r.bucket === b)
                    return (
                      <td key={b} className={cn('py-1 text-right tabular-nums', row ? tone(row.hitRatio) : 'text-muted-foreground')}>
                        {row ? `${pct(row.hitRatio)} (${row.samples})` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className='mt-2 text-[11px] text-muted-foreground'>
          括号里是样本数。间隔超过 1 分钟后命中率普遍掉到 50% 以下——上游前缀缓存的滚动窗口很短。
        </p>
      </section>

      <section className='rounded-lg border p-3'>
        <h4 className='text-sm font-semibold'>按 Key（缓存归属口径）</h4>
        <p className='mt-1 text-[11px] text-muted-foreground'>
          缓存是按「客户会话 + 账号」滚动的，所以策略应当挂在 key 上，而不是套餐上。
        </p>
        <div className='mt-2 divide-y'>
          {(stats.data?.keyRows || []).map((k) => (
            <div key={k.keyId} className='flex items-center justify-between gap-2 py-1 text-[11px]'>
              <span className='truncate font-mono'>{k.keyName}</span>
              <span className='text-muted-foreground'>{k.samples} 发</span>
              <span className={cn('tabular-nums', tone(k.hitRatio))}>{pct(k.hitRatio)}</span>
              <Button
                size='sm'
                variant='ghost'
                className='h-6 px-1.5 text-[10px]'
                onClick={() => setKeyId(k.keyId)}
              >
                选它测试
              </Button>
            </div>
          ))}
          {!stats.data?.keyRows?.length ? <p className='py-2 text-[11px] text-muted-foreground'>暂无数据</p> : null}
        </div>
      </section>

      <section className='rounded-lg border p-3'>
        <h4 className='text-sm font-semibold'>按槽位</h4>
        <div className='mt-2 divide-y'>
          {(stats.data?.slotRows || []).map((s) => (
            <div key={s.vmId} className='flex items-center justify-between py-1 text-[11px]'>
              <span className='font-mono'>{s.vmId}</span>
              <span className='text-muted-foreground'>{s.plan} · {s.samples} 发</span>
              <span className={cn('tabular-nums', tone(s.hitRatio))}>{pct(s.hitRatio)}</span>
            </div>
          ))}
          {!stats.data?.slotRows?.length ? <p className='py-2 text-[11px] text-muted-foreground'>暂无数据</p> : null}
        </div>
      </section>

      <section className='rounded-lg border p-3'>
        <h4 className='text-sm font-semibold'>主动测试</h4>
        <div className='mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-5'>
          <div className='space-y-1'>
            <Label className='text-[11px]'>Key（必填）</Label>
            <Input className='h-8 text-xs' value={keyId} placeholder='key_xxx' onChange={(e) => setKeyId(e.target.value)} />
          </div>
          <div className='space-y-1'>
            <Label className='text-[11px]'>固定槽位（可空）</Label>
            <Input className='h-8 text-xs' value={vmId} placeholder='留空=按调度' onChange={(e) => setVmId(e.target.value)} />
          </div>
          <div className='space-y-1'>
            <Label className='text-[11px]'>模型</Label>
            <Input className='h-8 text-xs' value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className='space-y-1'>
            <Label className='text-[11px]'>连发次数</Label>
            <Input type='number' min={1} max={10} className='h-8 text-xs' value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
          </div>
          <div className='space-y-1'>
            <Label className='text-[11px]'>间隔（秒）</Label>
            <Input type='number' min={0} max={120} className='h-8 text-xs' value={gapSec} onChange={(e) => setGapSec(Number(e.target.value) || 0)} />
          </div>
        </div>
        <Button size='sm' className='mt-2 h-8 text-xs' loading={test.isPending} onClick={() => test.mutate()}>
          开始测试
        </Button>
        {test.data?.results?.length ? (
          <div className='mt-2 space-y-1'>
            {test.data.results.map((r) => (
              <div key={r.round} className='flex items-center justify-between text-[11px]'>
                <span>第 {r.round} 发</span>
                <span className='text-muted-foreground'>
                  缓存 {r.cachedTokens} / 输入 {r.inputTokens}
                </span>
                <span className={cn('tabular-nums', tone(r.hitRatio))}>{pct(r.hitRatio)}</span>
                <span className='tabular-nums text-muted-foreground'>{r.totalMs ?? '—'}ms</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
