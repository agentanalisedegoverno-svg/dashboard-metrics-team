import { describe, expect, it } from 'vitest'
import type { Oportunidade } from '@/domain/oportunidade'
import { avaliar, diasAte, faixaDe, faltas, grupoDe, montar } from './noc'

const HOJE = new Date(2026, 9, 29, 15, 0) // 29/10/2026, quinta
const op = (p: Partial<Oportunidade>) =>
  ({ id: 1, status: 'Go', orgao: 'Órgão', processo: '1/2026', uf: 'DF', uasg: '1', site: 'https://x', data_pregao_dt: '2026-11-20', ...p }) as Oportunidade

describe('painel de licitações (NOC)', () => {
  it('separa certames (Prospect/Go) de contratos (On going, Onboarding, Suspended) e ignora o resto', () => {
    expect(['Prospect', 'Go', ' go '].map(grupoDe)).toEqual(['certame', 'certame', 'certame'])
    expect(['On going', 'ongoing', 'Onboarding', 'Suspended', 'Suspenso'].map(grupoDe)).toEqual(Array(5).fill('contrato'))
    expect(['Win', 'Lost', 'No Go', 'Canceled', 'Validar', null].map(grupoDe)).toEqual(Array(6).fill(null))
  })

  it('conta dias de calendário (hoje = 0, amanhã = 1, passado negativo), sem se perder com horário ou data ruim', () => {
    expect(diasAte('2026-10-29', HOJE)).toBe(0)
    expect(diasAte('2026-10-30', HOJE)).toBe(1)
    expect(diasAte('2026-10-28', HOJE)).toBe(-1)
    expect(diasAte('2026-11-05T09:30:00', HOJE)).toBe(7)
    expect(diasAte('2027-01-01', HOJE)).toBe(64)
    expect(diasAte(null, HOJE)).toBeNull()
    expect(diasAte('29/10/2026', HOJE)).toBeNull()
    expect(diasAte('2026-10-29', new Date(2026, 9, 29, 23, 59))).toBe(0)
  })

  it('faixas de urgência', () => {
    expect([-3, 0, 1, 2, 7, 8, null].map(faixaDe)).toEqual(['atrasado', 'hoje', 'amanha', 'semana', 'semana', 'proximas', 'sem_data'])
  })

  it('faltas: processo e UF bloqueiam; UASG e link só avisam; UASG não é cobrada de Corporate', () => {
    expect(faltas(op({ processo: ' ', uf: null, uasg: '', site: null }))).toEqual([
      { chave: 'processo', rotulo: 'Sem nº do processo', bloqueia: true },
      { chave: 'uf', rotulo: 'Sem UF', bloqueia: true },
      { chave: 'uasg', rotulo: 'Sem UASG', bloqueia: false },
      { chave: 'link', rotulo: 'Sem link do edital', bloqueia: false },
    ])
    expect(faltas(op({ uasg: null, segmento: 'Corporate' })).map((f) => f.chave)).toEqual([])
    expect(faltas(op({ uf: 'Distrito' })).map((f) => f.chave)).toEqual(['uf'])
  })

  it('pregão hoje é crítico e mostra a hora; amanhã é atenção; adiante com cadastro completo está ok', () => {
    const hoje = avaliar(op({ data_pregao_dt: '2026-10-29', hora_pregao: '09:30:00' }), HOJE)!
    expect([hoje.faixa, hoje.nivel, hoje.titulo]).toEqual(['hoje', 'critico', 'Pregão hoje às 09:30'])
    const amanha = avaliar(op({ data_pregao_dt: '2026-10-30' }), HOJE)!
    expect([amanha.faixa, amanha.nivel]).toEqual(['amanha', 'atencao'])
    const adiante = avaliar(op({}), HOJE)!
    expect([adiante.faixa, adiante.nivel, adiante.titulo]).toEqual(['proximas', 'ok', 'Pregão em 22 dias'])
  })

  it('cadastro incompleto sobe a urgência perto do pregão', () => {
    expect(avaliar(op({ data_pregao_dt: '2026-10-30', processo: '' }), HOJE)!.nivel).toBe('critico')
    expect(avaliar(op({ data_pregao_dt: '2026-11-03', processo: '' }), HOJE)!.nivel).toBe('atencao')
    expect(avaliar(op({ data_pregao_dt: '2026-11-03', uasg: '', site: '' }), HOJE)!.nivel).toBe('ok') // só dados que ajudam: não alarma
  })

  it('certame com pregão no passado ou sem data pede atualização', () => {
    const velho = avaliar(op({ status: 'Prospect', data_pregao_dt: '2026-10-27' }), HOJE)!
    expect([velho.faixa, velho.nivel, velho.titulo]).toEqual(['atrasado', 'critico', 'Pregão foi há 2 dias e o status segue Prospect'])
    expect(avaliar(op({ data_pregao_dt: '2026-10-28' }), HOJE)!.titulo).toBe('Pregão foi há 1 dia e o status segue Go')
    const sem = avaliar(op({ data_pregao_dt: null }), HOJE)!
    expect([sem.faixa, sem.nivel]).toEqual(['sem_data', 'atencao'])
  })

  it('contrato em andamento não gera alerta de pregão; suspenso pede confirmação de retomada', () => {
    const rodando = avaliar(op({ status: 'On going', data_pregao_dt: '2026-01-10' }), HOJE)!
    expect([rodando.grupo, rodando.nivel, rodando.titulo]).toEqual(['contrato', 'ok', 'Em andamento'])
    const susp = avaliar(op({ status: 'Suspended', data_pregao_dt: '2026-01-10' }), HOJE)!
    expect([susp.nivel, susp.titulo]).toEqual(['atencao', 'Suspenso'])
  })

  it('monta: ignora arquivadas e outros status, e ordena por data (atrasados primeiro, sem data por último)', () => {
    const linhas = montar(
      [
        op({ id: 1, data_pregao_dt: '2026-12-01' }),
        op({ id: 2, data_pregao_dt: null }),
        op({ id: 3, data_pregao_dt: '2026-10-29' }),
        op({ id: 4, data_pregao_dt: '2026-10-20' }),
        op({ id: 5, status: 'Win' }),
        op({ id: 6, arquivado_em: '2026-10-01T00:00:00Z' }),
      ],
      HOJE,
    )
    expect(linhas.map((l) => l.o.id)).toEqual([4, 3, 1, 2])
  })
})
