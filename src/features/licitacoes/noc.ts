/**
 * Regras do painel de licitações (NOC): a partir dos dados do próprio Radar, diz quão urgente é cada certame,
 * o que falta no cadastro e qual é a próxima ação. Funções puras: nada de rede nem de relógio escondido.
 */
import type { Oportunidade } from '@/domain/oportunidade'
import { corDoPrazo, diasUteisAte } from './prazo'

export type Nivel = 'critico' | 'atencao' | 'ok'
export type Faixa = 'atrasado' | 'hoje' | 'amanha' | 'semana' | 'proximas' | 'sem_data'
export type Grupo = 'certame' | 'contrato'
/** Por que uma oportunidade precisa de ação (null = no prazo, nada a fazer). */
export type Motivo = 'status_desatualizado' | 'pregao_hoje' | 'pregao_amanha' | 'prazo_3_uteis' | 'prazo_5_uteis' | 'cadastro_incompleto' | 'sem_data' | 'suspenso'

export const FAIXAS: { id: Faixa; titulo: string }[] = [
  { id: 'atrasado', titulo: 'Pregão já passou' },
  { id: 'hoje', titulo: 'Hoje' },
  { id: 'amanha', titulo: 'Amanhã' },
  { id: 'semana', titulo: 'Próximos 7 dias' },
  { id: 'proximas', titulo: 'Mais adiante' },
  { id: 'sem_data', titulo: 'Sem data de pregão' },
]

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Prospect e Go: o certame ainda vai acontecer, então a data do pregão é o que manda. */
const CERTAME = new Set(['prospect', 'go'])
/** Em andamento, suspenso ou em implantação: já passou do pregão; acompanha-se a situação, não a data. */
const CONTRATO = new Set(['on going', 'ongoing', 'onboarding', 'suspended', 'suspenso', 'suspensa'])

export const grupoDe = (status: string | null | undefined): Grupo | null =>
  CERTAME.has(fold(status)) ? 'certame' : CONTRATO.has(fold(status)) ? 'contrato' : null

const ISO = /^(\d{4})-(\d{2})-(\d{2})/

/** Dias de calendário entre hoje e a data (aaaa-mm-dd): 0 = hoje, 1 = amanhã, negativo = já passou. Sem data válida: null. */
export function diasAte(data: string | null | undefined, hoje: Date): number | null {
  const m = ISO.exec(data ?? '')
  if (!m) return null
  const alvo = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  return Math.round((alvo - base) / 86_400_000)
}

export const faixaDe = (dias: number | null): Faixa =>
  dias === null ? 'sem_data' : dias < 0 ? 'atrasado' : dias === 0 ? 'hoje' : dias === 1 ? 'amanha' : dias <= 7 ? 'semana' : 'proximas'

export const MOTIVOS: Record<Motivo, string> = {
  status_desatualizado: 'Pregão já passou e o status não foi atualizado',
  pregao_hoje: 'Pregão hoje: confirmar proposta e sessão',
  pregao_amanha: 'Pregão amanhã: revisar proposta e documentos',
  prazo_3_uteis: 'Pregão em até 3 dias úteis (vermelho)',
  prazo_5_uteis: 'Pregão em até 5 dias úteis (amarelo)',
  cadastro_incompleto: 'Cadastro incompleto (processo ou UF)',
  sem_data: 'Sem data de pregão',
  suspenso: 'Suspenso: confirmar retomada',
}

/** Nome do site (portal) para mostrar: o texto cadastrado; se for uma URL https, só o domínio; vazio = null. */
export function rotuloDoSite(site: string | null | undefined): string | null {
  const v = String(site ?? '').trim()
  if (!v) return null
  if (!/^https?:\/\/\S+$/i.test(v)) return v
  try { return new URL(v).hostname.replace(/^www\./, '') } catch { return v }
}

export type Falta = { chave: 'processo' | 'uf' | 'uasg' | 'site'; rotulo: string; bloqueia: boolean }

/** O que falta no cadastro. Só processo e UF atrapalham a busca do edital; UASG e site (o portal onde o pregão acontece) ajudam, mas nem todo certame tem. */
export function faltas(o: Pick<Oportunidade, 'processo' | 'uf' | 'uasg' | 'site' | 'segmento'>): Falta[] {
  const vazio = (v: string | null | undefined) => !String(v ?? '').trim()
  const r: Falta[] = []
  if (vazio(o.processo)) r.push({ chave: 'processo', rotulo: 'Sem nº do processo', bloqueia: true })
  if (!/^[A-Za-z]{2}$/.test(String(o.uf ?? '').trim())) r.push({ chave: 'uf', rotulo: 'Sem UF', bloqueia: true })
  if (vazio(o.uasg) && o.segmento !== 'Corporate') r.push({ chave: 'uasg', rotulo: 'Sem UASG', bloqueia: false })
  if (vazio(o.site)) r.push({ chave: 'site', rotulo: 'Sem site (portal)', bloqueia: false })
  return r
}

/** `dias` = dias corridos até o pregão; `uteis` = dias úteis (ver prazo.ts). O alerta de prazo usa os úteis. */
export type Avaliacao = { grupo: Grupo; faixa: Faixa; dias: number | null; uteis: number | null; nivel: Nivel; motivo: Motivo | null; titulo: string; acao: string; faltas: Falta[] }

