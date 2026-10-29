import { describe, expect, it } from 'vitest'
import type { Oportunidade } from '@/domain/oportunidade'
import { celula, COLUNAS, csvDeOportunidades, nomeArquivoCsv, textoSeguro } from './exportarCsv'

const o = (extra: Record<string, unknown> = {}) =>
  ({
    id: 1,
    codigo: '2026-0001',
    versao: 1,
    status: 'Go',
    orgao: 'Prefeitura de "Teste"; SP',
    descritivo: 'Link dedicado',
    torre: 'ITS',
    data_pregao_dt: '2026-11-05',
    hora_pregao: '15:30:00',
    orcamento: 1234.5,
    orcamento_sigiloso: false,
    mc_ctc: 0.185,
    impostos: 0.0865,
    duracao_contrato_meses: 24,
    empresa_vencedora_cnpj: '12345678000199',
    pendencias: ['site', 'uf'],
    criado_por: 'joao@ctctech.com.br',
    atualizado_em: '2026-10-14T12:00:00Z',
    ...extra,
  }) as unknown as Oportunidade

const linhas = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)
const colunaDe = (csv: string, titulo: string, i = 1) => {
  const idx = COLUNAS.findIndex((c) => c.titulo === titulo)
  expect(idx, titulo).toBeGreaterThanOrEqual(0)
  // separa respeitando aspas
  const partes = linhas(csv)[i].match(/("([^"]|"")*"|[^;]*)(;|$)/g)!.map((p) => p.replace(/;$/, ''))
  return partes[idx]
}

describe('CSV das oportunidades (abre direto no Excel em português)', () => {
  it('começa com BOM UTF-8, usa ; e CRLF, e tem uma linha por oportunidade mais o cabeçalho', () => {
    const csv = csvDeOportunidades([o(), o({ codigo: '2026-0002' })])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    const l = linhas(csv)
    expect(l).toHaveLength(3)
    expect(l[0].split(';')[0]).toBe('Código')
    expect(l[0]).toContain('Instituição / Órgão')
    expect(csvDeOportunidades([])).toBe('\uFEFF' + COLUNAS.map((c) => celula(c.titulo)).join(';') + '\r\n')
  })
  it('formata no padrão brasileiro: data, hora, reais com vírgula, percentual, inteiro, CNPJ e Sim/Não', () => {
    const csv = csvDeOportunidades([o()])
    expect(colunaDe(csv, 'Código')).toBe('2026-0001')
    expect(colunaDe(csv, 'Data do pregão')).toBe('05/11/2026')
    expect(colunaDe(csv, 'Hora do pregão')).toBe('15:30')
    expect(colunaDe(csv, 'Orçamento (R$)')).toBe('1234,50')
    expect(colunaDe(csv, 'MC CTC (%)')).toBe('18,5')
    expect(colunaDe(csv, 'Impostos (%)')).toBe('8,65')
    expect(colunaDe(csv, 'Duração do contrato (meses)')).toBe('24')
    expect(colunaDe(csv, 'Empresa vencedora (CNPJ)')).toBe('12.345.678/0001-99')
    expect(colunaDe(csv, 'Pendências')).toBe('site, uf')
    expect(colunaDe(csv, 'Atualizada em')).toBe('14/10/2026')
    expect(colunaDe(csv, 'Arquivada')).toBe('Não')
  })
  it('orçamento sigiloso nunca mostra valor', () => {
    expect(colunaDe(csvDeOportunidades([o({ orcamento_sigiloso: true, orcamento: null })]), 'Orçamento (R$)')).toBe('Sigiloso')
  })
  it('aspas, ponto e vírgula e quebras de linha não quebram as colunas', () => {
    const csv = csvDeOportunidades([o({ objeto: 'linha 1\nlinha 2' })])
    expect(colunaDe(csv, 'Instituição / Órgão')).toBe('"Prefeitura de ""Teste""; SP"')
    expect(colunaDe(csv, 'Objeto')).toBe('linha 1 linha 2')
    expect(linhas(csv)).toHaveLength(2)
  })
  it('texto que o Excel leria como fórmula ganha apóstrofo (campos digitados ou vindos da API)', () => {
    for (const perigoso of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) expect(textoSeguro(perigoso)).toBe(`'${perigoso}`)
    expect(textoSeguro('Normal -'), 'só o início importa').toBe('Normal -')
    const csv = csvDeOportunidades([o({ orgao: '=cmd|"/c calc"!A0', descritivo: '@alvo', criado_por: '+55', solicitante: '-x' })])
    expect(colunaDe(csv, 'Instituição / Órgão')).toBe(`"'=cmd|""/c calc""!A0"`)
    expect(colunaDe(csv, 'Descritivo')).toBe("'@alvo")
    expect(colunaDe(csv, 'Cadastrada por')).toBe("'+55")
    expect(colunaDe(csv, 'Solicitante (via API)')).toBe("'-x")
  })
  it('nome do arquivo leva a data', () => {
    expect(nomeArquivoCsv()).toMatch(/^oportunidades-\d{4}-\d{2}-\d{2}\.csv$/)
  })
})
