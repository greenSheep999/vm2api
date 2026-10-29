import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { dashboardQueryOptions } from '@/features/overview/queries'
import { vmQueryOptions } from '@/features/vm/queries'

type WsMode = 'ctx_pool' | 'passthrough' | 'http_bridge'

const MODES: { value: WsMode; label: string; hint: string }[] = [
  {
    value: 'ctx_pool',
    label: '连接池复用（推荐）',
    hint: '复用预热好的上游连接。缓存命中最好、TTFT 最低；一条连接跑多轮。',
  },
  {
    value: 'passthrough',
    label: '每会话单连',
    hint: '每个会话单独建连、不共享。隔离性最好，建连成本略高。',
  },
  {
    value: 'http_bridge',
    label: 'HTTP 桥接',
    hint: '入站 HTTP 请求也借 WS 通道发，对客户端完全透明。',
  },
]

/**
 * 上游传输：独立开关 + 模式选择（对齐 sub 的交互）。
 * WS 收益来自连接复用 + previous_response_id：实测 TTFT 2.17s vs 2.58s，
 * 第三发吃到 1024 token 缓存（HTTP 恒为 0）。按槽位单独开，出问题单号回滚。
 */
export function UpstreamTransportCard({ vm }: { vm: Vm }) {
  const qc = useQueryClient()
  const transport = (vm as unknown as { transport?: { upstream?: string; ws_mode?: string } })?.transport
  const enabled = transport?.upstream === 'ws'
  const current: WsMode =
    transport?.ws_mode === 'passthrough' || transport?.ws_mode === 'http_bridge'
      ? transport.ws_mode
      : 'ctx_pool'

  const mutate = useMutation({
    mutationFn: (payload: { enabled?: boolean; mode?: WsMode }) => {
      const ws_mode = payload.mode ?? current
      const on = payload.enabled ?? enabled
      return api(`/api/panel/vms/${encodeURIComponent(vm.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          transport: { ws_mode: on ? ws_mode : 'off', upstream: on ? 'ws' : 'http' },
        }),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: vmQueryOptions(vm.id).queryKey })
      void qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey })
    },
    onError: (e) => toast.error(`切换失败：${(e as Error).message}`),
  })

  const active = MODES.find((m) => m.value === current)!

  return (
    <Card>
      <CardHeader className='pb-1.5'>
        <CardTitle className='text-sm'>上游传输</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2.5 pt-0'>
        <div className='flex items-start justify-between gap-3'>
          <div className='space-y-0.5'>
            <Label className='text-xs'>启用 WebSocket</Label>
            <p className='text-[11px] text-muted-foreground'>
              {enabled ? '当前走 WS 通道' : '当前走 HTTP 直连 SSE'}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={mutate.isPending}
            onCheckedChange={(on) => mutate.mutate({ enabled: on })}
          />
        </div>

        <div className='space-y-1'>
          <Label className='text-xs text-muted-foreground'>连接模式</Label>
          <Select
            value={current}
            disabled={!enabled || mutate.isPending}
            onValueChange={(value) => mutate.mutate({ mode: value as WsMode })}
          >
            <SelectTrigger className='h-9 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value} className='text-xs'>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-[11px] text-muted-foreground'>
            {enabled ? active.hint : '开启上面的开关后才能选模式。'}
          </p>
        </div>

        <p className='text-[11px] text-muted-foreground'>
          只影响这个槽位；出问题关掉开关就回 HTTP，其它号不受影响。
        </p>
      </CardContent>
    </Card>
  )
}
