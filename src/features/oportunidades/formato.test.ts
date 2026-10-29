import { describe, expect, it } from 'vitest'
import { regrasNegocio, type OportunidadeInput } from '@/domain/oportunidade'
import { deForm, mascaraReal, paraForm, pct, pregaoBr } from './formato'

const base = paraForm({ status: 'Go', orgao: 'SEDES', descritivo: 'Link', torre: 'ITS', data_pregao_dt: '2026-03-10' })

describe('formulário <-> API', () => {
  it('mostra margem em % e valores com vírgula, e devolve em fração/número', () => {
    const f = paraForm({ mc_ctc: 0.185, orcamento: 1234.5, posicao_lance: 3, data_pregao_dt: '2026-03-10' })
    expect(f).toMatchObject({ mc_ctc: '18,5', orcamento: 'R$ 1.234,50', posicao_lance: '3', data_pregao_dt: '2026-03-10', status: '' })
    const r = deForm({ ...base, mc_ctc: '18,5', orcamento: '1.234,50', posicao_lance: '3' })
    expect(r.success && r.data).toMatchObject({ mc_ctc: 0.185, orcamento: 1234.5, posicao_lance: 3, status: 'Go' })
  })
  it('valores em reais: máscara na digitação, "R$ 1.234,50" volta a número', () => {
    expect(mascaraReal('123456')).toBe('R$ 1.234,56')
    expect(mascaraReal('R$ 1.234,56' + '7')).toBe('R$ 12.345,67')
    expect(mascaraReal('5')).toBe('R$ 0,05')
    expect(mascaraReal('abc')).toBe('')
    expect(mascaraReal('')).toBe('')
    const r = deForm({ ...base, orcamento: 'R$ 1.234.567,89', valor_ctc: 'R$ 0,50', custo_total_ctc: '2.000,00', valor_vencedor: '' })
    expect(r.success && r.data).toMatchObject({ orcamento: 1234567.89, valor_ctc: 0.5, custo_total_ctc: 2000, valor_vencedor: null })
  })
  it('pasta de documentação: link só https (sem espaços), nome opcional, mas nome sem link é recusado', () => {
    const url = 'https://ctctech-my.sharepoint.com/:f:/g/personal/x/EsXPTO'
    expect(paraForm({ documentos_nome: 'Pasta XPTO', documentos_url: url })).toMatchObject({ documentos_nome: 'Pasta XPTO', documentos_url: url })
    const ok = deForm({ ...base, documentos_nome: 'Pasta XPTO', documentos_url: `  ${url}  ` })
    expect(ok.success && ok.data).toMatchObject({ documentos_nome: 'Pasta XPTO', documentos_url: url })
    const vazio = deForm({ ...base, documentos_nome: '', documentos_url: '' })
    expect(vazio.success && [vazio.data.documentos_nome, vazio.data.documentos_url]).toEqual([null, null])
    const soLink = deForm({ ...base, documentos_url: url })
    expect(soLink.success && soLink.data.documentos_nome).toBeNull()
    for (const ruim of ['http://exemplo.com/p', 'javascript:alert(1)', 'ftp://x/y', 'https://x y', 'pasta/xpto', 'https://' + 'a'.repeat(2000)]) {
      expect(deForm({ ...base, documentos_url: ruim }).success, ruim).toBe(false)
    }
    expect(deForm({ ...base, documentos_nome: 'x'.repeat(81), documentos_url: url }).success).toBe(false)
    const semLink = deForm({ ...base, documentos_nome: 'Pasta XPTO' })
    expect(semLink.success && regrasNegocio(semLink.data).map((e) => e.campo)).toContain('documentos_url')
  })
  it('duração do contrato (meses): inteiro de 1 a 600, vazio vale null', () => {
    expect(paraForm({ duracao_contrato_meses: 36 }).duracao_contrato_meses).toBe('36')
    const ok = deForm({ ...base, duracao_contrato_meses: '12' })
    expect(ok.success && ok.data.duracao_contrato_meses).toBe(12)
    const vazio = deForm({ ...base, duracao_contrato_meses: '' })
    expect(vazio.success && vazio.data.duracao_contrato_meses).toBeNull()
    for (const ruim of ['0', '601', '1,5', 'abc']) expect(deForm({ ...base, duracao_contrato_meses: ruim }).success, ruim).toBe(false)
  })
  it('impostos: percentual com duas casas no formulário, arredondado e em fração na API', () => {
    expect(paraForm({ impostos: 0.0865 }).impostos).toBe('8,65')
    expect(paraForm({ impostos: 0.1 }).impostos).toBe('10,00')
    expect(paraForm({}).impostos).toBe('')
    const a = deForm({ ...base, impostos: '8,654' })
    expect(a.success && a.data.impostos).toBe(0.0865)
    const b = deForm({ ...base, impostos: '10' })
    expect(b.success && b.data.impostos).toBe(0.1)
    expect(pct(0.0865)).toBe('8,65%')
    expect(pct(0.1)).toBe('10,00%')
    expect(pct(null)).toBe('—')
  })
  it('impostos fora de 0% a 100% é recusado', () => {
    const r = deForm({ ...base, impostos: '120' })
    expect(r.success && regrasNegocio(r.data).map((e) => e.campo)).toContain('impostos')
    const neg = deForm({ ...base, impostos: '-1' })
    expect(neg.success && regrasNegocio(neg.data).map((e) => e.campo)).toContain('impostos')
  })
  it('vazio vira null e erro de formato aponta o campo', () => {
    const ok = deForm(base)
    expect(ok.success && ok.data).toMatchObject({ orcamento: null, mc_ctc: null, processo: null })
    const ruim = deForm({ ...base, orcamento: 'abc' })
    expect(!ruim.success && ruim.error.issues[0].path[0]).toBe('orcamento')
  })
  it('remove da lista de pendências o campo que já foi preenchido', () => {
    const r = deForm({ ...base, site: 'ComprasNet' }, ['site', 'modalidade'])
    expect(r.success && r.data.pendencias).toEqual(['modalidade'])
  })
})