const quando = (dias: number) => (dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`)

export function avaliar(o: Oportunidade, hoje: Date): Avaliacao | null {
  const grupo = grupoDe(o.status)
  if (!grupo) return null
  const f = faltas(o)
  const dias = diasAte(o.data_pregao_dt, hoje)
  const uteis = diasUteisAte(o.data_pregao_dt, hoje)
  const faixa = faixaDe(dias)
  const bloqueio = f.some((x) => x.bloqueia)

  if (grupo === 'contrato') {
    const suspenso = ['suspended', 'suspenso', 'suspensa'].includes(fold(o.status))
    return suspenso
      ? { grupo, faixa, dias, uteis, nivel: 'atencao', motivo: 'suspenso', titulo: 'Suspenso', acao: 'Confirme com o órgão se há data de retomada e atualize o status quando houver.', faltas: f }
      : { grupo, faixa, dias, uteis, nivel: 'ok', motivo: null, titulo: fold(o.status) === 'onboarding' ? 'Em implantação' : 'Em andamento', acao: 'Sem ação pendente no pregão. Acompanhe a execução.', faltas: f }
  }

  if (dias === null) return { grupo, faixa, dias, uteis, nivel: 'atencao', motivo: 'sem_data', titulo: 'Sem data de pregão', acao: 'Informe a data do pregão no cadastro para o painel poder acompanhar.', faltas: f }
  if (dias < 0)
    return { grupo, faixa, dias, uteis, nivel: 'critico', motivo: 'status_desatualizado', titulo: `Pregão foi há ${-dias} dia${dias === -1 ? '' : 's'} e o status segue ${o.status}`, acao: 'Atualize o status (Win, Lost, No Go, Suspended…) ou a data, se o pregão foi remarcado.', faltas: f }
  if (dias === 0) {
    const hora = o.hora_pregao ? ` às ${String(o.hora_pregao).slice(0, 5)}` : ''
    return { grupo, faixa, dias, uteis, nivel: 'critico', motivo: 'pregao_hoje', titulo: `Pregão hoje${hora}`, acao: bloqueio ? 'Complete o cadastro (processo/UF) e confirme proposta, sessão e responsável.' : 'Confirme proposta enviada, sessão aberta e responsável.', faltas: f }
  }
  if (dias === 1) return { grupo, faixa, dias, uteis, nivel: 'critico', motivo: bloqueio ? 'cadastro_incompleto' : 'pregao_amanha', titulo: 'Pregão amanhã', acao: bloqueio ? 'Complete o cadastro (processo/UF) antes da sessão.' : 'Revise a proposta e os documentos antes da sessão.', faltas: f }
  // A partir de 2 dias: o prazo em DIAS ÚTEIS manda (até 5 = amarelo, até 3 = vermelho). Qualquer pregão a 7 dias corridos ou menos tem no máximo 5 dias úteis, então cadastro incompleto nessa janela já nasce amarelo.
  const cor = corDoPrazo(uteis)
  const incompleto = bloqueio && dias <= 7
  const nivelPrazo: Nivel = cor === 'vermelho' ? 'critico' : cor === 'amarelo' ? 'atencao' : 'ok'
  const nivel = nivelPrazo
  const motivo: Motivo | null = incompleto ? 'cadastro_incompleto' : cor === 'vermelho' ? 'prazo_3_uteis' : cor === 'amarelo' ? 'prazo_5_uteis' : null
  const titulo = `Pregão ${quando(dias)}` + (cor && uteis !== null ? ` (${uteis} dia${uteis === 1 ? '' : 's'} útei${uteis === 1 ? 'l' : 's'})` : '')
  const acao = bloqueio
    ? dias <= 7 ? 'Complete o cadastro (processo/UF) para localizar o edital e faça o checklist do pregão.' : 'Complete o cadastro (processo/UF) quando puder.'
    : cor === 'vermelho' ? 'Prazo curto: confira o portal, a operação e o atestado técnico antes da sessão.'
    : cor === 'amarelo' ? 'Prazo se aproximando: confira o cadastro no portal, a operação e o atestado técnico.'
    : 'No prazo.'
  return { grupo, faixa, dias, uteis, nivel, motivo, titulo, acao, faltas: f }
}

export type Linha = { o: Oportunidade; a: Avaliacao }

/** Avalia e ordena de uma vez só: mais urgente primeiro (data mais próxima; sem data por último). */
export function montar(lista: Oportunidade[], hoje: Date): Linha[] {
  const linhas: Linha[] = []
  for (const o of lista) {
    if (o.arquivado_em) continue
    const a = avaliar(o, hoje)
    if (a) linhas.push({ o, a })
  }
  const peso = (n: Nivel) => (n === 'critico' ? 0 : n === 'atencao' ? 1 : 2)
  return linhas.sort((x, y) => (x.a.dias ?? 9e6) - (y.a.dias ?? 9e6) || peso(x.a.nivel) - peso(y.a.nivel) || (x.o.id - y.o.id))
}

/** O pop-up do checklist aparece ao abrir um certame cujo pregão ainda não passou (hoje ou adiante). */
export const exigeChecklist = (a: Pick<Avaliacao, 'grupo' | 'dias'>) => a.grupo === 'certame' && a.dias !== null && a.dias >= 0

/**
 * Perguntas do pop-up. Cada item é uma conferência que a pessoa faz ANTES de abrir o cadastro. `{site}` vira o nome do portal
 * da oportunidade (ou "o portal" quando o site não foi informado).
 */
export const CHECKLIST_PREGAO: readonly string[] = [
  'Já conferiu o cadastro/credenciamento no portal ({site}) para esta licitação?',
  'Já encaminhou as informações da oportunidade para a operação?',
  'Já deu visibilidade da oportunidade para a operação (pasta de documentação, aviso ou reunião)?',
  'Já conferiu o atestado técnico: os nossos documentos têm aderência ao que o edital exige?',
  'Já confirmou no edital a data e a hora da sessão e se houve retificação, impugnação ou adiamento?',
]
