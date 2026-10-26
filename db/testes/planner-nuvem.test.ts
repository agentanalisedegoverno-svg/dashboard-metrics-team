/**
 * Planner em tempo real (modo nuvem) de ponta a ponta, SEM rede: um Planner simulado em memória e um banco real criado do
 * zero com as migrações. Cobre o interruptor de modo, a concessão (dois processos nunca atualizam a mesma oportunidade),
 * as falhas (transitória e definitiva), o cartão apagado, a edição no meio da sincronização e os privilégios do papel.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Sql } from '../../functions/_lib/cadastro.ts'
import { ErroGraph, type GraphLike } from '../../functions/_lib/graph.ts'
import {
  MAX_TENTATIVAS, concluir, emFalhaDefinitiva, lerModo, pendentes, reivindicar, sincronizarOportunidade, sincronizarPendentes, type DepsNuvem,
} from '../../functions/_lib/plannerNuvem.ts'
import { mapaPlanner } from '../../functions/_lib/plannerMapa.ts'
import { ADMIN, EDITOR, atualizar, como, criar, criarBanco, opp, type Db } from './banco.ts'

/** O cliente SQL (tagged template) em cima do PGlite: mesmo SQL que roda em produção. */
const sqlDe = (db: Db): Sql => (async (strings: TemplateStringsArray, ...valores: unknown[]) => {
  const texto = strings.reduce((a, s, i) => a + s + (i < valores.length ? `$${i + 1}` : ''), '')
  return (await db.query(texto, valores)).rows
}) as unknown as Sql

const PLANO_ITS = mapaPlanner.planos.its.planId
const PLANO_DH = mapaPlanner.planos.digital_health.planId

type Tarefa = { id: string; planId: string; title: string; bucketId: string; percentComplete: number; dueDateTime?: string; appliedCategories: Record<string, boolean>; assignments: Record<string, unknown>; descricao: string; checklist: Record<string, unknown> }

