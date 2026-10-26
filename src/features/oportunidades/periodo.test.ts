import { describe, expect, it } from 'vitest'
import { anosDisponiveis, mesesDoQuarter, noPeriodo, quarterDoMes } from './periodo'

const vazio = { ano: '', quarter: '', mes: '' }

describe('filtro de período (Ano > Quarter > Mês)', () => {
  it('Q1 = jan/fev/mar, Q2 = abr/mai/jun, Q3 = jul/ago/set, Q4 = out/nov/dez', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(quarterDoMes)).toEqual(['Q1', 'Q1', 'Q1', 'Q2', 'Q2', 'Q2', 'Q3', 'Q3', 'Q3', 'Q4', 'Q4', 'Q4'])
    expect(mesesDoQuarter('Q2')).toEqual([4, 5, 6])
    expect(mesesDoQuarter('Q4')).toEqual([10, 11, 12])
    expect(mesesDoQuarter('')).toHaveLength(12)
  })
  it('sem filtro, tudo passa (inclusive sem data); com filtro, sem data fica de fora', () => {
    expect(noPeriodo(null, vazio)).toBe(true)
    expect(noPeriodo(null, { ...vazio, ano: '2026' })).toBe(false)
  })
  it('combina ano, quarter e mês', () => {
    expect(noPeriodo('2026-03-31', { ano: '2026', quarter: 'Q1', mes: '' })).toBe(true)
    expect(noPeriodo('2026-04-01', { ano: '2026', quarter: 'Q1', mes: '' })).toBe(false)
    expect(noPeriodo('2025-02-10', { ano: '2026', quarter: 'Q1', mes: '' })).toBe(false)
    expect(noPeriodo('2026-05-10', { ano: '', quarter: 'Q2', mes: '5' })).toBe(true)
    expect(noPeriodo('2026-06-10', { ano: '', quarter: 'Q2', mes: '5' })).toBe(false)
    expect(noPeriodo('2024-12-31', { ...vazio, mes: '12' })).toBe(true)
  })
  it('lista os anos existentes, do mais recente ao mais antigo, sem repetir', () => {
    expect(anosDisponiveis(['2025-01-01', '2026-05-02', null, '2025-12-31', undefined])).toEqual(['2026', '2025'])
  })
})
