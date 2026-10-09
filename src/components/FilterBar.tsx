import { memo, useMemo } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { optionsFor, type Filters } from '@/domain/filters'
import { FILTER_DIMS, FILTER_LABELS, NV, type FilterDim, type Row } from '@/domain/types'
import { fmtInt, monthLabel } from '@/lib/format'
import { useFilters } from '@/store/filters'

const optLabel = (dim: FilterDim, v: string) => (dim === 'mes' ? monthLabel(v === NV ? null : v) : v)

const FilterGroup = memo(function FilterGroup({ dim, rows, filters }: { dim: FilterDim; rows: readonly Row[]; filters: Filters }) {
  const { toggle, setMany } = useFilters()
  const options = useMemo(() => optionsFor(dim, rows, filters), [dim, rows, filters])
  const selected = filters[dim]
  const selCount = options.filter((o) => selected.has(o.label)).length
  const all = options.length > 0 && selCount === options.length
  const state: boolean | 'indeterminate' = all ? true : selCount > 0 ? 'indeterminate' : false

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="filter" aria-label={`Filtrar por ${FILTER_LABELS[dim]}`}>
          {FILTER_LABELS[dim]}
          {selected.size > 0 && <span className="min-w-4 rounded-full bg-gold px-1.5 py-px text-center text-[10.5px] font-bold text-[#1a1204]">{selected.size}</span>}
          <ChevronDown className="size-3 text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-70 min-w-57.5 max-w-[80vw] overflow-y-auto p-2">
        {options.length > 0 && (
          <>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.25 text-[12.5px] font-semibold text-ink hover:bg-surface-2">
              <Checkbox
                checked={state}
                onCheckedChange={(c) => setMany(dim, options.map((o) => o.label), c === true, rows)}
              />
              <span>{all ? 'Desmarcar todos' : 'Selecionar todos'}</span>
            </label>
            <div className="mx-0.5 mb-1.5 mt-1 h-px bg-line" />
          </>
        )}
        {options.map((o) => (
          <label key={o.label} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.25 text-[12.5px] text-ink-soft hover:bg-surface-2">
            <Checkbox checked={selected.has(o.label)} onCheckedChange={() => toggle(dim, o.label, rows)} />
            <span>{optLabel(dim, o.label)}</span>
            <span className="ml-auto font-mono text-[11px] text-muted">{o.count}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
})

export function FilterBar({ rows, filters, matched }: { rows: readonly Row[]; filters: Filters; matched: number }) {
  const { toggle, clear } = useFilters()
  const noYear = filters.ano.size === 0
  const chips = FILTER_DIMS.flatMap((dim) => [...filters[dim]].map((v) => ({ dim, v })))
  return (
    <div className="relative z-5 mt-4.5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card max-[520px]:p-2.5">
      <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Filtrar por</span>
      {FILTER_DIMS.map((dim) => (
        <FilterGroup key={dim} dim={dim} rows={rows} filters={filters} />
      ))}
      <Button variant="dashed" onClick={clear}>Limpar filtros</Button>
      <div className="ml-auto text-[12.5px] font-medium text-ink-soft" aria-live="polite">
        {noYear ? (
          <><strong className="font-mono text-brand-ink">Selecione um Ano</strong> para carregar os dados</>
        ) : (
          <><strong className="font-mono text-brand-ink">{fmtInt(matched)}</strong> oportunidade{matched === 1 ? '' : 's'} no filtro</>
        )}
      </div>
      {chips.length > 0 && (
        <div className="mt-0.5 flex w-full flex-wrap gap-1.5">
          {chips.map(({ dim, v }) => (
            <span key={`${dim}:${v}`} className="inline-flex items-center gap-1.25 rounded-full bg-gold-soft py-[3px] pl-2.5 pr-2.25 text-[11.5px] font-semibold text-gold">
              {FILTER_LABELS[dim]}: {optLabel(dim, v)}
              <button type="button" aria-label={`Remover filtro ${FILTER_LABELS[dim]} ${optLabel(dim, v)}`} className="cursor-pointer leading-none" onClick={() => toggle(dim, v, rows)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
