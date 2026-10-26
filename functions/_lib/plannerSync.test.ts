/**
 * A regra de atualização do cartão em TypeScript (modo nuvem) tem de ser IGUAL à do Python (modo máquina).
 * Estes cenários espelham planner-auto/tests/test_planner_auto.py, classe RegraDeAtualizacao.
 */
import { describe, expect, it } from 'vitest'
import type { GraphLike } from './graph.ts'
import type { EventoPlanner } from './planner.ts'
import { aplicar, carimbo, chaveDoTitulo, EventoInvalido, normaliza, planejar, resolveNome, validaEvento, type Contexto, type Plano } from './plannerSync.ts'

const BUCKETS = { GO: 'b-go', 'Em andamento ( Proposta Entregue)': 'b-and', 'NO GO': 'b-nogo' }
const CATS = { 'Licitação': 'category1', 'Público': 'category2', DIGITAL: 'category3' }

const evento = (cartao: Partial<EventoPlanner['cartao']> = {}, ev: Partial<EventoPlanner> = {}): EventoPlanner => ({
  versao: '2', tipo: 'oportunidade_nova', chave: 'RAD-7', origem: 'Radar', versaoOrigem: 1, geradoEm: '2026-10-21T14:00:00Z', plano: 'PLANO1', planoNome: 'ITS',
  cartao: {
    titulo: '[RAD-7] SEDES | Link | PE: 1/2026 | DATA: 05/11/2026', status: 'Go', bucket: 'GO', progresso: 50, prazo: '2026-11-05T12:00:00Z',
    responsavel: 'julio.silva@ctctech.com.br', rotulos: ['Licitação', 'Público'], nota: 'Radar #7 (v1)', checklist: ['a', 'b'], ...cartao,
  },
  ...ev,
})

const ctx = (extra: Partial<Contexto> = {}): Contexto => ({
  buckets: BUCKETS, categorias: CATS, tarefasPorChave: {}, ultimaVersao: null, tarefaId: null, extras: [],
  resolveUsuario: async (email) => 'u-' + email.split('@')[0], ...extra,
})