/** Planner em memória: planos com buckets e rótulos de verdade (do mapa), cartões, usuários, falhas injetáveis. */
class PlannerFalso implements GraphLike {
  tarefas = new Map<string, Tarefa>()
  usuarios: Record<string, string> = { 'editor@ctctech.com.br': 'u-editor', 'extra@ctctech.com.br': 'u-extra' }
  buckets: Record<string, Record<string, string>> = {}
  chamadas: string[] = []
  falhaNoPost: Error | null = null
  aoCriar: (() => Promise<void>) | null = null
  private n = 0
  constructor() {
    for (const p of Object.values(mapaPlanner.planos)) {
      this.buckets[p.planId] = Object.fromEntries([...new Set(Object.values(p.buckets))].map((nome) => [nome, 'b:' + nome]))
    }
  }
  private tarefa(id: string) {
    const t = this.tarefas.get(id)
    if (!t) throw new ErroGraph(`GET /planner/tasks/${id} -> HTTP 404`, 404)
    return t
  }
  async get(caminho: string) {
    this.chamadas.push('GET ' + caminho.split('?')[0])
    let m: RegExpExecArray | null
    if ((m = /^\/planner\/plans\/([^/]+)\/details$/.exec(caminho))) return { categoryDescriptions: { category1: 'Licitação', category2: 'Público', category3: 'DIGITAL', category4: 'Health', category5: null } }
    if ((m = /^\/users\/([^?]+)/.exec(caminho))) {
      const id = this.usuarios[decodeURIComponent(m[1])]
      if (!id) throw new ErroGraph(`GET /users -> HTTP 404`, 404)
      return { id }
    }
    if ((m = /^\/planner\/tasks\/([^/]+)\/details$/.exec(caminho))) return { '@odata.etag': 'd', description: this.tarefa(m[1]).descricao }
    if ((m = /^\/planner\/tasks\/([^/]+)$/.exec(caminho))) return { '@odata.etag': 'e', ...this.tarefa(m[1]) }
    throw new Error('GET não previsto: ' + caminho)
  }
  async paginado(caminho: string) {
    this.chamadas.push('LIST ' + caminho)
    let m: RegExpExecArray | null
    if ((m = /^\/planner\/plans\/([^/]+)\/buckets$/.exec(caminho))) return Object.entries(this.buckets[m[1]]).map(([name, id]) => ({ name, id }))
    if ((m = /^\/planner\/plans\/([^/]+)\/tasks$/.exec(caminho))) return [...this.tarefas.values()].filter((t) => t.planId === m![1]).map((t) => ({ id: t.id, title: t.title }))
    throw new Error('LIST não previsto: ' + caminho)
  }
  async post(caminho: string, corpo: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.chamadas.push('POST ' + caminho)
    if (this.falhaNoPost) throw this.falhaNoPost
    const id = `T${++this.n}`
    this.tarefas.set(id, { id, planId: corpo.planId, title: corpo.title, bucketId: corpo.bucketId, percentComplete: corpo.percentComplete, dueDateTime: corpo.dueDateTime, appliedCategories: corpo.appliedCategories ?? {}, assignments: corpo.assignments ?? {}, descricao: '', checklist: {} })
    await this.aoCriar?.()
    return { id }
  }
  async patch(caminho: string, corpo: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.chamadas.push('PATCH ' + caminho)
    let m: RegExpExecArray | null
    if ((m = /^\/planner\/tasks\/([^/]+)\/details$/.exec(caminho))) {
      const t = this.tarefa(m[1])
      if (corpo.description !== undefined) t.descricao = corpo.description
      if (corpo.checklist) t.checklist = { ...t.checklist, ...corpo.checklist }
      return {}
    }
    if ((m = /^\/planner\/tasks\/([^/]+)$/.exec(caminho))) {
      const t = this.tarefa(m[1])
      Object.assign(t, { title: corpo.title ?? t.title, bucketId: corpo.bucketId ?? t.bucketId, percentComplete: corpo.percentComplete ?? t.percentComplete })
      if (corpo.dueDateTime) t.dueDateTime = corpo.dueDateTime
      if (corpo.appliedCategories) t.appliedCategories = corpo.appliedCategories
      if (corpo.assignments) t.assignments = { ...t.assignments, ...corpo.assignments }
      return {}
    }
    throw new Error('PATCH não previsto: ' + caminho)
  }
  escritas = () => this.chamadas.filter((c) => c.startsWith('POST') || c.startsWith('PATCH'))
  cartoes = () => [...this.tarefas.values()]
}

let db: Db
let sql: Sql
let planner: PlannerFalso
let deps: DepsNuvem

// O banco é criado UMA vez (leva alguns segundos); entre os testes só se limpam as tabelas de dados.
beforeAll(async () => {
  db = await criarBanco()
  sql = sqlDe(db)
}, 120_000)

beforeEach(async () => {
  await db.exec(`delete from planner_exportacao; delete from email_fila; delete from oportunidades_historico; delete from oportunidades;`)
  planner = new PlannerFalso()
  deps = { sql, graph: planner, cachePlanos: new Map(), cacheUsuarios: new Map(), extras: [], agora: () => new Date('2026-10-26T14:30:00Z') }
  await db.exec(`update planner_marco set marco = now() - interval '1 hour', modo = 'nuvem' where id = 1`)
})

const linhaExportacao = async (id: number) => (await db.query<Record<string, any>>('select * from planner_exportacao where oportunidade_id = $1', [id])).rows[0] // eslint-disable-line @typescript-eslint/no-explicit-any
const nova = (extra: Record<string, unknown> = {}) => criar(db, opp({ orgao: 'SEDES', analista: 'Editor', status: 'Go', ...extra }), EDITOR)

