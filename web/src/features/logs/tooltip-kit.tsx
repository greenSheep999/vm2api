import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 日志页 tooltip 的统一构件。
 *
 * 之前 Tokens / 缓存 / 性能 三个 tooltip 各写一套 `space-y-1` + 纯 div，
 * 行距、对齐、字号都不一致，读起来散。这里收敛成同一种「左标签 / 右等宽值」，
 * 分组用 TipSection、分界用 TipDivider。
 */
export function TipKV({
  label,
  value,
  tone,
  mono = true,
}: {
  label: ReactNode
  value: ReactNode
  tone?: string
  mono?: boolean
}) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <span className='shrink-0 text-[11px] text-primary-foreground/70'>
        {label}
      </span>
      <span
        className={cn(
          'text-right text-[11px] tabular-nums',
          mono && 'font-mono',
          tone,
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function TipSection({ children }: { children: ReactNode }) {
  return (
    <div className='pt-1.5 text-[11px] font-semibold text-primary-foreground/90 first:pt-0'>
      {children}
    </div>
  )
}

export function TipDivider() {
  return <div className='border-t border-primary-foreground/20' />
}

export function TipNote({ children }: { children: ReactNode }) {
  return (
    <div className='text-[11px] leading-snug text-primary-foreground/60'>
      {children}
    </div>
  )
}
