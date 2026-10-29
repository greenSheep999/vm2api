import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { dashboardQueryOptions } from '@/features/overview/queries'
import { vmQueryOptions } from '@/features/vm/queries'

/**
 * 上游传输方式：HTTP 直连 SSE（默认）或 WebSocket。
 *
 * WS 的收益来自连接复用 + previous_response_id：
 *   实测 TTFT 2.17s vs 2.58s，第三发命中 1024 token 缓存（HTTP 恒为 0）。
 * 所以按槽位单独开，出问题只影响这一个号。
 */
export function UpstreamTransportCard({ vm }: { vm: Vm }) {
  const qc = useQueryClient()
  const current = (vm as unknown as { transport?: { upstream?: string } })?.transport?.upstream
  const wsOn = current === 'ws'

  const mutate = useMutation({
    mutationFn: (upstream: 'ws' | 'http') =>
      api(`/api/panel/vms/${encodeURIComponent(vm.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ transport: { upstream } }),
      }),
    onSuccess: (_r, upstream) => {
      toast.success(upstream === 'ws' ? '已切换为 WebSocket 上游' : '已切回 HTTP 上游')
      void qc.invalidateQueries({ queryKey: vmQueryOptions(vm.id).queryKey })
      void qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey })
    },
    onError: (e) => toast.error(`切换失败：${(e as Error).message}`),
  })

  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='text-sm'>上游传输</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex items-start justify-between gap-3'>
          <div className='space-y-0.5'>
            <Label className='text-xs'>走 WebSocket</Label>
            <p className='text-[11px] text-muted-foreground'>
              复用连接 + previous_response_id，缓存命中更好、TTFT 更低。
              关闭则走 HTTP 直连 SSE（默认）。
            </p>
          </div>
          <Switch
            checked={wsOn}
            disabled={mutate.isPending}
            onCheckedChange={(on) => mutate.mutate(on ? 'ws' : 'http')}
          />
        </div>
        <p className='text-[11px] text-muted-foreground'>
          当前：{wsOn ? 'WebSocket（wss://chatgpt.com/backend-api/codex/responses）' : 'HTTP 直连'}
        </p>
      </CardContent>
    </Card>
  )
}
