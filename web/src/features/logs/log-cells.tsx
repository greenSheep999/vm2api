import type { UsageLogRow } from '@/types/panel-usage-logs'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ModelVendorIcon } from '@/components/model-vendor-icon'
import {
  copyText,
  resolveModelAuditDisplay,
  statusBadgeClass,
  statusBadgeTooltip,
  thinkingEffortBadgeClass,
} from './log-display'

export function StatusBadge({
  statusCode,
  finalState = null,
  errorCode = null,
  className,
}: {
  statusCode: number | null
  finalState?: string | null
  errorCode?: string | null
  className?: string
}) {
  const badge = (
    <Badge
      variant='outline'
      className={cn(
        'px-1.5 py-0 text-[10px] leading-tight tabular-nums [&_svg]:size-2.5',
        statusBadgeClass(statusCode, finalState),
        className
      )}
    >
      {statusCode ?? '未知'}
    </Badge>
  )
  const title = statusBadgeTooltip(statusCode, finalState, errorCode)
  if (!title) return badge
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span className='inline-flex'>{badge}</span>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs text-xs'>{title}</TooltipContent>
    </Tooltip>
  )
}

export function ThinkingEffortBadge({ effort }: { effort: string }) {
  return (
    <Badge
      variant='outline'
      className={cn(
        'w-fit px-1 py-0 text-[10px] leading-tight whitespace-nowrap [&_svg]:size-2.5',
        thinkingEffortBadgeClass(effort)
      )}
    >
      {effort}
    </Badge>
  )
}

/**
 * 思考强度。vm2api 只记录客户端请求值（无供应商覆写审计），
 * 因此没有 hub 的「请求 → 实际」箭头。
 */
export function ThinkingEffortDisplay({ effort }: { effort: string | null }) {
  if (!effort) return <span className='text-muted-foreground'>-</span>
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span
          className='relative z-20 inline-flex items-center gap-1 whitespace-nowrap'
          data-slot='thinking-effort'
        >
          <ThinkingEffortBadge effort={effort} />
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs space-y-1'>
        <p className='text-xs'>
          客户端请求中声明的思考强度（reasoning.effort / output_config.effort /
          thinking budget），按归一后的等级显示。
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

export function ModelDisplayWithRedirect({
  row,
  onRedirectClick,
}: {
  row: UsageLogRow
  onRedirectClick: () => void
}) {
  const audit = resolveModelAuditDisplay(row)
  const model = audit.primaryBillingModel
  const ticket = row.turnStateVerdict
  const hasChips = Boolean(ticket || audit.secondaryActualModel || audit.effortDowngraded)
  return (
    <div className='flex min-w-0 flex-col gap-y-0.5'>
      {/* 第一排：模型 + 思考强度（标签只放强度） */}
      <div className='flex min-w-0 items-center gap-1.5'>
        {model ? <ModelVendorIcon modelId={model} /> : null}
        <span
          className='cursor-pointer truncate text-xs hover:underline'
          onClick={(event) => {
            event.stopPropagation()
            if (model) void copyText(model)
          }}
        >
          {model || '-'}
        </span>
        {audit.hasRedirect ? (
          <Badge
            variant='outline'
            className='shrink-0 cursor-pointer border-blue-300 px-1 text-xs text-blue-700 dark:border-blue-700 dark:text-blue-300'
            onClick={(event) => {
              event.stopPropagation()
              onRedirectClick()
            }}
          >
            <ArrowRight className='h-3 w-3' />
          </Badge>
        ) : null}
        {row.reasoningEffort ? <ThinkingEffortDisplay effort={row.reasoningEffort} /> : null}
      </div>

      {/* 第二排：门票 + 模型一致性 + 上游降档，有才显示 */}
      {hasChips ? (
        <div className='flex min-w-0 flex-wrap items-center gap-1'>
          {ticket ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant='outline'
                  className={cn(
                    'shrink-0 cursor-help px-1 text-[10px] leading-tight',
                    ticket === 'ok'
                      ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300'
                      : 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300'
                  )}
                >
                  {ticket === 'ok'
                    ? `有票${row.turnStateLen ? ` · ${row.turnStateLen}字` : ''}`
                    : ticket === 'absent'
                      ? '无票'
                      : '票异常'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className='max-w-xs space-y-1 text-xs'>
                <div className='font-medium'>
                  {ticket === 'ok' ? '本次请求带回门票' : '本次请求没有门票'}
                </div>
                <div>
                  门票: {ticket === 'ok' ? '正常' : ticket === 'absent' ? '上游未铸票' : '信封异常'}
                  {row.turnStateBlocks ? ` · ${row.turnStateBlocks} 块` : ''}
                </div>
                <div className='text-primary-foreground/75'>
                  说明：有票只代表上游铸了票；是否「满血」要看两发探针
                  （裸打铸票 → 带票续接是否重铸），在「智能运营 → 门票」里测。
                </div>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {row.probeVerdict ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant='outline'
                  className={cn(
                    'shrink-0 cursor-help px-1 text-[10px] leading-tight',
                    row.probeVerdict === 'healthy' || row.probeVerdict === 'healthy_same'
                      ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300'
                      : row.probeVerdict === 'degraded' || row.probeVerdict === 'route_changed'
                        ? 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300'
                        : 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
                  )}
                >
                  {row.probeVerdict === 'healthy' || row.probeVerdict === 'healthy_same'
                    ? '满血'
                    : row.probeVerdict === 'degraded'
                      ? '降智'
                      : row.probeVerdict === 'route_changed'
                        ? '路由漂移'
                        : '无票'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className='max-w-xs space-y-1 text-xs'>
                <div className='font-medium'>账号档位（两发探针结论）</div>
                <div>最近探测: {row.probeAt ? String(row.probeAt).replace('T', ' ').slice(0, 19) : '—'}</div>
                <div className='text-primary-foreground/75'>
                  逐请求只能证明有没有票；满血/降智要带票续接一次才判得出来。
                </div>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {audit.secondaryActualModel ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant='outline'
                  className={cn(
                    'shrink-0 cursor-help px-1 text-[10px] leading-tight',
                    audit.downgraded
                      ? 'border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300'
                      : 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300'
                  )}
                >
                  {audit.downgraded ? '模型不一致' : '模型变体'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className='max-w-xs space-y-1 text-xs'>
                <div className='font-medium'>{audit.downgraded ? '上游降级' : '模型变体'}</div>
                <div>发往上游: {audit.sentUpstreamModel || '—'}</div>
                <div>上游返回: {audit.upstreamResponseModel || '—'}</div>
                <div className='text-primary-foreground/75'>
                  {audit.downgraded
                    ? '上游用别的模型回包，计费仍按发往上游的模型计算。'
                    : '仅名称变体（日期后缀等），视为同一模型。'}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {audit.effortDowngraded ? (
            <span className='shrink-0 text-[10px] leading-tight text-rose-600 dark:text-rose-400'>
              ↓ {row.reasoningEffort}→{audit.upstreamEffort}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 第三排：上游响应（有模型差异才显示） */}
      {audit.secondaryActualModel ? (
        <div className='flex min-w-0 items-center gap-1 truncate text-[10px] leading-tight text-muted-foreground'>
          <span className='shrink-0'>↳ 上游响应:</span>
          <span className='truncate font-medium'>{audit.upstreamResponseModel}</span>
        </div>
      ) : null}
    </div>
  )
}
