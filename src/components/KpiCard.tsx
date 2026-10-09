import { memo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { InfoTip } from './InfoTip'
import { Tag, type TagKind } from './Primitives'

type Props = {
  label: string
  value: ReactNode
  sub?: ReactNode
  tag?: TagKind
  info?: ReactNode
  /** Se informado, o card vira clicável (drill-down). */
  onClick?: () => void
  flat?: boolean
}

export const KpiCard = memo(function KpiCard({ label, value, sub, tag, info, onClick, flat }: Props) {
  const clickable = !!onClick
  return (
    <div
      className={cn(
        'relative min-w-0 rounded-xl border border-line bg-surface p-4 pb-3.5 max-[520px]:p-3 max-[520px]:pb-2.5',
        !flat && 'shadow-card',
        clickable && 'transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_2px_6px_rgba(15,20,35,.08),0_12px_28px_-14px_rgba(15,20,35,.22)] active:translate-y-0',
      )}
    >
      {/* Botão sobreposto (stretched button): o card inteiro é clicável sem aninhar controles interativos. */}
      {clickable && (
        <button
          type="button"
          onClick={onClick}
          aria-label={`${label}: ver oportunidades`}
          title="Clique para ver as oportunidades"
          className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-gold"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 wrap-break-word text-[11px] font-semibold uppercase tracking-[.05em] text-muted">{label}</div>
        {info && <div className="relative z-1"><InfoTip>{info}</InfoTip></div>}
      </div>
      <div className="mt-1.5 font-serif text-[clamp(22px,5vw,28px)] font-semibold leading-[1.1] tabular-nums text-brand-ink max-[520px]:text-[clamp(19px,7vw,24px)]">{value}</div>
      {sub && <div className="mt-1 text-xs leading-[1.4] text-ink-soft">{sub}</div>}
      {tag && <Tag kind={tag} className="mt-2" />}
    </div>
  )
})
