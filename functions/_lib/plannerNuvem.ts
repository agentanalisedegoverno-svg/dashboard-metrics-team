/**
 * Planner em TEMPO REAL (modo nuvem): no instante em que alguém salva uma oportunidade da web, a própria API cria ou atualiza
 * o cartão (credencial de aplicação no Graph), sem esperar a rotina do Windows. Uma rotina de segurança no GitHub refaz o que
 * falhar. É a mesma regra do modo máquina (plannerSync.ts); aqui ficam o interruptor, a concessão que impede dois processos
 * de atualizar a mesma oportunidade ao mesmo tempo e o registro de tentativas.
 */
import { neon } from '@neondatabase/serverless'
import type { Sql } from './cadastro.ts'
import { graphApp, ErroGraph, type GraphLike } from './graph.ts'
import { montarEvento, type MapaPlanner, type OportunidadePlanner } from './planner.ts'
import { mapaPlanner } from './plannerMapa.ts'
import { aplicar, EventoInvalido, planejar, validaEvento, type ContextoPlano, type Plano } from './plannerSync.ts'

export const LEASE_SEGUNDOS = 180
export const MAX_TENTATIVAS = 5
export const MAX_PASSAGENS = 3

export type EnvPlanner = {
  DATABASE_URL_PLANNER?: string
  PLANNER_TENANT_ID?: string
  PLANNER_CLIENT_ID?: string
  PLANNER_CLIENT_SECRET?: string
  /** e-mails separados por vírgula, acrescentados como responsáveis de TODO cartão (equivale ao responsaveis_extras da máquina) */
  PLANNER_RESPONSAVEIS_EXTRAS?: string
}

export const plannerNuvemConfigurado = (env: EnvPlanner) =>
  Boolean(env.DATABASE_URL_PLANNER && env.PLANNER_TENANT_ID && env.PLANNER_CLIENT_ID && env.PLANNER_CLIENT_SECRET)

