/**
 * Radar -> Planner: converte uma oportunidade em um evento v2 (arquivo JSON consumido pelo
 * `processar-eventos` do planner-auto). Função pura e testável; nada aqui fala com a rede.
 */
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
  versao: number
  status: string | null
  torre: string | null
  orgao: string | null
  descritivo: string | null
  processo: string | null
  uasg: string | null
  data_pregao_dt: string | null
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
    rotulos: string[]
    nota: string
    checklist: string[]
  }
}

/** Chave estável do cartão: aparece entre colchetes no início do título. */
export const chaveRadar = (id: number) => `RAD-${id}`

const limpa = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const dataBr = (iso: string) => iso.split('-').reverse().join('/')

/** Mesmo padrão dos cartões existentes: "ÓRGÃO | OBJETO | PE: processo UASG: x | DATA: dd/mm/aaaa". */
export function tituloCartao(o: OportunidadePlanner): string {
  const partes = [
    limpa(o.orgao) || 'Órgão não informado',
    limpa(o.descritivo) || 'Objeto não informado',
    [o.processo ? `PE: ${limpa(o.processo)}` : '', o.uasg ? `UASG: ${limpa(o.uasg)}` : ''].filter(Boolean).join(' '),
    o.data_pregao_dt ? `DATA: ${dataBr(o.data_pregao_dt)}` : '',
  ].filter(Boolean)
  return `[${chaveRadar(o.id)}] ${partes.join(' | ')}`.slice(0, 255)
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
  const status = o.status ?? '_sem_status'
  const bucket = plano.buckets[status] ?? plano.buckets._sem_status
  const rotulos = [...plano.rotulos, ...(plano.rotulosPorTorre?.[o.torre!.trim().toUpperCase()] ?? [])]
  const nota = [
    `Radar #${o.id} (v${o.versao}) — status: ${o.status ?? 'sem status'}.`,
    o.linha_servico ? `Linha de serviço: ${limpa(o.linha_servico)}.` : '',
    o.orcamento_sigiloso ? 'Orçamento sigiloso.' : o.orcamento ? `Orçamento: R$ ${o.orcamento.toLocaleString('pt-BR')}.` : '',
    o.observacoes ? `Obs.: ${limpa(o.observacoes).slice(0, 600)}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    versao: '2',
    tipo,
    chave: chaveRadar(o.id),
    origem: 'Radar',
    geradoEm: agora.toISOString(),
    plano: plano.planId,
    planoNome: plano.nome,
    cartao: {
      titulo: tituloCartao(o),
      status: o.status ?? 'Sem status',
      bucket,
      progresso: mapa.progresso[status] ?? 0,
      prazo: o.data_pregao_dt ? `${o.data_pregao_dt}T12:00:00Z` : null,
      responsavel: o.analista ? emailDoAnalista(o.analista) : null,
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
