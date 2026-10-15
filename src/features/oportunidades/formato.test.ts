import { describe, expect, it } from 'vitest'
import { regrasNegocio, type OportunidadeInput } from '@/domain/oportunidade'
import { deForm, paraForm } from './formato'

const base = paraForm({ status: 'Go', orgao: 'SEDES', descritivo: 'Link', torre: 'ITS', data_pregao_dt: '2026-03-10' })

describe('formulário <-> API', () => {
  it('mostra margem em % e valores com vírgula, e devolve em fração/número', () => {
    const f = paraForm({ mc_ctc: 0.185, orcamento: 1234.5, posicao_lance: 3, data_pregao_dt: '2026-03-10' })
    expect(f).toMatchObject({ mc_ctc: '18,5', orcamento: '1234,5', posicao_lance: '3', data_pregao_dt: '2026-03-10', status: '' })
    const r = deForm({ ...base, mc_ctc: '18,5', orcamento: '1.234,50', posicao_lance: '3' })
    expect(r.success && r.data).toMatchObject({ mc_ctc: 0.185, orcamento: 1234.5, posicao_lance: 3, status: 'Go' })
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