describe('interruptor de modo', () => {
  it('nasce em "maquina": a nuvem não age enquanto não for ligada', async () => {
    await db.exec(`update planner_marco set modo = 'maquina' where id = 1`)
    const o = await nova()
    expect(await sincronizarOportunidade(deps, o.id)).toMatchObject({ estado: 'desligado' })
    expect(planner.chamadas).toEqual([])
    expect(await linhaExportacao(o.id)).toBeUndefined()
  })
  it('sem marco (integração nunca ativada) também não age; o modo só aceita os dois valores', async () => {
    await db.exec(`update planner_marco set marco = null where id = 1`)
    expect((await sincronizarOportunidade(deps, (await nova()).id)).estado).toBe('desligado')
    await expect(db.exec(`update planner_marco set modo = 'qualquer'`)).rejects.toThrow()
    expect((await lerModo(sql))?.modo).toBe('nuvem')
  })
  it('a migração não muda o comportamento: a instalação existente continua em "maquina"', async () => {
    const fresco = await criarBanco()
    expect((await lerModo(sqlDe(fresco)))?.modo).toBe('maquina')
  }, 60_000)
})

describe('criar e atualizar o cartão no instante do Salvar', () => {
  it('oportunidade nova vira cartão: bucket do status, progresso, responsável, checklist e a marca de exportada', async () => {
    const o = await nova()
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r).toMatchObject({ estado: 'aplicado', acao: 'criar' })
    const [c] = planner.cartoes()
    expect(c.planId).toBe(PLANO_ITS)
    expect(c.title.startsWith(`[${o.codigo}] SEDES`)).toBe(true)
    expect(c).toMatchObject({ bucketId: 'b:GO', percentComplete: 50, assignments: { 'u-editor': expect.anything() } })
    expect(Object.keys(c.checklist)).toHaveLength(7)
    expect(await linhaExportacao(o.id)).toMatchObject({ versao_exportada: o.versao, tarefa_id: c.id, plano_id: PLANO_ITS, tentativas: 0, em_processamento_ate: null, ultimo_erro: null })
  })

  it('mudar o status atualiza o MESMO cartão (move de coluna, 100%, nota nova) e o checklist do time é preservado', async () => {
    const o = await nova()
    await sincronizarOportunidade(deps, o.id)
    const [c] = planner.cartoes()
    c.checklist = { x: { title: 'item do time', isChecked: true } }
    c.descricao = 'Anotação do time.'
    const v2 = await atualizar(db, o.id, o.versao, opp({ orgao: 'SEDES', analista: 'Editor', status: 'Win', valor_ctc: 100 }), EDITOR)
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r).toMatchObject({ estado: 'aplicado', acao: 'atualizar', tarefaId: c.id })
    expect(planner.cartoes()).toHaveLength(1)
    expect(c).toMatchObject({ bucketId: 'b:Ganhos!', percentComplete: 100 })
    expect(c.checklist).toEqual({ x: { title: 'item do time', isChecked: true } })
    expect(c.descricao.startsWith('Anotação do time.\n\n--- Radar 26/10/2026 11:30 ---\n')).toBe(true)
    expect((await linhaExportacao(o.id)).versao_exportada).toBe(v2.versao)
  })

  it('sem versão nova não faz nada (idempotente): chamar de novo não escreve no Planner', async () => {
    const o = await nova()
    await sincronizarOportunidade(deps, o.id)
    const escritas = planner.escritas().length
    expect((await sincronizarOportunidade(deps, o.id)).estado).toBe('sem_pendencia')
    expect(planner.escritas()).toHaveLength(escritas)
  })

  it('o que o time mexeu à mão em coluna e progresso é refeito no próximo salvamento (a regra documentada)', async () => {
    const o = await nova()
    await sincronizarOportunidade(deps, o.id)
    const [c] = planner.cartoes()
    c.bucketId = 'b:SUSPENSOS'
    c.percentComplete = 100
    await atualizar(db, o.id, o.versao, opp({ orgao: 'SEDES', analista: 'Editor', status: 'Go', observacoes: 'só uma observação' }), EDITOR)
    await sincronizarOportunidade(deps, o.id)
    expect(c).toMatchObject({ bucketId: 'b:GO', percentComplete: 50 })
  })

  it('torre DIGITAL vai para o outro plano, com o rótulo da torre', async () => {
    const o = await nova({ torre: 'DIGITAL', linha_servico: undefined })
    await sincronizarOportunidade(deps, o.id)
    const [c] = planner.cartoes()
    expect(c.planId).toBe(PLANO_DH)
    expect(Object.keys(c.appliedCategories).sort()).toEqual(['category1', 'category2', 'category3'])
  })

  it('responsáveis extras (PLANNER_RESPONSAVEIS_EXTRAS) entram em todo cartão', async () => {
    const o = await nova()
    await sincronizarOportunidade({ ...deps, extras: ['extra@ctctech.com.br'] }, o.id)
    expect(Object.keys(planner.cartoes()[0].assignments).sort()).toEqual(['u-editor', 'u-extra'])
  })
})

