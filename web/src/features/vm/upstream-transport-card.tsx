import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { dashboardQueryOptions } from '@/features/overview/queries'
import { vmQueryOptions } from '@/features/vm/queries'

type WsMode = 'off' | 'ctx_pool' | 'passthrough' | 'http_bridge'

const MODES: { value: WsMode; label: string; hint: string }[] = [
  { value: 'off', label: 'HTTP 直连（默认）', hint: '不启用 WebSocket，走原来的直连 SSE。' },
  {
    value: 'ctx_pool',
    label: 'WS · 连接池复用',
    hint: '复用预热好的上游连接。缓存命中最好，TTFT 最低。',
  },
  {
    value: 'passthrough',
    label: 'WS · 每会话单连',
    hint: '每个会话单独建连，不共享连接。隔离性最好，成本略高。',
  },
  {
    value: 'http_bridge',
    label: 'WS · HTTP 桥接',
    hint: '入站 HTTP 请求也借 WS 通道发，对客户端完全透明。',
  },
]

/**
 * 上游传输方式。WS 的收益来自连接复用 + previous_response_id：
 * 实测 TTFT 2.17s vs 2.58s，第三发吃到 1024 token 缓存（HTTP 恒为 0）。
 * 按槽位单独开，出问题只影响这一个号。
 */
export function UpstreamTransportCard({ vm }: { vm: Vm }) {
  const qc = useQueryClient()
  const transport = (vm as unknown as { transport?: { upstream?: string; ws_mode?: string } })?.transport
  const current: WsMode =
    transport?.ws_mode === 'ctx_pool' ||
    transport?.ws_mode === 'passthrough' ||
    transport?.ws_mode === 'http_bridge'
      ? transport.ws_mode
      : transport?.upstream === 'ws'
        ? 'ctx_pool'
        : 'off'

  const mutate = useMutation({
    mutationFn: (ws_mode: WsMode) =>
      api(`/api/panel/vms/${encodeURIComponent(vm.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ transport: { ws_mode } }),
      }),
    onSuccess: (_r, mode) => {
      toast.success(mode === 'off' ? '已切回 HTTP 直连' : `已切换为 ${mode}`)
      void qc.invalidateQueries({ queryKey: vmQueryOptions(vm.id).queryKey })
      void qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey })
    },
    onError: (e) => toast.error(`切换失败：${(e as Error).message}`),
  })

  const active = MODES.find((m) => m.value === current)

  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='text-sm'>上游传输</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <Label className='text-xs'>传输模式</Label>
        <Select
          value={current}
          disabled={mutate.isPending}
          onValueChange={(value) => mutate.mutate(value as WsMode)}
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
        <p className='text-[11px] text-muted-foreground'>{active?.hint}</p>
        <p className='text-[11px] text-muted-foreground'>
          开关只影响这一个槽位；出问题切回「HTTP 直连」即可，不影响其它号。
        </p>
      </CardContent>
    </Card>
  )
}
