import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyFilters, groupCount, passesFilters, type Filters } from './filters'
import { computeMaturity } from './maturity'
import { computeMetrics, sumField } from './metrics'
import { DatasetSchema, NV, type Row } from './types'

const rows: Row[] = DatasetSchema.parse(JSON.parse(readFileSync(new URL('../../public/data.json', import.meta.url), 'utf8')))
const byYear = (ano: string): Filters => ({ ...emptyFilters(), ano: new Set([ano]) })

// Teste de caracterização: congela os números atuais (base sintética) para que
// qualquer mudança nas regras de negócio apareça como diff explícito no PR.
describe('métricas — snapshot da base sintética', () => {
  it.each(['2025', '2026'])('computeMetrics %s', (ano) => {
    expect(computeMetrics(rows.filter((r) => passesFilters(r, byYear(ano))))).toMatchSnapshot()
  })
  it('computeMaturity (base completa)', () => {
    expect(computeMaturity(rows)).toMatchSnapshot()
  })
})

describe('métricas — invariantes', () => {
  const sel = rows.filter((r) => passesFilters(r, byYear('2026')))
  const m = computeMetrics(sel)

  it('status soma o total e percentuais fecham em 100', () => {
    expect(m.status.reduce((a, s) => a + s.count, 0)).toBe(m.total)
    expect(m.status.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100, 6)
  })
  it('motivos de No Go (top 9 + outros) somam o total de No Go', () => {
    expect(m.nogoMotivos.reduce((a, x) => a + x.count, 0)).toBe(m.nogoRows.length)
    expect(m.nogoMotivos.length).toBeLessThanOrEqual(10)
  })
  it('win rate = Win / (Win + Lost) e nulo quando não há fechados', () => {
    expect(computeMetrics([]).winRate).toBeNull()
    const mk = (status: string): Row => ({ status })
    expect(computeMetrics([mk('Win'), mk('Win'), mk('Win'), mk('Lost')]).winRate).toBe(75)
  })
  it('sumField ignora zero, negativo e vazio', () => {
    expect(sumField([{ orcamento: 10 }, { orcamento: 0 }, { orcamento: -5 }, { orcamento: null }, {}], 'orcamento')).toEqual({ sum: 10, count: 1 })
  })
  it('groupCount usa "Sem informação" para vazios e ordena por volume', () => {
    const g = groupCount([{ torre: 'A' }, { torre: null }, { torre: 'A' }, {}], 'torre')
    expect(g).toEqual([{ label: 'A', count: 2 }, { label: NV, count: 2 }])
  })
})

describe('maturidade', () => {
  it('base vazia não gera avaliação', () => expect(computeMaturity([])).toEqual([]))
  it('níveis ficam entre 1 e 4', () => {
    for (const i of computeMaturity(rows)) expect(i.level).toBeGreaterThanOrEqual(1), expect(i.level).toBeLessThanOrEqual(4)
  })
})