describe('quem pode e quem não pode ser enviado', () => {
  it('só web, depois do marco e não arquivada; restaurada volta', async () => {
    await db.query(`select sincronizar_planilha('[{"chave_planilha":"pl","status":"Go","orgao":"Planilha","descritivo":"x","torre":"ITS","data_pregao_dt":"2026-04-01"}]'::jsonb,'t',false)`)
    const pl = (await db.query<{ id: number }>(`select id from oportunidades where chave_planilha = 'pl'`)).rows[0].id
    expect((await sincronizarOportunidade(deps, pl)).estado).toBe('sem_pendencia')

    const antiga = await nova({ orgao: 'Antes do marco' })
    await db.query(`update oportunidades set criado_em = now() - interval '1 day' where id = $1`, [antiga.id])
    expect((await sincronizarOportunidade(deps, antiga.id)).estado).toBe('sem_pendencia')

    const o = await nova({ orgao: 'Vai arquivar' })
    await sincronizarOportunidade(deps, o.id)
    await db.query('select arquivar_oportunidade($1::bigint, $2, false)', [o.id, ADMIN])
    expect((await sincronizarOportunidade(deps, o.id)).estado).toBe('sem_pendencia')
    expect(await pendentes(sql)).not.toContain(o.id)
    await db.query('select arquivar_oportunidade($1::bigint, $2, true)', [o.id, ADMIN])
    expect(await pendentes(sql)).toContain(o.id)
    expect((await sincronizarOportunidade(deps, o.id)).acao).toBe('atualizar')
    expect(planner.cartoes()).toHaveLength(1)
  })

  it('torre sem plano não vai ao Planner e não fica tentando para sempre', async () => {
    const o = await nova()
    await db.query(`update oportunidades set torre = 'XPTO' where id = $1`, [o.id])
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r.estado).toBe('sem_plano')
    expect(planner.escritas()).toEqual([])
    expect(await linhaExportacao(o.id)).toMatchObject({ tentativas: 0, em_processamento_ate: null })
    expect((await linhaExportacao(o.id)).ultimo_erro).toContain('sem plano')
    expect(await pendentes(sql)).not.toContain(o.id)
  })
})

describe('concorrência: dois processos nunca atualizam a mesma oportunidade ao mesmo tempo', () => {
  it('duas sincronizações simultâneas da mesma oportunidade criam UM cartão só', async () => {
    const o = await nova()
    const [a, b] = await Promise.all([sincronizarOportunidade(deps, o.id), sincronizarOportunidade(deps, o.id)])
    expect([a.estado, b.estado].sort()).toEqual(['aplicado', 'sem_pendencia'])
    expect(planner.cartoes()).toHaveLength(1)
  })

  it('a reivindicação é atômica: só um ganha; a concessão vence sozinha depois de 3 minutos', async () => {
    const o = await nova()
    const [x, y] = await Promise.all([reivindicar(sql, o.id), reivindicar(sql, o.id)])
    expect([x, y].filter(Boolean)).toHaveLength(1)
    expect(await reivindicar(sql, o.id)).toBeNull() // ainda com a concessão do primeiro
    await db.query(`update planner_exportacao set em_processamento_ate = now() - interval '1 second' where oportunidade_id = $1`, [o.id])
    expect(await reivindicar(sql, o.id)).toMatchObject({ versaoExportada: 0 })
  })

  it('se alguém salva de novo enquanto o cartão é criado, a versão final também é aplicada (sem esperar a rotina)', async () => {
    const o = await nova({ orgao: 'Editada no meio' })
    let versao = o.versao as number
    planner.aoCriar = async () => {
      planner.aoCriar = null
      versao = (await atualizar(db, o.id, versao, opp({ orgao: 'Editada no meio', analista: 'Editor', status: 'Win', valor_ctc: 5 }), EDITOR)).versao
    }
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r.passagens).toBe(2)
    expect(planner.cartoes()).toHaveLength(1)
    expect(planner.cartoes()[0]).toMatchObject({ bucketId: 'b:Ganhos!', percentComplete: 100 })
    expect((await linhaExportacao(o.id)).versao_exportada).toBe(versao)
  })
})

