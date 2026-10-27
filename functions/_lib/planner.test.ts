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
  it('título: só a chave, a Sigla e o Descritivo (assunto); descritivo longo é cortado', () => {
    expect(tituloCartao({ ...base, sigla: 'SEDES' })).toBe('[RADAR 2026-0077] SEDES | Link dedicado')
    expect(tituloCartao({ ...base, sigla: null })).toBe('[RADAR 2026-0077] Link dedicado') // sem sigla: só o descritivo
    expect(tituloCartao({ ...base, sigla: '  ' })).toBe('[RADAR 2026-0077] Link dedicado')
    const t = tituloCartao({ ...base, sigla: 'SEDES', descritivo: 'x'.repeat(900) })
    expect(t.length).toBeLessThanOrEqual(255)
    expect(t.startsWith('[RADAR 2026-0077] SEDES | xxx')).toBe(true)
    expect(t.endsWith('…')).toBe(true)
  })
  it('título sem processo, Uasg, órgão, objeto nem data (isso fica nas anotações) e com a chave entre colchetes', () => {
    expect(tituloCartao({ ...base, sigla: 'SEDES', objeto: 'Outro assunto', hora_pregao: '15:30:00' })).toBe('[RADAR 2026-0077] SEDES | Link dedicado')
    // sem código (legado): reserva RAD-<id>
    expect(tituloCartao({ ...base, codigo: null }).startsWith('[RADAR RAD-77] ')).toBe(true)
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
    expect(its.cartao).toMatchObject({ bucket: 'ON GOING', progresso: 50 })
    const dig = montarEvento({ ...base, torre: 'DIGITAL', status: 'Win' }, 'oportunidade_atualizada', M, email)!
    expect(dig.cartao).toMatchObject({ bucket: 'WIN', progresso: 100, rotulos: ['Licitação', 'Público', 'DIGITAL'] })
    expect(montarEvento({ ...base, status: null }, 'oportunidade_nova', M, email)!.cartao.bucket).toBe('PROSPECT')
    expect(montarEvento({ ...base, torre: 'HEALTH', status: 'Canceled' }, 'oportunidade_atualizada', M, email)!.cartao.bucket).toBe('CANCELLED')
  })
  it('vários pré-vendas: todos com e-mail viram responsáveis (o primeiro é o responsável principal)', () => {
    const doisEmails = (n: string) => ({ 'Júlio César': 'julio.silva@ctctech.com.br', Ana: 'ana@ctctech.com.br' })[n] ?? null
    const e = montarEvento({ ...base, analista: 'Júlio César, Fulano, Ana' }, 'oportunidade_nova', M, doisEmails)!
    expect(e.cartao.responsaveis).toEqual(['julio.silva@ctctech.com.br', 'ana@ctctech.com.br'])
    expect(e.cartao.responsavel).toBe('julio.silva@ctctech.com.br')
  })
  it('responsável pelo e-mail cadastrado; sem e-mail fica nulo; checklist padrão só na criação', () => {
    const nova = montarEvento(base, 'oportunidade_nova', M, email)!
    expect(nova.cartao.responsavel).toBe('julio.silva@ctctech.com.br')
    expect(nova.cartao.checklist).toHaveLength(7)
    expect(nova.cartao.prazo).toBe('2026-11-05T12:00:00Z')
    expect(nova.versaoOrigem).toBe(1)
    expect(montarEvento({ ...base, versao: 4 }, 'oportunidade_atualizada', M, email)!.versaoOrigem).toBe(4)
    expect(nova.cartao.responsaveis).toEqual(['julio.silva@ctctech.com.br'])
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

describe('anotações do cartão: todas as informações da oportunidade', () => {
  const dados = {
    ...base, versao: 3, sigla: 'SEDES', objeto: 'Link dedicado de 1 Gbps', hora_pregao: '15:30:00', data_distribuicao: '2026-10-20', analista: 'Júlio César, Ana',
    orcamento: 1500000, orcamento_sigiloso: false, valor_ctc: 1200000.5, impostos: 0.0865, mc_ctc: 0.185, pendencias: ['site'], criado_por: 'ana@ctctech.com.br',
    unidade_fornecimento: 'Serviço (valor fixo)', modo_disputa: 'Aberto',
  }
  it('lista todos os campos do formulário, na ordem das seções, formatados', () => {
    const nota = montarEvento({ ...base, versao: 3, dados }, 'oportunidade_nova', M, email)!.cartao.nota
    expect(nota.split(/\r?\n/)[0]).toBe('Radar 2026-0077 (v3) — dados da oportunidade')
    for (const trecho of ['IDENTIFICAÇÃO', 'Sigla: SEDES', 'Objeto: Link dedicado de 1 Gbps', 'Processo/Pregão: 24/2026', 'UASG: 158443', 'Data do pregão: 05/11/2026', 'Hora do pregão: 15:30',
      'Pré-vendas: Júlio César, Ana', 'Unidade de fornecimento: Serviço (valor fixo)', 'Impostos (%): 8,65%', 'MC CTC (%): 18,50%', 'Pendências: site', 'Cadastrada por: ana@ctctech.com.br']) {
      expect(nota, trecho).toContain(trecho)
    }
    expect(nota).toMatch(/Orçamento \(R\$\): R\$\s1\.500\.000,00/)
    expect(nota).toContain('Critério: —') // campo em branco aparece, para ficar claro que não há informação
  })
  it('orçamento sigiloso não vaza valor; motivos de No Go/Lost só aparecem no status deles', () => {
    const sig = montarEvento({ ...base, dados: { ...dados, orcamento_sigiloso: true } }, 'oportunidade_nova', M, email)!.cartao.nota
    expect(sig).toContain('Orçamento (R$): Sigiloso')
    expect(sig).not.toMatch(/1\.500\.000/)
    expect(sig).not.toContain('Motivo do No Go')
    const nogo = montarEvento({ ...base, status: 'No Go', dados: { ...dados, status: 'No Go', motivo_no_go: 'Risco Jurídico' } }, 'oportunidade_nova', M, email)!.cartao.nota
    expect(nogo).toContain('Motivo do No Go: Risco Jurídico')
  })
})

describe('objeto e hora do pregão no Planner', () => {
  it('o Objeto não entra no título (o assunto é o descritivo); está nas anotações', () => {
    expect(tituloCartao({ ...base, objeto: 'Link dedicado de 1 Gbps' })).toBe(tituloCartao(base))
  })
  it('com hora, o prazo leva a hora (Brasília = UTC-3); sem hora, tudo como antes', () => {
    expect(prazoDoCartao('2026-11-05', '12:00:00')).toBe('2026-11-05T15:00:00Z')
    expect(prazoDoCartao('2026-11-05', '22:30')).toBe('2026-11-06T01:30:00Z') // vira o dia em UTC
    expect(prazoDoCartao('2026-11-05', null)).toBe('2026-11-05T12:00:00Z')
    expect(prazoDoCartao(null, '10:00')).toBeNull()
    const ev = montarEvento({ ...base, hora_pregao: '12:00:00' }, 'oportunidade_atualizada', M, email)!
    expect(ev.cartao.prazo).toBe('2026-11-05T15:00:00Z')
    expect(montarEvento(base, 'oportunidade_nova', M, email)!.cartao.prazo).toBe('2026-11-05T12:00:00Z')
  })
})