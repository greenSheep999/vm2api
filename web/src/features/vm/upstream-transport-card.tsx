import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { dashboardQueryOptions } from '@/features/overview/queries'
import { vmQueryOptions } from '@/features/vm/queries'

type WsMode = 'ctx_pool' | 'passthrough' | 'http_bridge'

const MODES: { value: WsMode; label: string }[] = [
  { value: 'ctx_pool', label: '连接池复用' },
  { value: 'passthrough', label: '每会话单连' },
  { value: 'http_bridge', label: 'HTTP 桥接' },
]

/**
 * 上游连接方式：一行开关 + （打开时）一行模式下拉。
 * 不铺说明文字——细节点进槽位详情看。
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

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <span className='text-xs font-medium'>上游连接</span>
        <span className='flex items-center gap-2'>
          <span className='text-[11px] text-muted-foreground'>{enabled ? 'WebSocket' : 'HTTP'}</span>
          <Switch
            checked={enabled}
            disabled={mutate.isPending}
            onCheckedChange={(on) => mutate.mutate({ enabled: on })}
          />
        </span>
      </div>
      {enabled ? (
        <Select
          value={current}
          disabled={mutate.isPending}
          onValueChange={(value) => mutate.mutate({ mode: value as WsMode })}
        >
          <SelectTrigger className='h-8 w-full text-[11px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value} className='text-[11px]'>
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}
