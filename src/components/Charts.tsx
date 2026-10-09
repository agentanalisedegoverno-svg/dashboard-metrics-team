import { memo } from 'react'
import { fmtInt, fmtPct } from '@/lib/format'
import { DonutTitle, EmptyNote } from './Primitives'

export type Segment = { label: string; count: number; color: string }

export const StackBar = memo(function StackBar({ segments, total, showPct = true }: { segments: Segment[]; total: number; showPct?: boolean }) {
  return (
    <>
      <div className="flex h-6.5 gap-0.5 overflow-hidden rounded-[7px] bg-surface-2">
        {segments.map((s) => (
          <span
            key={s.label}
            className="h-full transition-[width] duration-250"
            style={{ width: `${total ? (s.count / total) * 100 : 0}%`, background: s.color }}
            title={`${s.label}: ${s.count}${showPct ? ` (${fmtPct(total ? (s.count / total) * 100 : 0)})` : ''}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4 text-[12.5px] text-ink-soft">
        {segments.map((s) => (
          <span key={s.label}>
            <span className="mr-1.5 inline-block size-2.25 rounded-xs align-middle" style={{ background: s.color }} />
            {s.label} — {s.count}
            {showPct ? ` (${fmtPct(total ? (s.count / total) * 100 : 0)})` : ''}
          </span>
        ))}
      </div>
    </>
  )
})

const SIZE = 132
const STROKE = 20

export const Donut = memo(function Donut({ segments, emptyText }: { segments: Segment[]; emptyText?: string }) {
  const total = segments.reduce((a, s) => a + s.count, 0)
  if (total === 0) return <EmptyNote>{emptyText ?? 'Nenhuma oportunidade no recorte selecionado.'}</EmptyNote>
  const r = (SIZE - STROKE) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  const visible = segments.filter((s) => s.count > 0)
  return (
    <div className="flex flex-wrap items-center gap-5.5">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Gráfico de pizza" className="shrink-0">
        {visible.map((s) => {
          const frac = s.count / total
          const dash = frac * c
          const el = (
            <circle
              key={s.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            >
              <title>{`${s.label}: ${s.count} (${fmtPct(frac * 100)})`}</title>
            </circle>
          )
          offset += dash
          return el
        })}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={r - STROKE / 2 - 3} fill="var(--surface)" />
        <text x={SIZE / 2} y={SIZE / 2 - 3} textAnchor="middle" fontFamily="Fraunces Variable, Georgia, serif" fontSize="20" fontWeight="600" fill="var(--brand-ink)">{fmtInt(total)}</text>
        <text x={SIZE / 2} y={SIZE / 2 + 14} textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif" fontSize="10" fill="var(--muted)">total</text>
      </svg>
      <div className="flex min-w-40 flex-col gap-1.75">
        {visible.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            <span className="inline-block size-2.25 rounded-xs" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="whitespace-nowrap font-mono text-xs text-ink">
              {s.count} · <b className="text-brand-ink">{fmtPct((s.count / total) * 100)}</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
})

export function DonutCard({ title, segments }: { title: string; segments: Segment[] }) {
  return (
    <>
      <DonutTitle>{title}</DonutTitle>
      <Donut segments={segments} />
    </>
  )
}
