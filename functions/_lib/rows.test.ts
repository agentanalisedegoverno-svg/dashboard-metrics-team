import { describe, expect, it } from 'vitest'
import { mapRows, parseDate, parseMoney } from './rows'

const header = ['Status', 'Data Pregão', 'Instituição / Órgão', 'UF', 'Linha de Serviço', 'Torre', 'Pré-Vendas', 'Orçamento', 'Valor CTC', 'Motivo de NO GO', 'Ação IA']

describe('parseMoney', () => {
  it.each([
    [1200000, 1200000],
    [' R$ 2,712,939.02 ', 2712939.02],
    ['R$ 1.356.575,76', 1356575.76],
    ['1.234', 1.234],
    ['', null],
    [null, null],
    ['n/a', null],
  ])('%j -> %j', (input, out) => expect(parseMoney(input as never)).toBe(out))
})

describe('parseDate', () => {
  it('lê serial do Excel, dd/mm/aaaa e ISO', () => {
    expect(parseDate(45672)).toEqual({ y: 2025, m: 1, d: 15 })
    expect(parseDate('15/01/2025')).toEqual({ y: 2025, m: 1, d: 15 })
    expect(parseDate('2025-01-15T00:00:00')).toEqual({ y: 2025, m: 1, d: 15 })
  })
  it('rejeita lixo e mês inválido', () => {
    expect(parseDate('31/13/2025')).toBeNull()
    expect(parseDate('abc')).toBeNull()
    expect(parseDate(null)).toBeNull()
  })
})

describe('mapRows', () => {
  it('mapeia cabeçalhos com acento/caixa diferentes e deriva Ano/Mês de Data Pregão', () => {
    const [r] = mapRows([header, ['No Go', 45672, 'SEDES', 'DF', 'Service Desk', 'ITSM', 'Rodrigo A ', 'R$ 10,00', null, 'Indices financeiros', null]])
    expect(r).toMatchObject({
      ano: '2025', mes: '2025-01', dataPregao: '15/01/2025', status: 'No Go', orgao: 'SEDES', uf: 'DF',
      linhaServico: 'Service Desk', torre: 'ITSM', analista: 'Rodrigo A', orcamento: 10, valorCtc: null,
      motivoNoGo: 'Indices financeiros', sla: null, acaoIA: null,
    })
  })
  it('ignora linhas totalmente vazias e mantém linha sem data com ano/mês nulos', () => {
    const rows = mapRows([header, [null, null, null], ['Win', 'sem data']])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ano: null, mes: null, status: 'Win' })
  })
  it('falha de forma explícita quando o cabeçalho muda', () => {
    expect(() => mapRows([['Foo', 'Bar'], ['1', '2']])).toThrow(/Cabeçalho inesperado/)
  })
  it('planilha só com cabeçalho devolve lista vazia', () => expect(mapRows([header])).toEqual([]))
})
