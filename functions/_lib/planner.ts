/**
 * Radar -> Planner: converte uma oportunidade em um evento v2 (arquivo JSON consumido pelo
 * `processar-eventos` do planner-auto). Função pura e testável; nada aqui fala com a rede.
 */
import { nomesPreVendas } from '../../src/domain/preVendas.ts'

export type MapaPlanner = {
  planos: Record<
    string,
    {
      nome: string
      planId: string
      torres: string[]
      rotulos: string[]
      rotulosPorTorre?: Record<string, string[]>
      buckets: Record<string, string>
    }
  >
  progresso: Record<string, number>
  checklistPadrao: string[]
}

export type OportunidadePlanner = {
  id: number
  codigo?: string | null
  versao: number
  status: string | null
  torre: string | null
  orgao: string | null
  descritivo: string | null
  /** O que está sendo contratado (campo Objeto); em branco, o título usa o descritivo como sempre usou. */
  objeto?: string | null
  processo: string | null
  uasg: string | null
  data_pregao_dt: string | null
  /** Hora local de Brasília (HH:MM ou HH:MM:SS); em branco nas oportunidades que vieram da planilha. */
  hora_pregao?: string | null
  analista: string | null
  linha_servico: string | null
  observacoes: string | null
  orcamento: number | null
  orcamento_sigiloso: boolean
}

export type EventoPlanner = {
  versao: '2'
  tipo: 'oportunidade_nova' | 'oportunidade_atualizada'
  chave: string
  origem: 'Radar'
  /** Versão da oportunidade no Radar: o consumidor ignora eventos com versão menor que a última aplicada. */
  versaoOrigem: number
  geradoEm: string
  plano: string
  planoNome: string
  cartao: {
    titulo: string
    status: string
    bucket: string
    progresso: number
    prazo: string | null
    responsavel: string | null
    /** Todos os pré-vendas com e-mail (o primeiro é o `responsavel`); vazio não altera a atribuição. */
    responsaveis: string[]
    rotulos: string[]
    nota: string
    checklist: string[]
  }
}

/** Chave estável do cartão (aparece entre colchetes no início do título): o código AAAA-NNNN da oportunidade;
 * `RAD-<id>` só como reserva para registros sem código (legado). */
export const chaveRadar = (id: number) => `RAD-${id}`
export const chaveDe = (o: Pick<OportunidadePlanner, 'id' | 'codigo'>) => o.codigo || chaveRadar(o.id)

const limpa = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const corta = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const dataBr = (iso: string) => iso.split('-').reverse().join('/')
const hhmm = (hora: string | null | undefined) => (hora ? hora.slice(0, 5) : '')

/** Prazo do cartão: com hora, o instante do pregão (Brasília é UTC-3, sem horário de verão); sem hora, o meio-dia UTC de sempre. */
export function prazoDoCartao(data: string | null, hora: string | null | undefined): string | null {
  if (!data) return null
  const h = hhmm(hora)
  return h ? new Date(`${data}T${h}:00-03:00`).toISOString().replace('.000Z', 'Z') : `${data}T12:00:00Z`
}

/** "[RADAR código] ÓRGÃO | OBJETO | PE: processo Uasg: x | dd/mm/aaaa - hh:mm" (sem hora, só a data). */
export function tituloCartao(o: OportunidadePlanner): string {
  const partes = [
    limpa(o.orgao) || 'Órgão não informado',
    corta(limpa(o.objeto) || limpa(o.descritivo) || 'Objeto não informado', 100),
    [o.processo ? `PE: ${limpa(o.processo)}` : '', o.uasg ? `Uasg: ${limpa(o.uasg)}` : ''].filter(Boolean).join(' '),
    o.data_pregao_dt ? `${dataBr(o.data_pregao_dt)}${hhmm(o.hora_pregao) ? ` - ${hhmm(o.hora_pregao)}` : ''}` : '',
  ].filter(Boolean)
  return `[RADAR ${chaveDe(o)}] ${partes.join(' | ')}`.slice(0, 255)
}

export function planoDaTorre(mapa: MapaPlanner, torre: string | null) {
  if (!torre) return null
  const t = torre.trim().toUpperCase()
  const achado = Object.entries(mapa.planos).find(([, p]) => p.torres.includes(t))
  return achado ? { chave: achado[0], ...achado[1] } : null
}

export function montarEvento(
  o: OportunidadePlanner,
  tipo: EventoPlanner['tipo'],
  mapa: MapaPlanner,
  emailDoAnalista: (nome: string) => string | null,
  agora = new Date(),
): EventoPlanner | null {
  const plano = planoDaTorre(mapa, o.torre)
  if (!plano) return null
  const responsaveis = [...new Set(nomesPreVendas(o.analista).map((n) => emailDoAnalista(n)).filter((x): x is string => !!x))]
  const status = o.status ?? '_sem_status'
  const bucket = plano.buckets[status] ?? plano.buckets._sem_status
  const rotulos = [...plano.rotulos, ...(plano.rotulosPorTorre?.[o.torre!.trim().toUpperCase()] ?? [])]
  const nota = [
    `Radar ${chaveDe(o)} (v${o.versao}) — status: ${o.status ?? 'sem status'}.`,
    o.linha_servico ? `Linha de serviço: ${limpa(o.linha_servico)}.` : '',
    o.orcamento_sigiloso ? 'Orçamento sigiloso.' : o.orcamento ? `Orçamento: R$ ${o.orcamento.toLocaleString('pt-BR')}.` : '',
    o.observacoes ? `Obs.: ${limpa(o.observacoes).slice(0, 600)}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    versao: '2',
    tipo,
    chave: chaveDe(o),
    origem: 'Radar',
    versaoOrigem: o.versao,
    geradoEm: agora.toISOString(),
    plano: plano.planId,
    planoNome: plano.nome,
    cartao: {
      titulo: tituloCartao(o),
      status: o.status ?? 'Sem status',
      bucket,
      progresso: mapa.progresso[status] ?? 0,
      prazo: prazoDoCartao(o.data_pregao_dt, o.hora_pregao),
      responsavel: responsaveis[0] ?? null,
      responsaveis,
      rotulos,
      nota,
      // O checklist padrão só vai na criação; depois o time o conduz no Planner.
      checklist: tipo === 'oportunidade_nova' ? mapa.checklistPadrao : [],
    },
  }
}

/** Nome de arquivo ordenável, conforme a doc: AAAAMMDD-HHMM_<chave>_<tipo>.json */
export function nomeArquivo(e: EventoPlanner): string {
  const d = new Date(e.geradoEm)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}_${e.chave}_${e.tipo}.json`
}
