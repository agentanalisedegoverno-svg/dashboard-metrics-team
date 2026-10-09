import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyFilters, passesFilters, pruneMonths, optionsFor, type Filters } from './filters'
import { computeMaturity } from './maturity'
import { computeMetrics } from './metrics'
import { DatasetSchema, NV, type Row } from './types'

const DATA = new URL('../../public/data.json', import.meta.url)
const LEGACY = new URL('../../../radar-pre-vendas.html', import.meta.url)
const hasData = existsSync(DATA)
const rows: Row[] = hasData
  ? DatasetSchema.parse(JSON.parse(readFileSync(DATA, 'utf8')))
  : [
      { ano: '2026', mes: '2026-01', torre: 'ITS' },
      { ano: '2025', mes: '2025-06', torre: 'CCO' },
    ]

const f = (p: Partial<Record<keyof Filters, string[]>>): Filters => {
  const base = emptyFilters()
  return Object.fromEntries(Object.entries(base).map(([k]) => [k, new Set(p[k as keyof Filters] ?? [])])) as unknown as Filters
}

describe('regras de filtro', () => {
  it('sem Ano selecionado nada é exibido', () => {
    expect(rows.filter((r) => passesFilters(r, emptyFilters()))).toHaveLength(0)
    expect(rows.filter((r) => passesFilters(r, f({ torre: ['ITS'] })))).toHaveLength(0)
  })
  it('Ano + Mês restringem; mês de outro ano é descartado ao trocar o Ano', () => {
    const y26 = f({ ano: ['2026'] })
    const only26 = rows.filter((r) => passesFilters(r, y26))
    expect(only26.length).toBeGreaterThan(0)
    expect(only26.every((r) => r.ano === '2026')).toBe(true)
    const withMonth = f({ ano: ['2026'], mes: ['2025-01'] })
    expect([...pruneMonths(rows, withMonth)]).toEqual([])
  })
  it('opções de Mês respeitam o Ano (cascata) e Ano vem em ordem decrescente', () => {
    const months = optionsFor('mes', rows, f({ ano: ['2026'] }))
    expect(months.every((o) => o.label === NV || o.label.startsWith('2026'))).toBe(true)
    const anos = optionsFor('ano', rows, emptyFilters()).map((o) => o.label)
    expect(anos[0]).toBe('2026')
  })
})

if (hasData && existsSync(LEGACY)) {
  describe('paridade com o painel HTML atual', () => {
    const html = readFileSync(LEGACY, 'utf8')
    const start = html.indexOf('function groupCount')
    const end = html.indexOf('const PLANO')
    const legacyCode = html.slice(start, end)
    const NVc = NV
    // eslint-disable-next-line no-new-func
    const legacy = new Function('NV', 'pct', `${legacyCode}; return { computeMetrics, computeMaturity };`)(NVc, (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)

    const cases: [string, Filters][] = [
      ['2026', f({ ano: ['2026'] })],
      ['2025', f({ ano: ['2025'] })],
      ['2025+2026', f({ ano: ['2025', '2026'] })],
      ['2025 ITS', f({ ano: ['2025'], torre: ['ITS'] })],
      ['2026 No Go', f({ ano: ['2026'], status: ['No Go'] })],
    ]

    it.each(cases)('computeMetrics idêntico — %s', (_n, filt) => {
      const sel = rows.filter((r) => passesFilters(r, filt))
      const a = JSON.parse(JSON.stringify(computeMetrics(sel)))
      const b = JSON.parse(JSON.stringify(legacy.computeMetrics(sel)))
      delete b.sla
      expect(a).toEqual(b)
    })

    it('computeMaturity idêntico (base completa)', () => {
      expect(JSON.parse(JSON.stringify(computeMaturity(rows)))).toEqual(JSON.parse(JSON.stringify(legacy.computeMaturity(rows))))
    })
  })
}
