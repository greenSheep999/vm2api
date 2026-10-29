import { useEffect, useState } from 'react'
import { Save, TicketCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import type { OpsTicketPolicy } from './types'

const CARD = 'rounded-lg border bg-card p-4'

/** 策略卡：门票开关与参数。保存走 PUT /api/panel/routing（整份配置回写）。 */
export function PolicyCard({ policy }: { policy: OpsTicketPolicy }) {
  const [draft, setDraft] = useState<OpsTicketPolicy>(policy)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(policy), [policy])

  const patch = (next: Partial<OpsTicketPolicy>) =>
    setDraft((cur) => ({ ...cur, ...next }))

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
          <Label className='text-xs'>目标模型（逗号分隔，空 = 全部）</Label>
          <Input
            value={draft.models.join(',')}
            placeholder='gpt-6-astra,gpt-6.1-sol'
            onChange={(e) =>
              patch({
                models: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
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
        <Textarea
          rows={3}
          spellCheck={false}
          placeholder={'172.64.155.209\n104.18.32.47'}
          value={draft.edge_ips.join('\n')}
          onChange={(e) =>
            patch({
              edge_ips: e.target.value
                .split('\n')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
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

