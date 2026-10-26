/**
 * Regra de atualização do cartão do Planner (docs/INTEGRACAO-PLANNER.md), em TypeScript, para o modo nuvem.
 * É a MESMA regra de planner-auto/planner_auto.py (`planeja` e `aplica`), e os testes dos dois lados descrevem os mesmos
 * cenários: sobrescreve título, coluna, progresso e prazo; acrescenta rótulos, responsáveis e anotações; nunca remove;
 * checklist só na criação. Nada aqui lê banco: recebe o evento já montado (`montarEvento`) e um cliente do Graph.
 */
import type { EventoPlanner } from './planner.ts'
import type { GraphLike } from './graph.ts'

export const CHAVE_RE = /\[((?:\d{4}-\d{4,}|RAD-\d+))\]/
const ASSIGN = { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' }

/** Compara nomes sem caixa nem espaços (ex.: "Em andamento ( Proposta Entregue)"). */
export const normaliza = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

/** candidatos: {nome: id}. Nome exato primeiro, depois comparação normalizada (só se for inequívoca); null se não achar. */
export function resolveNome(nome: string, candidatos: Record<string, string>): string | null {
  if (nome in candidatos) return candidatos[nome]
  const alvo = normaliza(nome)
  const achados = Object.entries(candidatos).filter(([k]) => normaliza(k) === alvo)
  return achados.length === 1 ? achados[0][1] : null
}

export const chaveDoTitulo = (titulo: string | null | undefined) => CHAVE_RE.exec(titulo ?? '')?.[1] ?? null

/** Evento que não pode ser aplicado (bucket, rótulo ou responsável inexistente, cartão duplicado...): não adianta repetir. */
export class EventoInvalido extends Error {}

export type ContextoPlano = {
  buckets: Record<string, string>
  /** nome do rótulo -> "categoryN" */
  categorias: Record<string, string>
  /** só preenchido quando o cartão não é conhecido pelo id: cartões do plano agrupados pelo [código] do título */
  tarefasPorChave: Record<string, { id: string }[]>
}

export type Contexto = ContextoPlano & {
  /** última versão já aplicada para esse código (null = nunca) */
  ultimaVersao: number | null
  /** id do cartão, quando já se sabe (guardado no banco); evita listar o plano inteiro */
  tarefaId?: string | null
  resolveUsuario: (email: string) => Promise<string | null>
  /** pessoas acrescentadas a TODO cartão, além do pré-vendas (PLANNER_RESPONSAVEIS_EXTRAS) */
  extras: string[]
}

export type Plano =
  | { acao: 'ignorar'; motivo: string }
  | {
      acao: 'criar' | 'atualizar'
      tarefaId?: string
      chave: string
      versaoOrigem: number
      bucketId: string
      bucketNome: string
      categorias: Record<string, true>
      responsaveisIds: string[]
      responsaveisEmails: string[]
      titulo: string
      prazo: string | null
      progresso: number
      nota: string
      checklist: string[]
    }

export function validaEvento(ev: EventoPlanner, planosConhecidos: Set<string>) {
  if (ev.versao !== '2') throw new EventoInvalido(`versão de contrato não suportada: ${ev.versao}`)
  if (!/^(?:\d{4}-\d{4,}|RAD-\d+)$/.test(ev.chave)) throw new EventoInvalido(`chave inválida: ${ev.chave}`)
  if (!planosConhecidos.has(ev.plano)) throw new EventoInvalido(`plano fora da configuração: ${ev.plano}`)
  if (!ev.cartao.titulo || !ev.cartao.bucket) throw new EventoInvalido('cartao.titulo e cartao.bucket são obrigatórios')
  if (![0, 50, 100].includes(ev.cartao.progresso)) throw new EventoInvalido(`progresso deve ser 0, 50 ou 100 (veio ${ev.cartao.progresso})`)
  if (!ev.cartao.titulo.startsWith(`[${ev.chave}]`)) throw new EventoInvalido('o título deve começar com [chave]')
}

export async function planejar(ev: EventoPlanner, ctx: Contexto): Promise<Plano> {
  const c = ev.cartao
  if (ctx.ultimaVersao != null && ev.versaoOrigem <= ctx.ultimaVersao) {
    return { acao: 'ignorar', motivo: `versaoOrigem ${ev.versaoOrigem} <= última aplicada (${ctx.ultimaVersao})` }
  }
  const bucketId = resolveNome(c.bucket, ctx.buckets)
  if (!bucketId) throw new EventoInvalido(`bucket não encontrado no plano: ${c.bucket}`)
  const categorias: Record<string, true> = {}
  for (const rotulo of c.rotulos) {
    const cat = resolveNome(rotulo, ctx.categorias)
    if (!cat) throw new EventoInvalido(`rótulo não encontrado no plano: ${rotulo}`)
    categorias[cat] = true
  }
  // Responsável vazio/nulo não altera a atribuição; os extras entram em todo cartão.
  const emails = c.responsavel ? [c.responsavel] : []
  for (const extra of ctx.extras) if (!emails.includes(extra)) emails.push(extra)
  const responsaveisIds: string[] = []
  for (const email of emails) {
    const uid = await ctx.resolveUsuario(email)
    if (!uid) throw new EventoInvalido(`responsável não encontrado no Entra: ${email}`)
    responsaveisIds.push(uid)
  }
  const existentes = ctx.tarefaId ? [{ id: ctx.tarefaId }] : (ctx.tarefasPorChave[ev.chave] ?? [])
  if (existentes.length > 1) throw new EventoInvalido(`mais de um cartão com a chave ${ev.chave}: ${existentes.map((t) => t.id).join(', ')}`)
  const base = {
    chave: ev.chave, versaoOrigem: ev.versaoOrigem, bucketId, bucketNome: c.bucket, categorias, responsaveisIds, responsaveisEmails: emails,
    titulo: c.titulo, prazo: c.prazo, progresso: c.progresso, nota: c.nota, checklist: c.checklist,
  }
  return existentes.length ? { acao: 'atualizar', tarefaId: existentes[0].id, ...base } : { acao: 'criar', ...base }
}

/** "dd/mm/aaaa hh:mm" no fuso de Brasília (o Planner do time é lido em horário de Brasília). */
export function carimbo(agora: Date): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  )
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour === '24' ? '00' : partes.hour}:${partes.minute}`
}

export type Aplicado = { tarefaId: string; antes?: Record<string, unknown>; depois?: Record<string, unknown> }

/** Executa a escrita no Planner. */
export async function aplicar(graph: GraphLike, p: Extract<Plano, { acao: 'criar' | 'atualizar' }>, planoId: string, agora = new Date()): Promise<Aplicado> {
  if (p.acao === 'criar') {
    const corpo: Record<string, unknown> = { planId: planoId, bucketId: p.bucketId, title: p.titulo, percentComplete: p.progresso }
    if (p.prazo) corpo.dueDateTime = p.prazo
    if (Object.keys(p.categorias).length) corpo.appliedCategories = p.categorias
    if (p.responsaveisIds.length) corpo.assignments = Object.fromEntries(p.responsaveisIds.map((u) => [u, ASSIGN]))
    const tarefa = await graph.post('/planner/tasks', corpo)
    const det = await graph.get(`/planner/tasks/${tarefa.id}/details`)
    const corpoDet: Record<string, unknown> = { description: p.nota.slice(0, 30000) }
    if (p.checklist.length) {
      corpoDet.checklist = Object.fromEntries(
        p.checklist.slice(0, 20).map((item) => [crypto.randomUUID(), { '@odata.type': 'microsoft.graph.plannerChecklistItem', title: item.slice(0, 100), isChecked: false }]),
      )
    }
    await graph.patch(`/planner/tasks/${tarefa.id}/details`, corpoDet, det['@odata.etag'])
    return { tarefaId: tarefa.id }
  }

  const t = await graph.get(`/planner/tasks/${p.tarefaId}`)
  const corpo: Record<string, unknown> = { title: p.titulo, bucketId: p.bucketId, percentComplete: p.progresso }
  if (p.prazo) corpo.dueDateTime = p.prazo
  if (Object.keys(p.categorias).length) corpo.appliedCategories = { ...(t.appliedCategories ?? {}), ...p.categorias }
  const novos = p.responsaveisIds.filter((u) => !(u in (t.assignments ?? {})))
  if (novos.length) corpo.assignments = Object.fromEntries(novos.map((u) => [u, ASSIGN])) // só acrescenta; nunca remove quem já estava
  const antes = { title: t.title, bucketId: t.bucketId, percentComplete: t.percentComplete, dueDateTime: t.dueDateTime }
  await graph.patch(`/planner/tasks/${p.tarefaId}`, corpo, t['@odata.etag'])
  if (p.nota) {
    const det = await graph.get(`/planner/tasks/${p.tarefaId}/details`)
    const antiga: string = det.description ?? ''
    await graph.patch(`/planner/tasks/${p.tarefaId}/details`, { description: `${antiga}\n\n--- Radar ${carimbo(agora)} ---\n${p.nota}`.slice(0, 30000) }, det['@odata.etag'])
  }
  return { tarefaId: p.tarefaId!, antes, depois: { title: corpo.title, bucketId: corpo.bucketId, percentComplete: corpo.percentComplete, dueDateTime: corpo.dueDateTime } }
}