describe('regrasNegocio (espelho do banco)', () => {
  const ok = (extra: Partial<OportunidadeInput> = {}) => {
    const r = deForm(base)
    if (!r.success) throw new Error('formato')
    return { ...r.data, ...extra }
  }
  it('obrigatórios', () => {
    const r = deForm(paraForm({}))
    expect(r.success && regrasNegocio(r.data).map((e) => e.campo)).toEqual(['status', 'data_pregao_dt', 'orgao', 'descritivo', 'torre'])
  })
  it('motivo por status, Win com Valor CTC, datas e sigilo', () => {
    expect(regrasNegocio(ok({ status: 'No Go' })).map((e) => e.campo)).toContain('motivo_no_go')
    expect(regrasNegocio(ok({ status: 'Lost' })).map((e) => e.campo)).toContain('motivo_lost')
    expect(regrasNegocio(ok({ status: 'Win' })).map((e) => e.campo)).toContain('valor_ctc')
    expect(regrasNegocio(ok({ data_distribuicao: '2026-04-01' })).map((e) => e.campo)).toContain('data_pregao_dt')
    expect(regrasNegocio(ok({ orcamento_sigiloso: true, orcamento: 10 })).map((e) => e.campo)).toContain('orcamento')
    expect(regrasNegocio(ok())).toEqual([])
  })
})

describe('objeto e hora do pregão no formulário', () => {
  it('o banco devolve HH:MM:SS e o campo mostra HH:MM; vazio fica vazio', () => {
    expect(paraForm({ hora_pregao: '15:30:00', objeto: 'Link dedicado' })).toMatchObject({ hora_pregao: '15:30', objeto: 'Link dedicado' })
    expect(paraForm({})).toMatchObject({ hora_pregao: '', objeto: '' })
    expect(paraForm({ hora_pregao: null, objeto: null })).toMatchObject({ hora_pregao: '', objeto: '' })
  })
  it('vai e volta: hora e objeto digitados chegam à API como o contrato espera', () => {
    const r = deForm({ ...base, hora_pregao: '15:30', objeto: 'Link dedicado' })
    expect(r.success && r.data).toMatchObject({ hora_pregao: '15:30', objeto: 'Link dedicado' })
    const vazio = deForm(base)
    expect(vazio.success && vazio.data).toMatchObject({ hora_pregao: null, objeto: null })
  })
  it('hora inválida aponta o campo', () => {
    const r = deForm({ ...base, hora_pregao: '25:00' })
    expect(!r.success && r.error.issues[0].path[0]).toBe('hora_pregao')
  })
  it('data e hora do pregão na grade: com hora mostra as duas; sem hora (planilha), só a data', () => {
    expect(pregaoBr('2026-11-05', '15:30:00')).toBe('05/11/2026 15:30')
    expect(pregaoBr('2026-11-05', null)).toBe('05/11/2026')
    expect(pregaoBr(null, '15:30:00')).toBe('—')
  })
})