export const extrasDe = (env: EnvPlanner) =>
  (env.PLANNER_RESPONSAVEIS_EXTRAS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

// ----------------------------------------------------------------------------------------------- banco

export type Modo = { marco: string | null; modo: 'maquina' | 'nuvem' }

export async function lerModo(sql: Sql): Promise<Modo | null> {
  const [m] = await sql`select marco, modo from planner_marco where id = 1`
  return m ?? null
}

export type Reivindicada = { versaoExportada: number; tarefaId: string | null }

/**
 * Pega a oportunidade para este processo, numa única instrução atômica: só devolve linha se ela é elegível
 * (web, não arquivada, depois do marco), tem versão ainda não aplicada e ninguém mais está com ela (concessão de 3 min).
 */
export async function reivindicar(sql: Sql, id: number): Promise<Reivindicada | null> {
  const [r] = await sql`
    insert into planner_exportacao as e (oportunidade_id, versao_exportada, chave, em_processamento_ate)
    select o.id, 0, coalesce(o.codigo, 'RAD-' || o.id), now() + make_interval(secs => ${LEASE_SEGUNDOS}::int)
    from oportunidades o
    where o.id = ${id}::bigint and o.fonte = 'web' and o.arquivado_em is null and o.criado_em >= (select marco from planner_marco where id = 1)
    on conflict (oportunidade_id) do update
      set em_processamento_ate = now() + make_interval(secs => ${LEASE_SEGUNDOS}::int), atualizado_em = now()
      where e.versao_exportada < (select versao from oportunidades where id = ${id}::bigint)
        and e.tentativas < ${MAX_TENTATIVAS}::int
        and (e.em_processamento_ate is null or e.em_processamento_ate < now())
    returning e.versao_exportada, e.tarefa_id`
  return r ? { versaoExportada: Number(r.versao_exportada), tarefaId: r.tarefa_id ?? null } : null
}

type Dados = { o: OportunidadePlanner; email: string | null; arquivada: boolean }

export async function carregarOportunidade(sql: Sql, id: number): Promise<Dados | null> {
  const [r] = await sql`
    select o.id, o.codigo, o.versao, o.status, o.torre, o.orgao, o.descritivo, o.processo, o.uasg, o.data_pregao_dt::text as data_pregao_dt,
           o.analista, o.linha_servico, o.observacoes, o.orcamento::float8 as orcamento, coalesce(o.orcamento_sigiloso, false) as orcamento_sigiloso,
           (o.arquivado_em is not null) as arquivada,
           (select u.email from usuarios u where u.nome = o.analista and u.ativo and u.email is not null limit 1) as email_analista
    from oportunidades o where o.id = ${id}::bigint`
  if (!r) return null
  const { arquivada, email_analista, ...o } = r
  return { o: { ...o, versao: Number(o.versao) } as OportunidadePlanner, email: email_analista ?? null, arquivada: Boolean(arquivada) }
}

export const concluir = (sql: Sql, id: number, versao: number, tarefaId: string | null, planoId: string | null, aviso: string | null = null) =>
  sql`update planner_exportacao
      set versao_exportada = ${versao}::int, tarefa_id = coalesce(${tarefaId}, tarefa_id), plano_id = coalesce(${planoId}, plano_id),
          em_processamento_ate = null, tentativas = 0, ultimo_erro = ${aviso}, atualizado_em = now(), exportado_em = now()
      where oportunidade_id = ${id}::bigint`

export const falhar = (sql: Sql, id: number, mensagem: string, definitiva: boolean) =>
  sql`update planner_exportacao
      set em_processamento_ate = null, tentativas = case when ${definitiva} then ${MAX_TENTATIVAS}::int else tentativas + 1 end,
          ultimo_erro = ${mensagem.slice(0, 500)}, atualizado_em = now()
      where oportunidade_id = ${id}::bigint`

export const liberar = (sql: Sql, id: number) => sql`update planner_exportacao set em_processamento_ate = null where oportunidade_id = ${id}::bigint`

export async function versaoAtual(sql: Sql, id: number): Promise<number> {
  const [r] = await sql`select versao from oportunidades where id = ${id}::bigint`
  return r ? Number(r.versao) : 0
}

/** Oportunidades com versão ainda não aplicada (rotina de segurança). Nunca devolve as que já esgotaram as tentativas. */
export async function pendentes(sql: Sql, limite = 20): Promise<number[]> {
  const linhas = await sql`
    select o.id from oportunidades o
    left join planner_exportacao e on e.oportunidade_id = o.id
    where o.fonte = 'web' and o.arquivado_em is null and o.criado_em >= (select marco from planner_marco where id = 1)
      and (e.oportunidade_id is null
           or (o.versao > e.versao_exportada and e.tentativas < ${MAX_TENTATIVAS}::int and (e.em_processamento_ate is null or e.em_processamento_ate < now())))
    order by o.id limit ${limite}::int`
  return linhas.map((l: { id: number | string }) => Number(l.id))
}

/** Quantas oportunidades esgotaram as tentativas (precisam de gente). */
export async function emFalhaDefinitiva(sql: Sql): Promise<{ id: number; chave: string; ultimo_erro: string | null }[]> {
  return sql`select e.oportunidade_id as id, e.chave, e.ultimo_erro from planner_exportacao e join oportunidades o on o.id = e.oportunidade_id
             where e.tentativas >= ${MAX_TENTATIVAS}::int and o.versao > e.versao_exportada and o.arquivado_em is null order by e.oportunidade_id`
}

// --------------------------------------------------------------------------------------------- planner

type CachePlano = Map<string, { em: number; buckets: Record<string, string>; categorias: Record<string, string> }>
const cachePlanosGlobal: CachePlano = new Map()
const usuariosGlobal = new Map<string, string | null>()
const TTL_PLANO_MS = 10 * 60_000

export type DepsNuvem = {
  sql: Sql
  graph: GraphLike
  mapa?: MapaPlanner
  extras?: string[]
  agora?: () => Date
  cachePlanos?: CachePlano
  cacheUsuarios?: Map<string, string | null>
}

async function contextoDoPlano(d: DepsNuvem, planoId: string, listarCartoes: boolean): Promise<ContextoPlano> {
  const cache = d.cachePlanos ?? cachePlanosGlobal
  let c = cache.get(planoId)
  if (!c || Date.now() - c.em > TTL_PLANO_MS) {
    const [det, buckets] = await Promise.all([d.graph.get(`/planner/plans/${planoId}/details`), d.graph.paginado(`/planner/plans/${planoId}/buckets`)])
    c = {
      em: Date.now(),
      buckets: Object.fromEntries(buckets.map((b: { name: string; id: string }) => [b.name, b.id])),
      categorias: Object.fromEntries(Object.entries((det.categoryDescriptions ?? {}) as Record<string, string | null>).filter(([, nome]) => nome).map(([cat, nome]) => [nome as string, cat])),
    }
    cache.set(planoId, c)
  }
  const tarefasPorChave: ContextoPlano['tarefasPorChave'] = {}
  if (listarCartoes) {
    for (const t of await d.graph.paginado(`/planner/plans/${planoId}/tasks`)) {
      const m = /\[((?:\d{4}-\d{4,}|RAD-\d+))\]/.exec(t.title ?? '')
      if (m) (tarefasPorChave[m[1]] ??= []).push({ id: t.id })
    }
  }
  return { buckets: c.buckets, categorias: c.categorias, tarefasPorChave }
}

async function resolveUsuario(d: DepsNuvem, email: string): Promise<string | null> {
  const cache = d.cacheUsuarios ?? usuariosGlobal
  if (cache.has(email)) return cache.get(email) ?? null
  try {
    const u = await d.graph.get(`/users/${encodeURIComponent(email)}?$select=id`)
    cache.set(email, u.id ?? null)
  } catch (e) {
    if (e instanceof ErroGraph && e.status === 404) cache.set(email, null)
    else throw e // falha transitória: não guarda "inexistente"
  }
  return cache.get(email) ?? null
}

type Passagem = { tarefaId: string | null; planoId: string | null; acao: 'criar' | 'atualizar' | 'ignorar' | 'sem_plano'; aviso?: string }

async function aplicarUma(d: DepsNuvem, dados: Dados, claim: Reivindicada): Promise<Passagem> {
  const mapa = d.mapa ?? mapaPlanner
  const primeira = claim.versaoExportada === 0 && !claim.tarefaId
  const ev = montarEvento(dados.o, primeira ? 'oportunidade_nova' : 'oportunidade_atualizada', mapa, () => dados.email, (d.agora ?? (() => new Date()))())
  if (!ev) return { tarefaId: null, planoId: null, acao: 'sem_plano', aviso: `sem plano para a torre ${dados.o.torre ?? '(vazia)'}` }
  validaEvento(ev, new Set(Object.values(mapa.planos).map((p) => p.planId)))

  const planejarCom = async (tarefaId: string | null): Promise<Plano> =>
    planejar(ev, {
      ...(await contextoDoPlano(d, ev.plano, !tarefaId)),
      ultimaVersao: claim.versaoExportada || null,
      tarefaId,
      resolveUsuario: (email) => resolveUsuario(d, email),
      extras: d.extras ?? [],
    })

  let plano = await planejarCom(claim.tarefaId)
  if (plano.acao === 'ignorar') return { tarefaId: claim.tarefaId, planoId: ev.plano, acao: 'ignorar' }
  try {
    const r = await aplicar(d.graph, plano, ev.plano, (d.agora ?? (() => new Date()))())
    return { tarefaId: r.tarefaId, planoId: ev.plano, acao: plano.acao }
  } catch (e) {
    // O cartão que guardamos foi apagado no Planner: procura pelo [código]; se não houver, cria um novo (sem checklist).
    if (plano.acao === 'atualizar' && claim.tarefaId && e instanceof ErroGraph && e.status === 404) {
      plano = await planejarCom(null)
      if (plano.acao === 'ignorar') return { tarefaId: null, planoId: ev.plano, acao: 'ignorar' }
      const r = await aplicar(d.graph, plano, ev.plano, (d.agora ?? (() => new Date()))())
      return { tarefaId: r.tarefaId, planoId: ev.plano, acao: plano.acao }
    }
    throw e
  }
}

export type Resultado = {
  estado: 'desligado' | 'sem_pendencia' | 'aplicado' | 'sem_plano' | 'arquivada' | 'erro'
  acao?: string
  tarefaId?: string | null
  passagens?: number
  erro?: string
}

/** Mensagem segura para log e para o banco: sem segredos (o Graph não os devolve, mas corta o tamanho de qualquer jeito). */
export const mensagemSegura = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300)

