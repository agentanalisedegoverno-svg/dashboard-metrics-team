import { describe, expect, it } from 'vitest'
import { mapPlanilha } from './planilha'

const H = ['Data de distribuição(envio edital)', 'Status', 'Data Pregão', 'Instituição / Órgão', 'Processo', 'Torre', 'Orçamento', 'Valor Vencedor', 'Posição pós lance CTC', 'Motivo de NO GO', 'Detalhe do NO GO', 'Pré-Vendas', 'Site', 'MC CTC']

describe('mapPlanilha', () => {
  it('normaliza sigiloso, texto monetário, posição e motivo longo', () => {
    const { rows, resumo } = mapPlanilha([
      H,
      ['2025-01-10', 'No Go', '2025-01-20', 'SEDES', '12/2025', 'Nuvem', 'Sigiloso', 'R$ 1.000,50', '19ª posição', 'x'.repeat(80), null, 'a@b.com', 'ComprasNet', 15],
      ['2025-01-10', 'Win', '2025-01-20', 'SEDES', '13/2025', 'Nuvem', 100, null, 'Desclassificada', 'Validar', null, null, 'comprasnet', 0.2],
    ])
    expect(rows[0]).toMatchObject({ orcamento: null, orcamento_sigiloso: true, valor_vencedor: 1000.5, posicao_lance: 19, motivo_no_go: 'Outros', mc_ctc: 0.15 })
    expect(rows[0].detalhe_no_go).toHaveLength(80)
    expect(rows[1]).toMatchObject({ situacao_lance: 'Desclassificada', motivo_no_go: null, site: 'comprasnet' === rows[1].site ? 'comprasnet' : 'ComprasNet' })
    expect(rows[1].pendencias).toContain('motivo_no_go')
    expect(resumo.orcamento_sigiloso).toBe(1)
  })
  it('gera chaves estáveis e distintas para duplicatas', () => {
    const l = ['2025-01-10', 'Win', '2025-01-20', 'SEDES', '12/2025', 'Nuvem']
    const { rows, avisos } = mapPlanilha([H, l, l])
    expect(rows[0].chave_planilha).not.toBe(rows[1].chave_planilha)
    expect(avisos.some((a) => a.regra === 'possivel_duplicata')).toBe(true)
  })
  it('acusa regras violadas sem corrigir', () => {
    const { avisos } = mapPlanilha([H, ['2025-02-10', 'Lost', '2025-01-20', 'X', '1', 'T']])
    const regras = avisos.map((a) => a.regra)
    expect(regras).toEqual(expect.arrayContaining(['pregao_antes_da_distribuicao', 'lost_sem_motivo', 'sem_pre_vendas']))
  })
})
