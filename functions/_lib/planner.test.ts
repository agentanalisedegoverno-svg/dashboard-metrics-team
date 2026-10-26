import { describe, expect, it } from 'vitest'
import mapa from '../../config/planner-mapa.json'
import { chaveRadar, montarEvento, nomeArquivo, planoDaTorre, prazoDoCartao, tituloCartao, type MapaPlanner, type OportunidadePlanner } from './planner.ts'

const M = mapa as unknown as MapaPlanner
const base: OportunidadePlanner = {
  id: 77, codigo: '2026-0077', versao: 1, status: 'Go', torre: 'ITS', orgao: 'SEDES', descritivo: 'Link  dedicado', processo: '24/2026', uasg: '158443',
  data_pregao_dt: '2026-11-05', analista: 'Júlio César', linha_servico: 'Conectividade', observacoes: null, orcamento: 1500000, orcamento_sigiloso: false,
}
const email = (n: string) => (n === 'Júlio César' ? 'julio.silva@ctctech.com.br' : null)

describe('integração Planner', () => {
  it('título no padrão dos cartões existentes, com a chave entre colchetes', () => {
    expect(tituloCartao(base)).toBe('[2026-0077] SEDES | Link dedicado | PE: 24/2026 UASG: 158443 | DATA: 05/11/2026')
    expect(tituloCartao({ ...base, processo: null, uasg: null, data_pregao_dt: null, orgao: null })).toBe('[2026-0077] Órgão não informado | Link dedicado')
    // sem código (legado): reserva RAD-<id>
    expect(tituloCartao({ ...base, codigo: null }).startsWith('[RAD-77] ')).toBe(true)
    expect(chaveRadar(5)).toBe('RAD-5')
    expect(montarEvento(base, 'oportunidade_nova', M, email)!.chave).toBe('2026-0077')
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
    expect(nova.versaoOrigem).toBe(1)
    expect(montarEvento({ ...base, versao: 4 }, 'oportunidade_atualizada', M, email)!.versaoOrigem).toBe(4)
    const upd = montarEvento({ ...base, analista: 'Fulano' }, 'oportunidade_atualizada', M, email)!
    expect(upd.cartao.responsavel).toBeNull()
    expect(upd.cartao.checklist).toEqual([])
  })
  it('nome de arquivo ordenável e orçamento sigiloso não vaza valor', () => {
    const e = montarEvento({ ...base, orcamento_sigiloso: true }, 'oportunidade_nova', M, email, new Date('2026-10-21T14:30:00Z'))!
    expect(nomeArquivo(e)).toBe('20261021-1430_2026-0077_oportunidade_nova.json')
    expect(e.cartao.nota).toContain('Orçamento sigiloso.')
    expect(e.cartao.nota).not.toMatch(/1\.500\.000/)
  })
})

describe('objeto e hora do pregão no Planner', () => {
  it('o título usa o Objeto quando preenchido; em branco, o descritivo, como sempre foi', () => {
    expect(tituloCartao({ ...base, objeto: 'Link dedicado de 1 Gbps' })).toBe('[2026-0077] SEDES | Link dedicado de 1 Gbps | PE: 24/2026 UASG: 158443 | DATA: 05/11/2026')
    expect(tituloCartao({ ...base, objeto: '   ' })).toBe(tituloCartao(base))
    expect(tituloCartao({ ...base, objeto: null })).toBe(tituloCartao(base))
  })
  it('com hora, o título e o prazo levam a hora (Brasília = UTC-3); sem hora, tudo como antes', () => {
    expect(tituloCartao({ ...base, hora_pregao: '15:30:00' })).toBe('[2026-0077] SEDES | Link dedicado | PE: 24/2026 UASG: 158443 | DATA: 05/11/2026 15:30')
    expect(prazoDoCartao('2026-11-05', '12:00:00')).toBe('2026-11-05T15:00:00Z')
    expect(prazoDoCartao('2026-11-05', '22:30')).toBe('2026-11-06T01:30:00Z') // vira o dia em UTC
    expect(prazoDoCartao('2026-11-05', null)).toBe('2026-11-05T12:00:00Z')
    expect(prazoDoCartao(null, '10:00')).toBeNull()
    const ev = montarEvento({ ...base, hora_pregao: '12:00:00' }, 'oportunidade_atualizada', M, email)!
    expect(ev.cartao.prazo).toBe('2026-11-05T15:00:00Z')
    expect(ev.cartao.titulo.endsWith('DATA: 05/11/2026 12:00')).toBe(true)
    expect(montarEvento(base, 'oportunidade_nova', M, email)!.cartao.prazo).toBe('2026-11-05T12:00:00Z')
  })
})