export async function sincronizarOportunidade(d: DepsNuvem, id: number): Promise<Resultado> {
  const cfg = await lerModo(d.sql)
  if (!cfg?.marco || cfg.modo !== 'nuvem') return { estado: 'desligado' }
  let claim = await reivindicar(d.sql, id)
  if (!claim) return { estado: 'sem_pendencia' }
  let resultado: Resultado = { estado: 'sem_pendencia' }
  for (let passagem = 1; passagem <= MAX_PASSAGENS; passagem++) {
    const dados = await carregarOportunidade(d.sql, id)
    if (!dados || dados.arquivada) {
      await liberar(d.sql, id) // arquivada no meio do caminho: o cartão fica como está
      return { estado: 'arquivada', passagens: passagem }
    }
    try {
      const r = await aplicarUma(d, dados, claim)
      await concluir(d.sql, id, dados.o.versao, r.tarefaId, r.planoId, r.acao === 'sem_plano' ? (r.aviso ?? null) : null)
      resultado = { estado: r.acao === 'sem_plano' ? 'sem_plano' : 'aplicado', acao: r.acao, tarefaId: r.tarefaId, passagens: passagem }
    } catch (e) {
      const msg = mensagemSegura(e)
      await falhar(d.sql, id, msg, e instanceof EventoInvalido)
      return { estado: 'erro', erro: msg, passagens: passagem }
    }
    // Se alguém salvou de novo enquanto aplicávamos, a versão passou da que acabamos de aplicar: refaz com a final.
    if ((await versaoAtual(d.sql, id)) <= dados.o.versao) break
    const proxima = await reivindicar(d.sql, id)
    if (!proxima) break
    claim = proxima
  }
  return resultado
}