describe('falhas', () => {
  it('falha transitória (Graph 503) conta a tentativa, solta a concessão e a rotina de segurança refaz', async () => {
    const o = await nova()
    planner.falhaNoPost = new ErroGraph('POST /planner/tasks -> HTTP 503', 503)
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r.estado).toBe('erro')
    expect(await linhaExportacao(o.id)).toMatchObject({ tentativas: 1, em_processamento_ate: null, versao_exportada: 0 })
    expect(planner.cartoes()).toHaveLength(0)
    planner.falhaNoPost = null
    const rodada = await sincronizarPendentes(deps)
    expect(rodada).toHaveLength(1)
    expect(rodada[0].resultado.estado).toBe('aplicado')
    expect(await linhaExportacao(o.id)).toMatchObject({ tentativas: 0, ultimo_erro: null })
  })

  it('erro que não adianta repetir (coluna renomeada) vai direto para falha definitiva e aparece para a equipe', async () => {
    const o = await nova()
    delete planner.buckets[PLANO_ITS]['GO'] // alguém renomeou a coluna no Planner
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r).toMatchObject({ estado: 'erro' })
    expect(r.erro).toContain('bucket não encontrado')
    expect(await linhaExportacao(o.id)).toMatchObject({ tentativas: MAX_TENTATIVAS })
    expect(await pendentes(sql)).not.toContain(o.id)
    expect((await emFalhaDefinitiva(sql)).map((x) => x.id)).toEqual([o.id])
    // corrigida a causa, a equipe zera a contagem e a próxima rodada aplica
    planner.buckets[PLANO_ITS]['GO'] = 'b:GO'
    deps.cachePlanos!.clear()
    await db.query(`update planner_exportacao set tentativas = 0 where oportunidade_id = $1`, [o.id])
    expect((await sincronizarOportunidade(deps, o.id)).estado).toBe('aplicado')
    expect(await emFalhaDefinitiva(sql)).toEqual([])
  })

  it('esgotadas as tentativas de uma falha transitória, para de tentar', async () => {
    const o = await nova()
    planner.falhaNoPost = new ErroGraph('POST -> HTTP 500', 500)
    for (let i = 0; i < MAX_TENTATIVAS + 2; i++) await sincronizarOportunidade(deps, o.id)
    expect((await linhaExportacao(o.id)).tentativas).toBe(MAX_TENTATIVAS)
    expect(planner.chamadas.filter((c) => c.startsWith('POST'))).toHaveLength(MAX_TENTATIVAS)
  })

  it('responsável inexistente no Entra é falha definitiva, com o motivo guardado', async () => {
    const o = await nova()
    delete planner.usuarios['editor@ctctech.com.br']
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r.erro).toContain('responsável não encontrado')
    expect((await linhaExportacao(o.id)).ultimo_erro).toContain('responsável não encontrado')
  })

  it('cartão guardado foi apagado no Planner: o próximo salvamento recria, sem o checklist padrão', async () => {
    const o = await nova()
    await sincronizarOportunidade(deps, o.id)
    const [antigo] = planner.cartoes()
    planner.tarefas.delete(antigo.id)
    await atualizar(db, o.id, o.versao, opp({ orgao: 'SEDES', analista: 'Editor', status: 'Go', observacoes: 'mudou' }), EDITOR)
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r).toMatchObject({ estado: 'aplicado', acao: 'criar' })
    const [novo] = planner.cartoes()
    expect(novo.id).not.toBe(antigo.id)
    expect(novo.checklist).toEqual({})
    expect((await linhaExportacao(o.id)).tarefa_id).toBe(novo.id)
  })

  it('cartão criado antes pela máquina (sem id guardado) é achado pelo [código] e atualizado, sem duplicar', async () => {
    const o = await nova()
    planner.tarefas.set('T-da-maquina', { id: 'T-da-maquina', planId: PLANO_ITS, title: `[${o.codigo}] SEDES | antigo`, bucketId: 'b:Prospect', percentComplete: 0, appliedCategories: {}, assignments: {}, descricao: '', checklist: {} })
    // a máquina já tinha exportado a versão 1 (linha sem tarefa_id)
    await db.query(`insert into planner_exportacao (oportunidade_id, versao_exportada, chave) values ($1, $2, $3)`, [o.id, o.versao, o.codigo])
    const v2 = await atualizar(db, o.id, o.versao, opp({ orgao: 'SEDES', analista: 'Editor', status: 'Go', observacoes: 'depois da virada' }), EDITOR)
    const r = await sincronizarOportunidade(deps, o.id)
    expect(r).toMatchObject({ estado: 'aplicado', acao: 'atualizar', tarefaId: 'T-da-maquina' })
    expect(planner.cartoes()).toHaveLength(1)
    expect(planner.tarefas.get('T-da-maquina')).toMatchObject({ bucketId: 'b:GO', percentComplete: 50 })
    expect(await linhaExportacao(o.id)).toMatchObject({ tarefa_id: 'T-da-maquina', versao_exportada: v2.versao })
  })
})

