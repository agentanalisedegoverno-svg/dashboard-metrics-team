import { memo } from 'react'
import { fmtInt, fmtPct } from '@/lib/format'
import { cn } from '@/lib/utils'

export type BarItem = {
  label: string
  count: number
  pct: number | null
  color: string
  extra?: string
  /** valores do campo que abrem o drill-down ao clicar */
  drill?: string[]
}

function BarRow({ item, onDrill }: { item: BarItem; onDrill?: (it: BarItem) => void }) {
  const clickable = !!(item.drill && onDrill)
  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      title={clickable ? 'Clique para ver as oportunidades' : undefined}
      onClick={clickable ? () => onDrill!(item) : undefined}
      className={cn(
        'grid w-full grid-cols-[min(38%,220px)_1fr_auto] items-center gap-2.5 text-left text-[13px] max-[520px]:grid-cols-[minmax(0,34%)_1fr_auto] max-[520px]:gap-1.5 max-[520px]:text-xs',
        clickable && 'cursor-pointer rounded-md transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-gold',
      )}
    >
      <div className="truncate text-ink-soft" title={item.label}>
        <span className="mr-1.5 inline-block size-2.25 rounded-xs align-middle" style={{ background: item.color }} />
        {item.label}
      </div>
      <div className="relative h-3 overflow-hidden rounded-md bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 min-w-0.75 rounded-md transition-[width] duration-250"
          style={{ width: `${item.count > 0 ? Math.max(item.pct ?? 0, 1.2) : 0}%`, background: item.color }}
        />
      </div>
      <div className="min-w-16 text-right font-mono text-xs tabular-nums text-ink max-[520px]:min-w-0 max-[520px]:text-[11px]">
        {fmtInt(item.count)}
        {item.extra ? ` · ${item.extra}` : item.pct != null ? ` (${fmtPct(item.pct)})` : ''}
      </div>
    </Tag>
  )
}

export const BarList = memo(function BarList({ items, onDrill }: { items: BarItem[]; onDrill?: (it: BarItem) => void }) {
  return (
    <div className="mt-1.5 flex flex-col gap-2.5">
      {items.map((it) => (
        <BarRow key={it.label} item={it} onDrill={onDrill} />
      ))}
    </div>
  )
})
