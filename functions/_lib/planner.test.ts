import { describe, expect, it } from 'vitest'
import mapa from '../../config/planner-mapa.json'
import { chaveRadar, montarEvento, nomeArquivo, planoDaTorre, tituloCartao, type MapaPlanner, type OportunidadePlanner } from './planner.ts'

const M = mapa as unknown as MapaPlanner
const base: OportunidadePlanner = {
  id: 77, versao: 1, status: 'Go', torre: 'ITS', orgao: 'SEDES', descritivo: 'Link  dedicado', processo: '24/2026', uasg: '158443',
  data_pregao_dt: '2026-11-05', analista: 'Júlio César', linha_servico: 'Conectividade', observacoes: null, orcamento: 1500000, orcamento_sigiloso: false,
}
const email = (n: string) => (n === 'Júlio César' ? 'julio.silva@ctctech.com.br' : null)

describe('integração Planner', () => {
  it('título no padrão dos cartões existentes, com a chave entre colchetes', () => {
    expect(tituloCartao(base)).toBe('[RAD-77] SEDES | Link dedicado | PE: 24/2026 UASG: 158443 | DATA: 05/11/2026')
    expect(tituloCartao({ ...base, processo: null, uasg: null, data_pregao_dt: null, orgao: null })).toBe('[RAD-77] Órgão não informado | Link dedicado')
    expect(chaveRadar(5)).toBe('RAD-5')
  })
  it('a torre decide o plano: ITS num, DIGITAL e HEALTH no outro; torre desconhecida não gera evento', () => {
    expect(planoDaTorre(M, 'ITS')?.planId).toBe('ZiZ73_n76Uu8gXXYbmIQ0mUAD-k0')
    expect(planoDaTorre(M, 'digital')?.planId).toBe('4lfDD-9yK0KEimdO-fLPMmUACMhU')
    expect(planoDaTorre(M, 'HEALTH')?.planId).toBe('4lfDD-9yK0KEimdO-fLPMmUACMhU')
    expect(montarEvento({ ...base, torre: 'NUVEM' }, 'oportunidade_nova', M, email)).toBeNull()
    expect(montarEvento({ ...base, torre: null }, 'oportunidade_nova', M, email)).toBeNull()
  })
  it('status -> bucket e progresso por plano; sem status cai no bucket inicial', () => {
    const its = montarEvento({ ...base, status: 'On going' }, 'oportunidade_atualizada', M, email)!
    expect(its.cartao).toMatchObject({ bucket: 'Em andamento ( Proposta Entregue)', progresso: 50 })
    const dig = montarEvento({ ...base, torre: 'DIGITAL', status: 'Win' }, 'oportunidade_atualizada', M, email)!
    expect(dig.cartao).toMatchObject({ bucket: 'WIN', progresso: 100, rotulos: ['Licitação', 'Público', 'DIGITAL'] })
    expect(montarEvento({ ...base, status: null }, 'oportunidade_nova', M, email)!.cartao.bucket).toBe('Preparo')
    expect(montarEvento({ ...base, torre: 'HEALTH', status: 'Canceled' }, 'oportunidade_atualizada', M, email)!.cartao.bucket).toBe('Revogado')
  })
  it('responsável pelo e-mail cadastrado; sem e-mail fica nulo; checklist padrão só na criação', () => {
    const nova = montarEvento(base, 'oportunidade_nova', M, email)!
    expect(nova.cartao.responsavel).toBe('julio.silva@ctctech.com.br')
    expect(nova.cartao.checklist).toHaveLength(7)
    expect(nova.cartao.prazo).toBe('2026-11-05T12:00:00Z')
    const upd = montarEvento({ ...base, analista: 'Fulano' }, 'oportunidade_atualizada', M, email)!
    expect(upd.cartao.responsavel).toBeNull()
    expect(upd.cartao.checklist).toEqual([])
  })
  it('nome de arquivo ordenável e orçamento sigiloso não vaza valor', () => {
    const e = montarEvento({ ...base, orcamento_sigiloso: true }, 'oportunidade_nova', M, email, new Date('2026-10-21T14:30:00Z'))!
    expect(nomeArquivo(e)).toBe('20261021-1430_RAD-77_oportunidade_nova.json')
    expect(e.cartao.nota).toContain('Orçamento sigiloso.')
    expect(e.cartao.nota).not.toMatch(/1\.500\.000/)
  })
})