/** Registra o que seria gravado no Planner (nada de rede). */
class GraphFalso implements GraphLike {
  gravacoes: { metodo: string; caminho: string; corpo: any }[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  tarefa: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  constructor(
    tarefa: Record<string, unknown> = {},
    public descricao = '',
  ) {
    this.tarefa = { id: 't1', title: '[RAD-7] título antigo', bucketId: 'b-nogo', percentComplete: 100, dueDateTime: '2026-01-01T12:00:00Z', appliedCategories: { category9: true }, assignments: { 'u-antigo': {} }, ...tarefa }
  }
  async get(caminho: string) {
    return caminho.endsWith('/details') ? { '@odata.etag': 'd1', description: this.descricao } : { '@odata.etag': 'e1', ...this.tarefa }
  }
  async paginado() {
    return []
  }
  async post(caminho: string, corpo: unknown) {
    this.gravacoes.push({ metodo: 'POST', caminho, corpo })
    return { id: 't-novo' }
  }
  async patch(caminho: string, corpo: unknown) {
    this.gravacoes.push({ metodo: 'PATCH', caminho, corpo })
    return {}
  }
  corpo(metodo: string, sufixo: string) {
    return this.gravacoes.filter((g) => g.metodo === metodo && g.caminho.endsWith(sufixo)).at(-1)?.corpo
  }
}

const atualizacao = (cartao: Partial<EventoPlanner['cartao']> = {}) => evento({ checklist: [], ...cartao }, { tipo: 'oportunidade_atualizada', versaoOrigem: 2 })
async function atualiza(graph: GraphFalso, cartao: Partial<EventoPlanner['cartao']> = {}, c: Partial<Contexto> = {}) {
  const plano = await planejar(atualizacao(cartao), ctx({ tarefaId: 't1', ...c }))
  if (plano.acao === 'ignorar') throw new Error('ignorado')
  await aplicar(graph, plano, 'PLANO1', new Date('2026-10-26T14:30:00Z'))
  return graph
}

describe('funções puras', () => {
  it('normaliza e resolve nomes: exato primeiro, depois sem caixa nem espaços, nunca ambíguo', () => {
    expect(resolveNome('GO', BUCKETS)).toBe('b-go')
    expect(resolveNome('em andamento (proposta entregue)', BUCKETS)).toBe('b-and')
    expect(resolveNome('Inexistente', BUCKETS)).toBeNull()
    expect(resolveNome('go', { GO: '1', Go: '2' })).toBeNull() // dois candidatos equivalentes: não adivinha
    expect(normaliza(' A b\tC ')).toBe('abc')
  })
  it('chave do título', () => {
    expect(chaveDoTitulo('[RAD-12] X | Y')).toBe('RAD-12')
    expect(chaveDoTitulo('[2026-0512] Órgão | Objeto')).toBe('2026-0512')
    expect(chaveDoTitulo('Nova oportunidade')).toBeNull()
  })
  it('valida o evento como o Python', () => {
    const planos = new Set(['PLANO1'])
    expect(() => validaEvento(evento(), planos)).not.toThrow()
    for (const mut of [
      (e: EventoPlanner) => ((e as { versao: string }).versao = '1'),
      (e: EventoPlanner) => (e.chave = 'X-1'),
      (e: EventoPlanner) => (e.plano = 'OUTRO'),
      (e: EventoPlanner) => (e.cartao.progresso = 30),
      (e: EventoPlanner) => (e.cartao.titulo = 'sem chave'),
    ]) {
      const e = evento()
      mut(e)
      expect(() => validaEvento(e, planos)).toThrow(EventoInvalido)
    }
  })
  it('carimbo no horário de Brasília', () => {
    expect(carimbo(new Date('2026-10-26T14:30:00Z'))).toBe('26/10/2026 11:30')
    expect(carimbo(new Date('2026-10-26T03:05:00Z'))).toBe('26/10/2026 00:05')
  })
})

describe('planejamento', () => {
  it('cria quando não existe; atualiza quando existe (pelo id guardado ou pelo [código] no plano)', async () => {
    const criar = await planejar(evento(), ctx())
    expect(criar).toMatchObject({ acao: 'criar', bucketId: 'b-go', responsaveisIds: ['u-julio.silva'], categorias: { category1: true, category2: true } })
    expect(await planejar(evento(), ctx({ tarefasPorChave: { 'RAD-7': [{ id: 't1' }] } }))).toMatchObject({ acao: 'atualizar', tarefaId: 't1' })
    expect(await planejar(evento(), ctx({ tarefaId: 't9' }))).toMatchObject({ acao: 'atualizar', tarefaId: 't9' })
  })
  it('ignora versão antiga ou repetida', async () => {
    expect((await planejar(evento(), ctx({ ultimaVersao: 1 }))).acao).toBe('ignorar')
    expect((await planejar(evento(), ctx({ ultimaVersao: 5 }))).acao).toBe('ignorar')
    expect((await planejar(evento({}, { versaoOrigem: 2 }), ctx({ ultimaVersao: 1 }))).acao).toBe('criar')
  })
  it('responsável nulo não altera; extras entram em todo cartão sem repetir', async () => {
    const sem = (await planejar(evento({ responsavel: null }), ctx({ tarefaId: 't1' }))) as Extract<Plano, { acao: 'atualizar' }>
    expect(sem.responsaveisIds).toEqual([])
    const com = (await planejar(evento(), ctx({ extras: ['x@x.com', 'julio.silva@ctctech.com.br'] }))) as Extract<Plano, { acao: 'criar' }>
    expect(com.responsaveisEmails).toEqual(['julio.silva@ctctech.com.br', 'x@x.com'])
  })
  it('erros que não adianta repetir: bucket, rótulo, responsável e cartão duplicado', async () => {
    await expect(planejar(evento({ bucket: 'Fantasma' }), ctx())).rejects.toThrow(EventoInvalido)
    await expect(planejar(evento({ rotulos: ['Fantasma'] }), ctx())).rejects.toThrow(EventoInvalido)
    await expect(planejar(evento(), ctx({ resolveUsuario: async () => null }))).rejects.toThrow(EventoInvalido)
    await expect(planejar(evento(), ctx({ tarefasPorChave: { 'RAD-7': [{ id: 'a' }, { id: 'b' }] } }))).rejects.toThrow(/mais de um cartão/)
  })
})

describe('regra de atualização (espelha o Python)', () => {
  it('sobrescreve título, bucket, progresso e prazo', async () => {
    const g = await atualiza(new GraphFalso(), { titulo: '[RAD-7] SEDES | Link | DATA: 05/11/2026' })
    const c = g.corpo('PATCH', '/planner/tasks/t1')
    expect(c).toMatchObject({ title: '[RAD-7] SEDES | Link | DATA: 05/11/2026', bucketId: 'b-go', percentComplete: 50, dueDateTime: '2026-11-05T12:00:00Z' })
  })
  it('mudar o status move o cartão; o que o time mexeu à mão em bucket e progresso é refeito', async () => {
    const g = await atualiza(new GraphFalso({ bucketId: 'b-and', percentComplete: 100 }), { bucket: 'GO', progresso: 50 })
    expect(g.corpo('PATCH', '/planner/tasks/t1')).toMatchObject({ bucketId: 'b-go', percentComplete: 50 })
    const g2 = await atualiza(new GraphFalso(), { bucket: 'NO GO', progresso: 100 })
    expect(g2.corpo('PATCH', '/planner/tasks/t1')).toMatchObject({ bucketId: 'b-nogo', percentComplete: 100 })
  })
  it('rótulos são acrescentados sem remover os do time', async () => {
    const g = await atualiza(new GraphFalso(), { rotulos: ['Licitação'] })
    expect(g.corpo('PATCH', '/planner/tasks/t1').appliedCategories).toEqual({ category9: true, category1: true })
  })
  it('responsáveis: só acrescenta; quem já está não é regravado; sem responsável não mexe', async () => {
    const g = await atualiza(new GraphFalso(), { responsavel: 'julio.silva@ctctech.com.br' })
    expect(Object.keys(g.corpo('PATCH', '/planner/tasks/t1').assignments)).toEqual(['u-julio.silva'])
    const g2 = await atualiza(new GraphFalso({ assignments: { 'u-julio.silva': {} } }), { responsavel: 'julio.silva@ctctech.com.br' })
    expect(g2.corpo('PATCH', '/planner/tasks/t1')).not.toHaveProperty('assignments')
    const g3 = await atualiza(new GraphFalso(), { responsavel: null })
    expect(g3.corpo('PATCH', '/planner/tasks/t1')).not.toHaveProperty('assignments')
  })
  it('prazo vazio no Radar não limpa o prazo do cartão', async () => {
    const g = await atualiza(new GraphFalso(), { prazo: null })
    expect(g.corpo('PATCH', '/planner/tasks/t1')).not.toHaveProperty('dueDateTime')
  })
  it('a nota é acrescentada com carimbo e não apaga o que o time escreveu; o checklist não é tocado', async () => {
    const g = await atualiza(new GraphFalso({}, 'Anotação escrita pelo time.'), { nota: 'Radar RAD-7 (v2) — status: Go.' })
    const d = g.corpo('PATCH', '/details').description as string
    expect(d.startsWith('Anotação escrita pelo time.\n\n--- Radar 26/10/2026 11:30 ---\n')).toBe(true)
    expect(d.endsWith('Radar RAD-7 (v2) — status: Go.')).toBe(true)
    expect(g.corpo('PATCH', '/details')).not.toHaveProperty('checklist')
  })
  it('a criação grava o checklist padrão e a nota nas anotações', async () => {
    const g = new GraphFalso()
    const plano = (await planejar(evento({ checklist: ['Análise de edital', 'Vistoria'], nota: 'Radar RAD-7 (v1)' }), ctx())) as Extract<Plano, { acao: 'criar' }>
    const r = await aplicar(g, plano, 'PLANO1')
    expect(r.tarefaId).toBe('t-novo')
    expect(g.corpo('POST', '/planner/tasks')).toMatchObject({ planId: 'PLANO1', bucketId: 'b-go' })
    const det = g.corpo('PATCH', '/details')
    expect(Object.values(det.checklist as Record<string, { title: string }>).map((i) => i.title).sort()).toEqual(['Análise de edital', 'Vistoria'])
    expect(det.description).toBe('Radar RAD-7 (v1)')
  })
  it('anotações cheias (30.000) perdem a nota nova: o fim é cortado', async () => {
    const g = await atualiza(new GraphFalso({}, 'x'.repeat(29990)), { nota: 'y'.repeat(200) })
    const d = g.corpo('PATCH', '/details').description as string
    expect(d).toHaveLength(30000)
    expect((d.match(/y/g) ?? []).length).toBe(0)
  })
  it('cartão apagado e [código] removido do título: o integrador não vê o cartão e recria (sem checklist)', async () => {
    const p = await planejar(atualizacao(), ctx({ tarefasPorChave: {}, ultimaVersao: 1 }))
    expect(p).toMatchObject({ acao: 'criar', checklist: [] })
  })
  it('mudar a torre cria cartão no outro plano e o antigo fica (a busca é só no plano do evento)', async () => {
    const origem = await planejar(evento(), ctx({ tarefasPorChave: { 'RAD-7': [{ id: 't-its' }] } }))
    expect(origem).toMatchObject({ acao: 'atualizar', tarefaId: 't-its' })
    expect((await planejar(evento(), ctx({ tarefasPorChave: {} }))).acao).toBe('criar')
  })
})
