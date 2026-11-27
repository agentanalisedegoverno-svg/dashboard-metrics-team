import { describe, expect, it } from 'vitest'
import type { Oportunidade } from '@/domain/oportunidade'
import { avaliar, CHECKLIST_PREGAO, diasAte, exigeChecklist, faixaDe, faltas, grupoDe, MOTIVOS, montar } from './noc'

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

  it('faltas: processo e UF bloqueiam; UASG e site só avisam; UASG não é cobrada de Corporate', () => {
    expect(faltas(op({ processo: ' ', uf: null, uasg: '', site: null }))).toEqual([
      { chave: 'processo', rotulo: 'Sem nº do processo', bloqueia: true },
      { chave: 'uf', rotulo: 'Sem UF', bloqueia: true },
      { chave: 'uasg', rotulo: 'Sem UASG', bloqueia: false },
      { chave: 'site', rotulo: 'Sem site (portal)', bloqueia: false },
    ])
    expect(faltas(op({ uasg: null, segmento: 'Corporate' })).map((f) => f.chave)).toEqual([])
    expect(faltas(op({ uf: 'Distrito' })).map((f) => f.chave)).toEqual(['uf'])
  })

  it('pregão hoje é crítico e mostra a hora; amanhã é atenção; adiante com cadastro completo está ok', () => {
    const hoje = avaliar(op({ data_pregao_dt: '2026-10-29', hora_pregao: '09:30:00' }), HOJE)!
    expect([hoje.faixa, hoje.nivel, hoje.titulo]).toEqual(['hoje', 'critico', 'Pregão hoje às 09:30'])
    const amanha = avaliar(op({ data_pregao_dt: '2026-10-30' }), HOJE)!
    expect([amanha.faixa, amanha.nivel]).toEqual(['amanha', 'critico']) // amanhã está dentro dos 3 dias úteis: vermelho
    const adiante = avaliar(op({}), HOJE)!
    expect([adiante.faixa, adiante.nivel, adiante.titulo]).toEqual(['proximas', 'ok', 'Pregão em 22 dias'])
  })

  it('cadastro incompleto sobe a urgência perto do pregão', () => {
    expect(avaliar(op({ data_pregao_dt: '2026-10-30', processo: '' }), HOJE)!.nivel).toBe('critico')
    expect(avaliar(op({ data_pregao_dt: '2026-11-05', processo: '' }), HOJE)!.nivel).toBe('atencao')
    expect(avaliar(op({ data_pregao_dt: '2026-11-10', processo: '' }), HOJE)!.nivel).toBe('ok') // 12 dias e 7 úteis: longe demais para alarmar
    expect(avaliar(op({ data_pregao_dt: '2026-11-10', uasg: '', site: '' }), HOJE)!.nivel).toBe('ok') // só dados que ajudam: não alarma
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

  it('todo item que pede ação traz o motivo; no prazo não tem motivo', () => {
    const m = (o: Parameters<typeof op>[0]) => avaliar(op(o), HOJE)!.motivo
    expect(m({ data_pregao_dt: '2026-10-27' })).toBe('status_desatualizado')
    expect(m({ data_pregao_dt: '2026-10-29' })).toBe('pregao_hoje')
    expect(m({ data_pregao_dt: '2026-10-30' })).toBe('pregao_amanha')
    expect(m({ data_pregao_dt: '2026-10-30', processo: '' })).toBe('cadastro_incompleto')
    expect(m({ data_pregao_dt: '2026-11-05', processo: '' })).toBe('cadastro_incompleto')
    expect(m({ data_pregao_dt: null })).toBe('sem_data')
    expect(m({ status: 'Suspended' })).toBe('suspenso')
    expect(m({ data_pregao_dt: '2026-11-03' })).toBe('prazo_3_uteis')
    expect(m({ data_pregao_dt: '2026-11-10' })).toBeNull()
    expect(m({ status: 'On going' })).toBeNull()
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

  describe('alerta de prazo em dias úteis: amarelo até 5, vermelho até 3', () => {
    // HOJE = quinta 29/10/2026. Úteis seguintes: sex 30/10 (1); sáb/dom não contam; seg 02/11 é Finados (feriado); ter 03 (2), qua 04 (3), qui 05 (4), sex 06 (5), seg 09 (6), ter 10 (7)
    const a = (data: string, extra: Partial<Oportunidade> = {}) => avaliar(op({ data_pregao_dt: data, ...extra }), HOJE)!
    it('vermelho até 3 dias úteis: amanhã, ter 03/11 (2) e qua 04/11 (3)', () => {
      for (const d of ['2026-10-30', '2026-11-03', '2026-11-04']) expect(a(d).nivel, d).toBe('critico')
      expect(a('2026-11-04')).toMatchObject({ nivel: 'critico', uteis: 3, motivo: 'prazo_3_uteis', titulo: 'Pregão em 6 dias (3 dias úteis)' })
    })
    it('amarelo com 4 e 5 dias úteis (qui 05/11 e sex 06/11)', () => {
      expect(a('2026-11-05')).toMatchObject({ nivel: 'atencao', uteis: 4, motivo: 'prazo_5_uteis', titulo: 'Pregão em 7 dias (4 dias úteis)' })
      expect(a('2026-11-06')).toMatchObject({ nivel: 'atencao', uteis: 5, motivo: 'prazo_5_uteis' })
    })
    it('sem alerta com 6 ou mais dias úteis (seg 09/11)', () => {
      expect(a('2026-11-09')).toMatchObject({ nivel: 'ok', uteis: 6, motivo: null, titulo: 'Pregão em 11 dias', acao: 'No prazo.' })
    })
    it('fim de semana e feriado não contam: da sexta 30/10, a segunda 02/11 (Finados) tem 0 dias úteis e a terça 1', () => {
      const sexta = new Date(2026, 9, 30, 9, 0)
      expect(avaliar(op({ data_pregao_dt: '2026-11-02' }), sexta)).toMatchObject({ uteis: 0, nivel: 'critico' })
      expect(avaliar(op({ data_pregao_dt: '2026-11-03' }), sexta)).toMatchObject({ uteis: 1, nivel: 'critico' })
    })
    it('vale o dia útil, não o corrido: de sexta 06/11 a quinta 12/11 são 6 dias corridos mas 4 úteis (amarelo)', () => {
      const sexta = new Date(2026, 10, 6, 9, 0)
      expect(avaliar(op({ data_pregao_dt: '2026-11-12' }), sexta)).toMatchObject({ dias: 6, uteis: 4, nivel: 'atencao' })
    })
    it('o prazo manda mesmo com o cadastro completo; cadastro incompleto continua aparecendo como motivo', () => {
      expect(a('2026-11-05', { processo: '' })).toMatchObject({ nivel: 'atencao', motivo: 'cadastro_incompleto' })
      expect(a('2026-11-04', { processo: '' })).toMatchObject({ nivel: 'critico', motivo: 'cadastro_incompleto' })
    })
    it('pregão já passado continua crítico por status desatualizado, e contrato nunca recebe alerta de prazo', () => {
      expect(a('2026-10-27')).toMatchObject({ nivel: 'critico', motivo: 'status_desatualizado' })
      expect(a('2026-11-04', { status: 'On going' })).toMatchObject({ nivel: 'ok', motivo: null })
    })
    it('os motivos novos têm texto', () => {
      expect(MOTIVOS.prazo_3_uteis).toMatch(/3 dias úteis/)
      expect(MOTIVOS.prazo_5_uteis).toMatch(/5 dias úteis/)
    })
  })

  describe('checklist do pregão (pop-up antes de abrir o cadastro)', () => {
    it('só para certame com pregão hoje ou adiante; não para pregão passado, sem data ou contrato', () => {
      const e = (o: Partial<Oportunidade>) => exigeChecklist(avaliar(op(o), HOJE)!)
      expect(e({ data_pregao_dt: '2026-10-29' })).toBe(true)
      expect(e({ data_pregao_dt: '2026-12-15' })).toBe(true)
      expect(e({ data_pregao_dt: '2026-10-28' })).toBe(false)
      expect(e({ data_pregao_dt: null })).toBe(false)
      expect(e({ status: 'On going', data_pregao_dt: '2026-11-04' })).toBe(false)
    })
    it('traz as perguntas pedidas (portal, operação, visibilidade, atestado) e a conferência da data', () => {
      expect(CHECKLIST_PREGAO).toHaveLength(5)
      const t = CHECKLIST_PREGAO.join('\n')
      expect(t).toMatch(/cadastro.*portal/i)
      expect(t).toMatch(/encaminhou.*opera/i)
      expect(t).toMatch(/visibilidade.*opera/i)
      expect(t).toMatch(/atestado t[eé]cnico/i)
      expect(t).toMatch(/data e a hora/i)
    })
  })
})
