import { create } from 'zustand'
import { emptyFilters, pruneMonths, type Filters } from '@/domain/filters'
import type { FilterDim, Row } from '@/domain/types'

type State = {
  filters: Filters
  toggle: (dim: FilterDim, value: string, rows: readonly Row[]) => void
  setMany: (dim: FilterDim, values: string[], on: boolean, rows: readonly Row[]) => void
  clear: () => void
}

const withDim = (f: Filters, dim: FilterDim, next: ReadonlySet<string>, rows: readonly Row[]): Filters => {
  const out: Filters = { ...f, [dim]: next }
  // Ano mudou: descarta meses que não pertencem mais aos anos escolhidos.
  if (dim === 'ano') out.mes = pruneMonths(rows, out)
  return out
}

export const useFilters = create<State>((set) => ({
  filters: emptyFilters(),
  toggle: (dim, value, rows) =>
    set(({ filters }) => {
      const next = new Set(filters[dim])
      if (!next.delete(value)) next.add(value)
      return { filters: withDim(filters, dim, next, rows) }
    }),
  setMany: (dim, values, on, rows) =>
    set(({ filters }) => {
      const next = new Set(filters[dim])
      for (const v of values) (on ? next.add(v) : next.delete(v))
      return { filters: withDim(filters, dim, next, rows) }
    }),
  clear: () => set({ filters: emptyFilters() }),
}))