describe('rotina de segurança (pendentes)', () => {
  it('refaz o que a API não conseguiu, em ordem, com limite, e ignora o que já está em dia', async () => {
    const a = await nova({ orgao: 'A' })
    const b = await nova({ orgao: 'B' })
    const c = await nova({ orgao: 'C' })
    await sincronizarOportunidade(deps, a.id) // A já em dia
    expect(await pendentes(sql)).toEqual([b.id, c.id])
    expect(await pendentes(sql, 1)).toEqual([b.id])
    const rodada = await sincronizarPendentes(deps)
    expect(rodada.map((r) => r.id)).toEqual([b.id, c.id])
    expect(planner.cartoes()).toHaveLength(3)
    expect(await pendentes(sql)).toEqual([])
  })
  it('modo máquina: a rotina da nuvem não faz nada', async () => {
    await nova()
    await db.exec(`update planner_marco set modo = 'maquina'`)
    expect(await sincronizarPendentes(deps)).toEqual([])
  })
})

describe('privilégios (papel radar_planner, o mínimo)', () => {
  it('o fluxo inteiro funciona com o papel de mínimo privilégio, que não altera oportunidades', async () => {
    const o = await nova()
    await como(db, 'radar_planner', async () => {
      expect((await sincronizarOportunidade(deps, o.id)).estado).toBe('aplicado')
      await atualizar(db, o.id, o.versao, opp(), EDITOR).then(
        () => { throw new Error('radar_planner não deveria conseguir executar funções de cadastro') },
        (e) => expect(String(e.message)).toMatch(/permission denied/i),
      )
    })
    await expect(como(db, 'radar_planner', () => db.query(`update oportunidades set orgao = 'x'`))).rejects.toThrow(/permission denied/i)
  })
  it('a aplicação (radar_app) e o painel não alteram nem leem o controle do Planner', async () => {
    await expect(como(db, 'radar_app', () => db.query(`insert into planner_exportacao (oportunidade_id, versao_exportada, chave) values (1, 1, 'x')`))).rejects.toThrow(/permission denied/i)
    await expect(como(db, 'radar_leitor', () => db.query(`select * from planner_exportacao`))).rejects.toThrow(/permission denied/i)
  })
  it('concluir grava a versão aplicada, o id do cartão e zera as tentativas', async () => {
    const o = await nova()
    await reivindicar(sql, o.id)
    await concluir(sql, o.id, o.versao, 'T9', PLANO_ITS)
    expect(await linhaExportacao(o.id)).toMatchObject({ versao_exportada: o.versao, tarefa_id: 'T9', plano_id: PLANO_ITS, em_processamento_ate: null })
  })
})
