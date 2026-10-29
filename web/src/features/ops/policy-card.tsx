import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Save, TicketCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import type { OpsTicketPolicy } from './types'

const CARD = 'rounded-lg border bg-card p-4'

/** 策略卡：门票开关与参数。保存走 PUT /api/panel/routing（整份配置回写）。 */
const HARVEST_MODELS = [
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
]

/** 拉当前 DNS 解析到的边缘节点，显示出来（手填优先，留空则用这里的）。 */
function EdgePreview() {
  const q = useQuery({
    queryKey: ['ops-edge-ips'],
    queryFn: () => api<{ ips: string[]; source: string; at: string }>('/api/panel/ops/edge-ips'),
    refetchInterval: 60_000,
  })
  const ips = q.data?.ips || []
  return (
    <p className='text-[11px] text-muted-foreground'>
      {ips.length
        ? `当前可用边缘（${q.data?.source}）：${ips.join('、')}`
        : '暂时拿不到边缘 IP（DNS 解析失败）'}
    </p>
  )
}

export function PolicyCard({ policy }: { policy: OpsTicketPolicy }) {
  const [draft, setDraft] = useState<OpsTicketPolicy>(policy)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(policy), [policy])

  const patch = (next: Partial<OpsTicketPolicy>) =>
    setDraft((cur) => ({ ...cur, ...next }))

  /** 自动获取边缘 IP（Cloudflare anycast）：一键填进草稿，保存后生效。 */
  async function fillEdgeIps() {
    try {
      const data = await api<{ ips: string[] }>('/api/panel/ops/edge-ips')
      const ips = data?.ips || []
      if (!ips.length) return toast.warning('DNS 没解析到边缘 IP，稍后再试')
      patch({ edge_ips: ips })
      toast.success(`已填入 ${ips.length} 个边缘 IP`)
    } catch (e) {
      toast.error(`获取失败：${(e as Error).message}`)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const current = await api<Record<string, unknown>>('/api/panel/routing')
      const codex = (current?.codex as Record<string, unknown>) || {}
      const next = { ...current, codex: { ...codex, ticket: draft } }
      await api('/api/panel/routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      toast.success('门票策略已保存')
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={CARD}>
      <div className='mb-3 flex items-center justify-between'>
        <h4 className='flex items-center gap-2 text-sm font-semibold'>
          <TicketCheck className='h-4 w-4 text-blue-600' />
          打票策略
        </h4>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-muted-foreground'>启用打票</span>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
        </div>
      </div>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <div className='space-y-1.5'>
          <Label className='text-xs'>目标模型（多选，空 = 全部）</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='outline' size='sm' className='h-8 w-full justify-between text-xs font-normal'>
                <span className='truncate'>
                  {draft.models.length ? draft.models.join(', ') : '全部模型'}
                </span>
                <ChevronDown className='ml-2 h-3.5 w-3.5 shrink-0 opacity-60' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-[280px] p-1' align='start'>
              <div className='max-h-64 overflow-auto'>
                {HARVEST_MODELS.map((model) => {
                  const checked = draft.models.includes(model)
                  return (
                    <label
                      key={model}
                      className='flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent'
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          patch({
                            models: next
                              ? [...draft.models, model]
                              : draft.models.filter((m) => m !== model),
                          })
                        }
                      />
                      <span className='font-mono'>{model}</span>
                    </label>
                  )
                })}
              </div>
              <div className='mt-1 flex justify-between border-t px-2 pt-1.5'>
                <button
                  type='button'
                  className='text-[11px] text-muted-foreground hover:text-foreground'
                  onClick={() => patch({ models: [] })}
                >
                  清空（= 全部）
                </button>
                <button
                  type='button'
                  className='text-[11px] text-muted-foreground hover:text-foreground'
                  onClick={() => patch({ models: [...HARVEST_MODELS] })}
                >
                  全选
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>目标块数（0 = 按套餐）</Label>
          <Input
            type='number'
            min={0}
            max={64}
            value={draft.target_blocks}
            onChange={(e) => patch({ target_blocks: Number(e.target.value) || 0 })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>票有效期（秒）</Label>
          <Input
            type='number'
            min={60}
            value={draft.ttl_seconds}
            onChange={(e) => patch({ ttl_seconds: Number(e.target.value) || 3600 })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>提前刷新（秒）</Label>
          <Input
            type='number'
            min={0}
            value={draft.refresh_before_seconds}
            onChange={(e) =>
              patch({ refresh_before_seconds: Number(e.target.value) || 0 })
            }
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>打票间隔（秒）</Label>
          <Input
            type='number'
            min={60}
            value={draft.harvest_interval_seconds}
            onChange={(e) =>
              patch({ harvest_interval_seconds: Number(e.target.value) || 3600 })
            }
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>失败冷却（秒）</Label>
          <Input
            type='number'
            min={0}
            value={draft.harvest_cooldown_seconds}
            onChange={(e) =>
              patch({ harvest_cooldown_seconds: Number(e.target.value) || 600 })
            }
          />
        </div>
      </div>
      <div className='mt-3 space-y-1.5 rounded-md border border-dashed p-3'>
        <div className='flex items-center justify-between'>
          <Label className='text-xs font-medium'>直连打票：指定边缘节点（推荐）</Label>
          <Switch
            checked={draft.edge_direct}
            onCheckedChange={(edge_direct) => patch({ edge_direct })}
          />
        </div>
        <div className='flex items-start gap-2'>
          <Textarea
            rows={2}
            spellCheck={false}
            placeholder={'留空 = 自动从 DNS 获取；也可以手填，一行一个'}
            value={draft.edge_ips.join('\n')}
            onChange={(e) =>
              patch({
                edge_ips: e.target.value
                  .split(/[,\n\s]+/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
          <div className='flex shrink-0 flex-col gap-1'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-7 px-2 text-[11px]'
              onClick={() => void fillEdgeIps()}
            >
              自动获取
            </Button>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='h-7 px-2 text-[11px]'
              onClick={() => patch({ edge_ips: [] })}
            >
              清空
            </Button>
          </div>
        </div>
        <label className='flex items-center gap-2 text-[11px] text-muted-foreground'>
          <Checkbox
            checked={draft.edge_auto}
            onCheckedChange={(edge_auto) => patch({ edge_auto: edge_auto === true })}
          />
          持续自动获取（每
          <Input
            type='number'
            min={60}
            max={86400}
            className='h-6 w-[70px] text-[11px]'
            value={draft.edge_auto_interval_seconds}
            onChange={(e) =>
              patch({ edge_auto_interval_seconds: Math.max(60, Number(e.target.value) || 600) })
            }
          />
          秒重新解析 DNS）
        </label>
        <EdgePreview />
        <p className='text-[11px] text-muted-foreground'>
          把连接目标换成指定 Cloudflare 边缘 IP，SNI 仍是 chatgpt.com、出口仍是槽位代理——
          换路由不换身份。留空/关闭则回到经网关的默认方式。
        </p>
      </div>
      <div className='mt-3 space-y-1.5'>
        <Label className='text-xs'>备用出口代理（一行一条，socks5:// 或 http://）</Label>
        <Textarea
          rows={3}
          spellCheck={false}
          placeholder={'socks5://user:pass@1.2.3.4:1080\nhttp://user:pass@5.6.7.8:8080'}
          value={draft.harvest_proxies.join('\n')}
          onChange={(e) =>
            patch({
              harvest_proxies: e.target.value
                .split('\n')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
        <p className='text-[11px] text-muted-foreground'>
          留空则只用槽位自己绑定的代理。同一账号会优先回到它铸票时的那个出口，
          连续失败 2 次才迁移到这里的备用出口。
        </p>
      </div>
      <div className='mt-3 grid gap-2 sm:grid-cols-2'>
        <label className='flex items-start gap-2 rounded-md border p-2.5 text-xs'>
          <Switch
            checked={draft.candy_observation}
            onCheckedChange={(candy_observation) => patch({ candy_observation })}
          />
          <span>
            <span className='font-medium'>糖果观察（Beta）</span>
            <span className='mt-0.5 block text-[11px] text-muted-foreground'>
              票被真实请求用过之后，异步补发一发糖果题，只记录能力值，
              不影响调度与票据状态。
            </span>
          </span>
        </label>
        <div className='space-y-1.5 rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>窗口成本上限（USD，0 = 不限）</Label>
          <div className='flex items-center gap-1.5'>
            <Input
              type='number'
              min={0}
              step={0.5}
              className='h-8 text-xs'
              value={draft.window_cost_limit_usd}
              onChange={(e) => patch({ window_cost_limit_usd: Number(e.target.value) || 0 })}
            />
            <span className='shrink-0 text-[11px] text-muted-foreground'>/ 每</span>
            <Input
              type='number'
              min={1}
              max={168}
              className='h-8 w-[70px] text-xs'
              value={draft.window_cost_hours}
              onChange={(e) => patch({ window_cost_hours: Math.max(1, Number(e.target.value) || 5) })}
            />
            <span className='shrink-0 text-[11px] text-muted-foreground'>小时</span>
          </div>
          <p className='text-[11px] text-muted-foreground'>
            超过上限的槽位暂停参与调度，直到窗口滑过去。
          </p>
        </div>
        <div className='space-y-1.5 rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>RPM 策略</Label>
          <Select
            value={draft.rpm_strategy}
            onValueChange={(value) => patch({ rpm_strategy: value as never })}
          >
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='tiered' className='text-xs'>按套餐分层</SelectItem>
              <SelectItem value='sticky_exempt' className='text-xs'>粘性会话豁免</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5 rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>指纹收敛</Label>
          <Select
            value={draft.fingerprint_mode}
            onValueChange={(value) => patch({ fingerprint_mode: value as never })}
          >
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='off' className='text-xs'>关闭（透传，默认）</SelectItem>
              <SelectItem value='device' className='text-xs'>仅设备</SelectItem>
              <SelectItem value='session' className='text-xs'>设备 + 会话</SelectItem>
              <SelectItem value='full' className='text-xs'>完全收敛</SelectItem>
            </SelectContent>
          </Select>
          <p className='text-[11px] text-muted-foreground'>
            多人共号时把设备/会话标识收敛为账号恒定值。收敛可能影响额度，按实测选择。
          </p>
        </div>
        <label className='flex items-start gap-2 rounded-md border p-2.5 text-xs'>
          <Switch
            checked={draft.allow_official_only}
            onCheckedChange={(allow_official_only) => patch({ allow_official_only })}
          />
          <span>
            <span className='font-medium'>仅允许 Codex 官方客户端</span>
            <span className='mt-0.5 block text-[11px] text-muted-foreground'>
              开启后 originator / User-Agent 不是 codex 的请求直接拒（403）。
            </span>
          </span>
        </label>
        <div className='space-y-1.5 rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>Compact 模式</Label>
          <Select
            value={draft.compact_mode}
            onValueChange={(value) => patch({ compact_mode: value as never })}
          >
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='auto' className='text-xs'>自动（跟随探测）</SelectItem>
              <SelectItem value='on' className='text-xs'>强制允许</SelectItem>
              <SelectItem value='off' className='text-xs'>强制排除</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className='flex items-start gap-2 rounded-md border p-2.5 text-xs'>
          <Switch
            checked={draft.overflow_to_any_plan}
            onCheckedChange={(overflow_to_any_plan) => patch({ overflow_to_any_plan })}
          />
          <span>
            <span className='font-medium'>额度耗尽时溢出到其它套餐</span>
            <span className='mt-0.5 block text-[11px] text-muted-foreground'>
              默认关闭。开启后本 key 范围内的账号全部没额度时，会借用其它套餐的槽位，
              计费归属和套餐承诺会错位，正常情况下不应该发生。
            </span>
          </span>
        </label>
        <label className='flex items-start gap-2 rounded-md border p-2.5 text-xs'>
          <Switch
            checked={draft.probe_routing}
            onCheckedChange={(probe_routing) => patch({ probe_routing })}
          />
          <span>
            <span className='font-medium'>按探针结论排序调度</span>
            <span className='mt-0.5 block text-[11px] text-muted-foreground'>
              探针 healthy 的账号优先接流量，降智账号排到后面（仍保留，池子空了照常服务）。
            </span>
          </span>
        </label>
        <label className='flex items-start gap-2 rounded-md border p-2.5 text-xs'>
          <Switch
            checked={draft.inject}
            onCheckedChange={(inject) => patch({ inject })}
          />
          <span>
            <span className='font-medium'>注入票库门票</span>
            <span className='mt-0.5 block text-[11px] text-muted-foreground'>
              业务请求带上票库里「已验证」的票（只注入验证过的，过期自动不用）。
              当前账号若被锁档，注入也救不回来。
            </span>
          </span>
        </label>
        <label className='flex items-start gap-2 rounded-md border p-2.5 text-xs'>
          <Switch
            checked={draft.auto_park}
            onCheckedChange={(auto_park) => patch({ auto_park })}
          />
          <span>
            <span className='font-medium'>探针降智时自动降权</span>
            <span className='mt-0.5 block text-[11px] text-muted-foreground'>
              探针判 degraded/route_changed 就关调度，判 healthy 自动恢复。
              默认关闭，建议先观察一段时间。
            </span>
          </span>
        </label>
        <div className='rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>探针间隔 · 活跃号（秒，0 = 关闭）</Label>
          <Input
            type='number'
            min={0}
            max={86400}
            className='mt-1.5'
            value={draft.probe_interval_seconds}
            onChange={(e) =>
              patch({ probe_interval_seconds: Math.max(0, Number(e.target.value) || 0) })
            }
          />
          <p className='mt-1 text-[11px] text-muted-foreground'>
            近 30 分钟有流量的号用这个间隔；最及时的信号，建议 180–300 秒。
          </p>
        </div>
        <div className='rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>探针间隔 · 闲置号（秒）</Label>
          <Input
            type='number'
            min={60}
            max={86400}
            className='mt-1.5'
            value={draft.probe_idle_interval_seconds}
            onChange={(e) =>
              patch({ probe_idle_interval_seconds: Math.max(60, Number(e.target.value) || 1800) })
            }
          />
          <p className='mt-1 text-[11px] text-muted-foreground'>
            没流量的号没必要勤探，默认 1800 秒。
          </p>
        </div>
        <div className='rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>糖果题间隔（秒，0 = 关闭）</Label>
          <Input
            type='number'
            min={0}
            max={86400}
            className='mt-1.5'
            value={draft.candy_interval_seconds}
            onChange={(e) =>
              patch({ candy_interval_seconds: Math.max(0, Number(e.target.value) || 0) })
            }
          />
          <p className='mt-1 text-[11px] text-muted-foreground'>
            只对探针 healthy 的号跑；答 21 判通过，答 29 判降智。建议 900 秒。
          </p>
        </div>
        <div className='rounded-md border p-2.5 text-xs'>
          <Label className='text-xs'>鹈鹕间隔（秒，0 = 关闭）</Label>
          <Input
            type='number'
            min={0}
            max={86400}
            className='mt-1.5'
            value={draft.pelican_interval_seconds}
            onChange={(e) =>
              patch({ pelican_interval_seconds: Math.max(0, Number(e.target.value) || 0) })
            }
          />
          <p className='mt-1 text-[11px] text-muted-foreground'>
            结构指纹变化最慢，默认 1800 秒；目前只记录，不参与判定。
          </p>
        </div>
        <label className='flex items-start gap-2 rounded-md border p-2.5 text-xs'>
          <Switch
            checked={draft.gate_scheduling}
            onCheckedChange={(gate_scheduling) => patch({ gate_scheduling })}
          />
          <span>
            <span className='font-medium'>无票时暂停调度</span>
            <span className='mt-0.5 block text-[11px] text-muted-foreground'>
              关闭时：票缺失只影响注入，账号仍正常调度；开启后无有效票的账号会被移出调度。
            </span>
          </span>
        </label>
      </div>
      <div className='mt-3 flex flex-wrap items-center justify-between gap-3'>
        <label className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Switch
            checked={draft.fail_closed}
            onCheckedChange={(fail_closed) => patch({ fail_closed })}
          />
          无票时拒绝裸打（fail_closed）
        </label>
        <Button size='sm' onClick={() => void save()} disabled={saving}>
          <Save className='mr-1 h-3.5 w-3.5' />
          {saving ? '保存中…' : '保存策略'}
        </Button>
      </div>
      <p className='mt-2 text-[11px] text-muted-foreground'>
        当前只做检测：这些参数会写进 routing.json 并立即生效于「判定」，
        铸票执行器（harvest）尚未接入，开启 fail_closed 不会改变线上转发行径。
      </p>
    </section>
  )
}

