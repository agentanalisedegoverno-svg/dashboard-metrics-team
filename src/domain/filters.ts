import { NV, type FilterDim, type Row } from './types'

export type Filters = Record<FilterDim, ReadonlySet<string>>

export const emptyFilters = (): Filters => ({
  ano: new Set(),
  mes: new Set(),
  linhaServico: new Set(),
  torre: new Set(),
  status: new Set(),
})

/**
 * Ano é obrigatório: sem Ano selecionado nada é exibido (evita agregados
 * "de todos os anos" que ninguém pediu). Todas as datas derivam de Data Pregão.
 */
export function passesFilters(row: Row, f: Filters): boolean {
  if (!f.ano.size) return false
  if (!f.ano.has(row.ano || NV)) return false
  if (f.mes.size && !f.mes.has(row.mes || NV)) return false
  if (f.linhaServico.size && !f.linhaServico.has(row.linhaServico || NV)) return false
  if (f.torre.size && !f.torre.has(row.torre || NV)) return false
  if (f.status.size && !f.status.has(row.status || NV)) return false
  return true
}

export type Count = { label: string; count: number }

export function groupCount(rows: readonly Row[], field: keyof Row): Count[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = (r[field] as string | null | undefined) || NV
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

/** Mês é filho de Ano: só lista meses dos anos selecionados. */
export function baseRowsFor(dim: FilterDim, rows: readonly Row[], f: Filters): readonly Row[] {
  if (dim === 'mes' && f.ano.size) return rows.filter((r) => f.ano.has(r.ano || NV))
  return rows
}

/** Opções ordenadas de uma dimensão (ano desc, mês asc, demais por volume). */
export function optionsFor(dim: FilterDim, rows: readonly Row[], f: Filters): Count[] {
  const counts = groupCount(baseRowsFor(dim, rows, f), dim)
  if (dim === 'mes')
    return counts.slice().sort((a, b) => (a.label === NV ? 1 : b.label === NV ? -1 : a.label.localeCompare(b.label)))
  if (dim === 'ano')
    return counts.slice().sort((a, b) => (a.label === NV ? 1 : b.label === NV ? -1 : b.label.localeCompare(a.label)))
  return counts
}

/** Remove meses que não pertencem mais aos anos selecionados. */
export function pruneMonths(rows: readonly Row[], f: Filters): ReadonlySet<string> {
  const valid = new Set(groupCount(baseRowsFor('mes', rows, f), 'mes').map((c) => c.label))
  return new Set([...f.mes].filter((m) => valid.has(m)))
}