export async function sincronizarPendentes(d: DepsNuvem, limite = 20): Promise<{ id: number; resultado: Resultado }[]> {
  const cfg = await lerModo(d.sql)
  if (!cfg?.marco || cfg.modo !== 'nuvem') return []
  const ids = await pendentes(d.sql, limite)
  const out: { id: number; resultado: Resultado }[] = []
  for (const id of ids) out.push({ id, resultado: await sincronizarOportunidade(d, id) })
  return out
}

// -------------------------------------------------------------------------------------------- ligação com a API

export function depsDoAmbiente(env: EnvPlanner): DepsNuvem {
  return {
    sql: neon(env.DATABASE_URL_PLANNER as string) as unknown as Sql,
    graph: graphApp({ tenantId: env.PLANNER_TENANT_ID as string, clientId: env.PLANNER_CLIENT_ID as string, clientSecret: env.PLANNER_CLIENT_SECRET as string }),
    extras: extrasDe(env),
  }
}

/**
 * Chamado pela API depois de um Salvar bem-sucedido. Não faz nada se o modo nuvem não está configurado e NUNCA atrapalha a
 * resposta ao usuário: roda depois dela (waitUntil) e qualquer erro só vai para o log e para a fila de tentativas.
 */
/** Depois de um Salvar bem-sucedido: lê o id do registro devolvido (ou usa o da rota) e agenda a sincronização. */
export async function agendarAposSalvar(res: Response, env: EnvPlanner, waitUntil: ((p: Promise<unknown>) => void) | undefined, idDaRota?: string | number) {
  if (!res.ok || !waitUntil || !plannerNuvemConfigurado(env)) return
  let id: unknown = idDaRota
  if (id === undefined) id = ((await res.clone().json().catch(() => null)) as { id?: number } | null)?.id
  agendarPlanner(env, waitUntil, id as number | string | undefined)
}

export function agendarPlanner(env: EnvPlanner, waitUntil: ((p: Promise<unknown>) => void) | undefined, id: number | string | null | undefined) {
  const n = Number(id)
  if (!waitUntil || !plannerNuvemConfigurado(env) || !Number.isInteger(n) || n <= 0) return
  waitUntil(sincronizarOportunidade(depsDoAmbiente(env), n).catch((e) => console.error('Planner em tempo real:', mensagemSegura(e))))
}
