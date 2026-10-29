import { useQueryClient, useMutation } from '@tanstack/react-query'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { UpstreamTransportCard } from '@/features/vm/upstream-transport-card'

type CodexSettings = {
  fingerprint_mode?: 'off' | 'device' | 'session' | 'full'
  allow_official_only?: boolean
  compact_mode?: 'auto' | 'on' | 'off'
}

/**
 * Codex 槽位专属设置页：把散在全局策略里的开关收敛到一个地方，
 * 并按槽位覆盖（写 vm.codex.settings），互不影响。
 */
export function CodexSettingsTab({ vm }: { vm: Vm }) {
  const qc = useQueryClient()
  const settings: CodexSettings =
    (vm as unknown as { codex?: { settings?: CodexSettings } })?.codex?.settings || {}

  const save = useMutation({
    mutationFn: (next: CodexSettings) =>
      api(`/api/panel/vms/${encodeURIComponent(vm.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ codex_settings: next }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: vmQueryOptions(vm.id).queryKey })
      void qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey })
    },
    onError: (e) => toast.error(`保存失败：${(e as Error).message}`),
  })

  const patch = (next: CodexSettings) => save.mutate({ ...settings, ...next })

  return (
    <div className='grid gap-3 lg:grid-cols-2'>
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>上游连接</CardTitle>
          <CardDescription className='text-[11px]'>
            HTTP 直连或 WebSocket；WS 复用连接后缓存命中更好、TTFT 更低。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UpstreamTransportCard vm={vm} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>指纹收敛</CardTitle>
          <CardDescription className='text-[11px]'>
            多人共号时收敛设备/会话标识，减少上游可见设备数。收敛可能影响额度。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-2'>
          <Select
            value={settings.fingerprint_mode || 'off'}
            disabled={save.isPending}
            onValueChange={(v) => patch({ fingerprint_mode: v as CodexSettings['fingerprint_mode'] })}
          >
            <SelectTrigger className='h-9 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='off' className='text-xs'>关闭（透传客户端标识）</SelectItem>
              <SelectItem value='device' className='text-xs'>仅设备</SelectItem>
              <SelectItem value='session' className='text-xs'>设备 + 会话</SelectItem>
              <SelectItem value='full' className='text-xs'>完全收敛</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>访问控制</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <Label className='text-xs'>仅允许 Codex 官方客户端</Label>
              <p className='text-[11px] text-muted-foreground'>
                开启后 originator / User-Agent 不是 codex 的请求直接 403。
              </p>
            </div>
            <Switch
              checked={settings.allow_official_only === true}
              disabled={save.isPending}
              onCheckedChange={(on) => patch({ allow_official_only: on })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>Compact 模式</CardTitle>
          <CardDescription className='text-[11px]'>
            控制 /v1/responses/compact 是否转发到上游。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={settings.compact_mode || 'auto'}
            disabled={save.isPending}
            onValueChange={(v) => patch({ compact_mode: v as CodexSettings['compact_mode'] })}
          >
            <SelectTrigger className='h-9 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='auto' className='text-xs'>自动（跟随策略）</SelectItem>
              <SelectItem value='on' className='text-xs'>强制允许</SelectItem>
              <SelectItem value='off' className='text-xs'>强制关闭（400）</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className='lg:col-span-2'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>TLS 指纹</CardTitle>
          <CardDescription className='text-[11px]'>
            这家上游会读 ClientHello：Node 与 uTLS 的指纹不同，敏感账号建议走 worker 链路。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-1 text-[11px] text-muted-foreground'>
          <div className='flex items-center justify-between'>
            <span>HTTP 直连 / WebSocket（Node）</span>
            <span className='font-mono text-foreground'>Node 默认 ClientHello</span>
          </div>
          <div className='flex items-center justify-between'>
            <span>Go worker（uTLS）</span>
            <span className='font-mono text-foreground'>node24ClientHelloSpecValue</span>
          </div>
          <p className='pt-1'>
            目前 Node 直连与 WS 都使用 Node 默认 TLS 指纹；uTLS 只在 Go worker 链路生效。
            敏感账号可以走 worker 链路以获得一致的指纹。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
