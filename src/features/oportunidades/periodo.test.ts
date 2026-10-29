import { describe, expect, it } from 'vitest'
import { anosDisponiveis, intervaloInvertido, mesDe, mesesDoQuarter, noPeriodo, quarterDoMes, semanaDe } from './periodo'

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
  it('semana vai de segunda a domingo (inclusive quando o dia é domingo ou vira o mês/ano)', () => {
    expect(semanaDe(new Date(2026, 9, 29))).toEqual({ de: '2026-10-26', ate: '2026-11-01' }) // quinta
    expect(semanaDe(new Date(2026, 10, 1))).toEqual({ de: '2026-10-26', ate: '2026-11-01' }) // domingo
    expect(semanaDe(new Date(2026, 9, 26))).toEqual({ de: '2026-10-26', ate: '2026-11-01' }) // segunda
    expect(semanaDe(new Date(2026, 9, 29), 1)).toEqual({ de: '2026-11-02', ate: '2026-11-08' })
    expect(semanaDe(new Date(2026, 11, 31), 0)).toEqual({ de: '2026-12-28', ate: '2027-01-03' })
  })
  it('mês vai do primeiro ao último dia (fevereiro bissexto e dezembro)', () => {
    expect(mesDe(new Date(2026, 9, 29))).toEqual({ de: '2026-10-01', ate: '2026-10-31' })
    expect(mesDe(new Date(2028, 1, 10))).toEqual({ de: '2028-02-01', ate: '2028-02-29' })
    expect(mesDe(new Date(2026, 11, 5))).toEqual({ de: '2026-12-01', ate: '2026-12-31' })
  })
  it('intervalo é inclusivo nas duas pontas, aceita só um lado e combina com ano/quarter/mês', () => {
    const r = { ...vazio, de: '2026-10-26', ate: '2026-11-01' }
    expect(noPeriodo('2026-10-26', r)).toBe(true)
    expect(noPeriodo('2026-11-01', r)).toBe(true)
    expect(noPeriodo('2026-10-25', r)).toBe(false)
    expect(noPeriodo('2026-11-02', r)).toBe(false)
    expect(noPeriodo('2026-10-28T09:30:00', r)).toBe(true)
    expect(noPeriodo(null, r)).toBe(false)
    expect(noPeriodo('2026-01-01', { ...vazio, de: '2026-06-01' })).toBe(false)
    expect(noPeriodo('2030-01-01', { ...vazio, de: '2026-06-01' })).toBe(true)
    expect(noPeriodo('2026-01-01', { ...vazio, ate: '2026-06-01' })).toBe(true)
    expect(noPeriodo('2026-10-28', { ...r, mes: '11' })).toBe(false)
  })
  it('data digitada incompleta ou estranha é ignorada (não filtra nada)', () => {
    expect(noPeriodo('2026-10-28', { ...vazio, de: '2026-1', ate: "x'; drop" })).toBe(true)
    expect(intervaloInvertido({ de: '2026-11-02', ate: '2026-11-01' })).toBe(true)
    expect(intervaloInvertido({ de: '2026-11-01', ate: '2026-11-01' })).toBe(false)
    expect(intervaloInvertido({ de: '2026-11-01', ate: '' })).toBe(false)
  })
})
