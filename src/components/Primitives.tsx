import { memo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type TagKind = 'confirmado' | 'inferido' | 'lacuna' | 'premissa' | 'recomendacao'
const TAG: Record<TagKind, string> = {
  confirmado: 'bg-[color-mix(in_srgb,var(--st-good)_14%,transparent)] text-[color-mix(in_srgb,var(--st-good)_55%,var(--ink))]',
  inferido: 'bg-[color-mix(in_srgb,var(--series-blue)_14%,transparent)] text-[color-mix(in_srgb,var(--series-blue)_55%,var(--ink))]',
  lacuna: 'bg-[color-mix(in_srgb,var(--st-critical)_12%,transparent)] text-[color-mix(in_srgb,var(--st-critical)_55%,var(--ink))]',
  premissa: 'bg-[color-mix(in_srgb,var(--gold)_16%,transparent)] text-[color-mix(in_srgb,var(--gold)_55%,var(--ink))]',
  recomendacao: 'bg-[color-mix(in_srgb,var(--series-violet)_14%,transparent)] text-[color-mix(in_srgb,var(--series-violet)_55%,var(--ink))]',
}
const TAG_LABEL: Record<TagKind, string> = {
  confirmado: 'Confirmado', inferido: 'Inferido', lacuna: 'Lacuna', premissa: 'Premissa', recomendacao: 'Recomendação',
}

export const Tag = memo(function Tag({ kind, className }: { kind: TagKind; className?: string }) {
  return <span className={cn('inline-block rounded-full px-1.75 py-0.5 text-[10.5px] font-semibold', TAG[kind], className)}>{TAG_LABEL[kind]}</span>
})

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[14px] border border-line bg-surface p-5.5 shadow-card max-sm:p-4', className)} {...props} />
}

export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8.5 max-sm:mb-6.5">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl">{title}</h2>
        {note && <div className="max-w-[60ch] text-[12.5px] text-muted">{note}</div>}
      </div>
      {children}
    </section>
  )
}

export function NoteBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-3.5 flex gap-2.5 rounded-[10px] border border-[color-mix(in_srgb,var(--gold)_35%,transparent)] bg-gold-soft px-3.5 py-3 text-[12.5px] leading-normal text-ink-soft [&_b]:text-ink', className)}>
      <div>{children}</div>
    </div>
  )
}

export const EmptyNote = ({ children }: { children: ReactNode }) => (
  <div className="px-1 py-4.5 text-center text-[13px] text-muted">{children}</div>
)

export const DonutTitle = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('mb-2.5 text-[12.5px] font-semibold text-muted', className)}>{children}</div>
)

export const KpiGrid = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-3 max-[520px]:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] max-[520px]:gap-2', className)}>{children}</div>
)
