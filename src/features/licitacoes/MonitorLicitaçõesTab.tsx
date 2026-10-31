import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import { useMe, useOpcoes, useOportunidades } from '@/features/oportunidades/api'
import { OportunidadeDrawer } from '@/features/oportunidades/OportunidadeDrawer'
import type { Oportunidade } from '@/domain/oportunidade'
import { FAIXAS, montar, type Faixa, type Linha, type Nivel } from './noc'

type PncpItem = {
  numeroControlePNCP?: string; numeroCompra?: string; processo?: string; objetoCompra?: string; informacaoComplementar?: string
  dataPublicacaoPncp?: string; dataEncerramentoProposta?: string; modalidadeNome?: string; situacaoCompraNome?: string
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string }
  unidadeOrgao?: { codigoUnidade?: string; nomeUnidade?: string; ufSigla?: string }
  id_compra?: string; numero_processo?: string; co_processo?: string; co_uasg?: number; no_ausg?: string; no_orgao?: string
  numero?: number; ds_situacao_pregao?: string; ds_tipo_pregao?: string; ds_tipo_pregao_compra?: string
  tx_objeto?: string; dt_data_edital?: string; dt_inicio_proposta?: string; dt_fim_proposta?: string
  situacao_aviso?: string; nome_modalidade?: string; objeto?: string; data_publicacao?: string
  data_abertura_proposta?: string; data_entrega_proposta?: string; numero_aviso?: number; uasg?: number
  orgaoEntidadeRazaoSocial?: string; unidadeOrgaoUfSigla?: string; valor_estimado_total?: number | string
  source?: string; url?: string
}
type PncpResponse = { data?: PncpItem[]; items?: PncpItem[]; content?: PncpItem[]; resultado?: PncpItem[]; totalPaginas?: number }
type Resultado = { item: PncpItem; score: number; motivos: string[]; url: string | null }

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const hoje = () => {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('')
}
export const pncpUrl = (control?: string) => {
  const m = control?.match(/^(\d{14})-\d+-(\d+)\/(\d{4})$/)
  return m ? 'https://pncp.gov.br/app/editais/' + m[1] + '/' + m[3] + '/' + m[2] : null
}

/** Uma página de pregões eletrônicos com recebimento de propostas aberto na UF. */
async function consultarPncpPagina(uf: string, pagina: number, signal?: AbortSignal) {
  const url = new URL('/pncp/consulta/v1/contratacoes/proposta', window.location.origin)
  url.searchParams.set('dataFinal', hoje())
  // A API do PNCP exige codigoModalidadeContratacao: 6 = Pregão - Eletrônico (1 seria Leilão - Eletrônico).
  url.searchParams.set('codigoModalidadeContratacao', '6')
  url.searchParams.set('pagina', String(pagina))
  url.searchParams.set('tamanhoPagina', '50') // máximo aceito pelo PNCP
  url.searchParams.set('uf', uf)
  // O PNCP pode ficar sem responder; não deixe uma consulta presa indefinidamente.
  const timeout = AbortSignal.timeout(12_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: requestSignal })
  if (!response.ok) throw new Error('PNCP respondeu HTTP ' + response.status)
  // Sem resultados (ou página além da última) o PNCP responde 204 sem corpo: não é erro, é lista vazia.
  const texto = response.status === 204 ? '' : (await response.text()).trim()
  if (!texto) return { itens: [], totalPaginas: 1 }
  const json = JSON.parse(texto) as PncpResponse | PncpItem[]
  if (Array.isArray(json)) return { itens: json, totalPaginas: 1 }
  return { itens: json.data ?? json.items ?? json.content ?? json.resultado ?? [], totalPaginas: json.totalPaginas ?? 1 }
}
export async function consultarPncp(uf: string, signal?: AbortSignal, pagina = 1): Promise<PncpItem[]> {
  return (await consultarPncpPagina(uf, pagina, signal)).itens
}
/** Varre as páginas em sequência (no máximo `maxPaginas` de 50) e para quando o PNCP diz que acabou. */
export async function consultarPncpUf(uf: string, signal?: AbortSignal, maxPaginas = 6): Promise<PncpItem[]> {
  const todos: PncpItem[] = []
  for (let p = 1; p <= maxPaginas; p++) {
    const r = await consultarPncpPagina(uf, p, signal)
    todos.push(...r.itens)
    if (p >= r.totalPaginas || r.itens.length === 0) break
  }
  return todos
}

const dataISO = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
async function consultarConlicitacao(): Promise<PncpItem[]> {
  const response = await fetch(new URL('/conlicitacao', window.location.origin), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  })
  const json = await response.json() as PncpResponse & { error?: string }
  if (!response.ok) throw new Error(json.error || 'ConLicitações respondeu HTTP ' + response.status)
  return json.resultado ?? json.data ?? []
}

export async function consultarComprasGov(): Promise<PncpItem[]> {
  const fim = new Date()
  const inicio = new Date(fim)
  inicio.setDate(inicio.getDate() - 45)
  const de = dataISO(inicio), ate = dataISO(fim)
  const consultas = [
    { path: 'modulo-legado/3_consultarPregoes', params: { dt_data_edital_inicial: de, dt_data_edital_final: ate } },
    { path: 'modulo-legado/1_consultarLicitacao', params: { data_publicacao_inicial: de, data_publicacao_final: ate } },
    { path: 'modulo-contratacoes/1_consultarContratacoes_PNCP_14133', params: { dataPublicacaoPncpInicial: de, dataPublicacaoPncpFinal: ate, codigoModalidade: '5' } },
  ]
  const tentativas = await Promise.allSettled(consultas.map(async ({ path, params }) => {
    const url = new URL('/comprasgov/' + path, window.location.origin)
    url.searchParams.set('pagina', '1')
    url.searchParams.set('tamanhoPagina', '100')
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(22_000) })
    if (!response.ok) throw new Error('Compras.gov.br respondeu HTTP ' + response.status + ' em ' + path)
    const json = await response.json() as PncpResponse
    const registros = (json.resultado ?? json.data ?? json.items ?? json.content ?? []) as PncpItem[]
    return registros.map((item): PncpItem => ({
      ...item,
      processo: item.co_processo ?? item.numero_processo ?? (item.numero != null ? String(item.numero) : undefined),
      numeroCompra: item.numero != null ? String(item.numero) : item.numero_aviso != null ? String(item.numero_aviso) : undefined,
      objetoCompra: item.tx_objeto ?? item.objeto,
      situacaoCompraNome: item.ds_situacao_pregao ?? item.situacao_aviso,
      dataPublicacaoPncp: item.data_publicacao ?? item.dt_data_edital,
      dataEncerramentoProposta: item.dt_fim_proposta ?? item.data_entrega_proposta,
      modalidadeNome: item.ds_tipo_pregao ?? item.nome_modalidade,
      orgaoEntidade: { razaoSocial: item.no_orgao ?? item.orgaoEntidadeRazaoSocial },
      unidadeOrgao: { codigoUnidade: item.co_uasg != null ? String(item.co_uasg) : item.uasg != null ? String(item.uasg) : undefined, nomeUnidade: item.no_ausg, ufSigla: item.unidadeOrgaoUfSigla },
      numeroControlePNCP: item.id_compra,
      source: path.includes('modulo-legado') ? 'Compras.gov.br — legado' : 'Compras.gov.br — Lei 14.133/PNCP',
    }))
  }))
  const resultados = tentativas.filter((r): r is PromiseFulfilledResult<PncpItem[]> => r.status === 'fulfilled').map(r => r.value)
  if (resultados.length === 0) throw new Error(tentativas.map(r => r.status === 'rejected' ? String(r.reason) : '').filter(Boolean).join(' | ') || 'Nenhuma fonte respondeu')
  const unique = new Map<string, PncpItem>()
  resultados.flat().forEach((item, index) => unique.set(item.id_compra ?? [item.processo, item.numeroCompra, item.objetoCompra, index].join('|'), item))
  return [...unique.values()]
}

function pontuar(o: Oportunidade, c: PncpItem): Resultado | null {
  const processo = fold(o.processo), processoPncp = fold(c.processo)
  const uasg = fold(o.uasg), unidade = fold([c.unidadeOrgao?.codigoUnidade, c.unidadeOrgao?.nomeUnidade].join(' '))
  const orgao = fold(o.orgao), orgaoPncp = fold(c.orgaoEntidade?.razaoSocial)
  const objeto = fold([o.objeto, o.descritivo].join(' ')), objetoPncp = fold([c.objetoCompra, c.informacaoComplementar].join(' '))
  let score = 0
  const motivos: string[] = []
  if (processo && processoPncp && processo === processoPncp) { score += 100; motivos.push('Processo exato') }
  if (uasg && (unidade.includes(uasg) || fold(c.unidadeOrgao?.codigoUnidade) === uasg)) { score += 60; motivos.push('UASG compatível') }
  if (orgao && orgaoPncp && (orgaoPncp.includes(orgao) || orgao.includes(orgaoPncp))) { score += 35; motivos.push('Órgão compatível') }
  const tokens = objeto.split(/\s+/).filter(t => t.length > 4)
  const overlap = tokens.length ? tokens.filter(t => objetoPncp.includes(t)).length / Math.min(tokens.length, 12) : 0
  if (overlap >= 0.25) { score += Math.round(overlap * 25); motivos.push('Objeto semelhante') }
  if (!score) return null
  return { item: c, score, motivos, url: c.url || pncpUrl(c.numeroControlePNCP) }
}

function candidatos(o: Oportunidade, itens: PncpItem[]) {
  return itens.map(c => pontuar(o, c)).filter((x): x is Resultado => x !== null).sort((a, b) => b.score - a.score).slice(0, 3)
}
function data(v: string | null | undefined) {
  if (!v) return 'Não informada'
  // Data pura (aaaa-mm-dd) é dia de calendário: não passa por Date, que a leria como UTC e mostraria o dia anterior no Brasil.
  const puro = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (puro) return `${puro[3]}/${puro[2]}/${puro[1]}`
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(d)
}

const COR: Record<Nivel, string> = { critico: 'border-st-critical/40 bg-st-critical/5', atencao: 'border-st-warn/40 bg-st-warn/5', ok: 'border-line bg-surface' }
const ROTULO: Record<Nivel, string> = { critico: 'Ação agora', atencao: 'Atenção', ok: 'No prazo' }
const PONTO: Record<Nivel, string> = { critico: 'bg-st-critical', atencao: 'bg-st-warn', ok: 'bg-st-good' }
/** Cor do placar de cada faixa quando há itens nela. */
const TOM_FAIXA: Record<Faixa, Nivel> = { atrasado: 'critico', hoje: 'critico', amanha: 'atencao', semana: 'ok', proximas: 'ok', sem_data: 'atencao' }
const TILE: Record<Nivel, string> = { critico: 'border-st-critical/50 bg-st-critical/10', atencao: 'border-st-warn/50 bg-st-warn/10', ok: 'border-st-good/40 bg-st-good/5' }
const TEXTO_TILE: Record<Nivel, string> = { critico: 'text-st-critical', atencao: 'text-st-warn', ok: 'text-st-good' }
const httpsSeguro = (v: string | null | undefined) => (/^https?:\/\/\S+$/i.test(String(v ?? '').trim()) ? String(v).trim() : null)

function BuscaPncp({ o }: { o: Oportunidade }) {
  const uf = (o.uf ?? '').trim().toUpperCase()
  const [ativo, setAtivo] = useState(false)
  const q = useQuery({ queryKey: ['pncp-uf', uf], queryFn: ({ signal }) => consultarPncpUf(uf, signal), enabled: ativo && /^[A-Z]{2}$/.test(uf), staleTime: 10 * 60_000, gcTime: 30 * 60_000, retry: 0, refetchOnWindowFocus: false })
  const achados = useMemo(() => (q.data ? candidatos(o, q.data) : []), [q.data, o])
  if (!ativo) return <button type="button" onClick={() => setAtivo(true)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2">Procurar edital no PNCP</button>
  if (q.isPending || q.isFetching) return <p className="text-xs text-muted">Procurando entre os pregões abertos de {uf} no PNCP…</p>
  if (q.isError) return <p role="alert" className="text-xs text-st-critical">PNCP: {(q.error as Error).message}. <button type="button" onClick={() => q.refetch()} className="font-semibold underline">Tentar de novo</button></p>
  if (!achados.length) return <p className="text-xs text-muted">Nenhum pregão aberto de {uf} parece ser este (conferidos {q.data?.length ?? 0}). O PNCP só lista pregões com propostas abertas; confirme no portal do órgão.</p>
  return <div className="w-full space-y-2">{achados.map((m, i) => <div key={m.item.numeroControlePNCP || i} className="rounded-md bg-surface-2 p-3 text-xs">
    <p className="font-semibold text-ink">{m.item.orgaoEntidade?.razaoSocial || 'Órgão não informado'} · {m.item.unidadeOrgao?.nomeUnidade || 'Unidade não informada'} <span className="font-normal text-muted">· compatibilidade {m.score}</span></p>
    <p className="mt-1 text-ink-soft">{(m.item.processo ? 'Processo ' + m.item.processo + ' · ' : '') + (m.item.objetoCompra || 'Objeto não informado')}</p>
    <p className="mt-1 text-muted">{m.motivos.join(' · ')} · Propostas até {data(m.item.dataEncerramentoProposta)}</p>
    {m.url && <a className="mt-1 inline-flex items-center gap-1 font-semibold text-gold hover:underline" href={m.url} target="_blank" rel="noreferrer noopener">Ver no PNCP <ExternalLink className="size-3" /></a>}
  </div>)}<p className="text-[11px] text-muted">Sugestão por semelhança: confirme o processo antes de agir.</p></div>
}

function Cartao({ l, onAbrir, procurar }: { l: Linha; onAbrir: (o: Oportunidade) => void; procurar: boolean }) {
  const { o, a } = l
  const link = httpsSeguro(o.site)
  const uf = (o.uf ?? '').trim().toUpperCase()
  const Icone = a.nivel === 'critico' ? AlertTriangle : a.nivel === 'atencao' ? Clock3 : CheckCircle2
  return <article className={'rounded-lg border px-3 py-2.5 ' + COR[a.nivel]}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={'size-2.5 shrink-0 rounded-full ' + PONTO[a.nivel]} aria-hidden />
      <p className="min-w-0 flex-1 basis-60 truncate text-sm text-ink" title={o.descritivo || o.objeto || undefined}>
        <span className="font-semibold">{(o.codigo ?? '#' + o.id) + ' · ' + (o.sigla ? o.sigla + ' — ' : '') + o.orgao}</span>
        <span className="text-ink-soft"> · {o.descritivo || o.objeto || 'Sem descrição do objeto'}</span>
      </p>
      <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs text-ink">{o.status}</span>
      <span className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">{data(o.data_pregao_dt)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onAbrir(o)} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-page hover:opacity-90">Abrir cadastro</button>
        {link && <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2">Abrir edital <ExternalLink className="size-3" aria-hidden /></a>}
        {procurar && /^[A-Z]{2}$/.test(uf) && <BuscaPncp o={o} />}
      </div>
    </div>
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft"><Icone className="size-4 shrink-0 self-center text-ink" aria-hidden /><strong className="text-ink">{a.titulo}</strong><span className="sr-only"> ({ROTULO[a.nivel]})</span><span>· <strong>Próxima ação:</strong> {a.acao}</span></p>
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"><span>Processo: {o.processo || '—'} · UASG: {o.uasg || '—'} · UF: {uf || '—'}{o.analista ? ' · Pré-vendas: ' + o.analista : ''}</span>
      {a.faltas.length > 0 && <ul className="contents" aria-label="O que falta no cadastro">{a.faltas.map(f => <li key={f.chave} className={'rounded-md border px-1.5 py-px ' + (f.bloqueia ? 'border-st-warn/50 text-ink' : 'border-line text-muted')}>{f.rotulo}</li>)}</ul>}
    </div>
  </article>
}

function Fonte({ titulo, query, vazio }: { titulo: string; query: { isError: boolean; isSuccess: boolean; error: unknown; data?: PncpItem[] }; vazio: string }) {
  return <div className="rounded-lg border border-line p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{titulo}</h3><span className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">{query.isSuccess ? (query.data?.length ?? 0) + ' registros' : query.isError ? 'indisponível' : 'consultando…'}</span></div>
    {query.isError ? <p role="alert" className="mt-2 text-xs text-st-critical">{(query.error as Error)?.message || 'Falha na consulta'}</p>
      : query.isSuccess && (query.data ?? []).length === 0 ? <p className="mt-2 text-xs text-muted">{vazio}</p>
      : <ul className="mt-2 space-y-1.5">{(query.data ?? []).slice(0, 6).map((item, i) => <li key={item.id_compra || item.numeroControlePNCP || i} className="text-xs text-ink-soft"><strong className="text-ink">{item.orgaoEntidade?.razaoSocial || item.unidadeOrgao?.nomeUnidade || 'Órgão não informado'}</strong> · {item.objetoCompra || 'Objeto não informado'} · encerra {data(item.dataEncerramentoProposta)}</li>)}</ul>}
  </div>
}

export default function MonitorLicitaçõesTab() {
  const lista = useOportunidades(false)
  const me = useMe()
  const opcoes = useOpcoes()
  const qc = useQueryClient()
  const [visao, setVisao] = useState<'certames' | 'contratos'>('certames')
  const [soAcao, setSoAcao] = useState(false)
  const [busca, setBusca] = useState('')
  const [fontes, setFontes] = useState(false)
  const [editando, setEditando] = useState<Oportunidade | null | undefined>(undefined)
  // Fontes públicas só rodam quando alguém abre o bloco "Fontes": a tela principal não depende delas e não faz rede à toa.
  const comprasGov = useQuery({ queryKey: ['comprasgov-licitacoes-front'], queryFn: consultarComprasGov, enabled: fontes, staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 0, refetchOnWindowFocus: false })
  const conlicitacao = useQuery({ queryKey: ['conlicitacao-licitacoes-front'], queryFn: consultarConlicitacao, enabled: fontes, staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 0, refetchOnWindowFocus: false })

  const [faixaSel, setFaixaSel] = useState<Faixa | ''>('')
  // Painel que fica aberto o dia todo: relê o cadastro a cada 2 minutos (só com a aba visível) e recalcula "hoje" a cada leitura.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') qc.invalidateQueries({ queryKey: ['oportunidades'] }) }, 120_000)
    return () => clearInterval(t)
  }, [qc])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- "agora" deve mudar a cada leitura nova dos dados
  const agora = useMemo(() => new Date(), [lista.dataUpdatedAt])
  const todas = useMemo(() => montar(lista.data ?? [], agora), [lista.data, agora])
  const certames = useMemo(() => todas.filter(l => l.a.grupo === 'certame'), [todas])
  const contratos = useMemo(() => todas.filter(l => l.a.grupo === 'contrato'), [todas])
  const visiveis = useMemo(() => {
    const q = fold(busca)
    return (visao === 'certames' ? certames : contratos).filter(l =>
      (!soAcao || l.a.nivel !== 'ok') &&
      (visao !== 'certames' || !faixaSel || l.a.faixa === faixaSel) &&
      (!q || fold([l.o.codigo, l.o.sigla, l.o.orgao, l.o.processo, l.o.descritivo, l.o.objeto, l.o.uasg, l.o.analista].join(' ')).includes(q)))
  }, [visao, certames, contratos, soAcao, faixaSel, busca])
  const nFaixa = (f: string) => certames.filter(l => l.a.faixa === f).length
  const precisaAcao = todas.filter(l => l.a.nivel !== 'ok').length
  const atualizando = lista.isFetching || comprasGov.isFetching || conlicitacao.isFetching
  const atualizar = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['oportunidades'] }),
      qc.invalidateQueries({ queryKey: ['pncp-uf'] }),
      qc.invalidateQueries({ queryKey: ['comprasgov-licitacoes-front'] }),
      qc.invalidateQueries({ queryKey: ['conlicitacao-licitacoes-front'] }),
    ])
  }
  const atualizadoEm = lista.dataUpdatedAt ? new Date(lista.dataUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const placar = (id: string, titulo: string, n: number, nivel: Nivel, ativo: boolean, onClick: () => void) => (
    <button key={id} type="button" onClick={onClick} aria-pressed={ativo} disabled={lista.isPending}
      className={'rounded-xl border p-3 text-left transition-colors ' + (n > 0 ? TILE[nivel] : 'border-line bg-surface') + (ativo ? ' ring-2 ring-gold' : ' hover:bg-surface-2')}>
      <span className="block text-xs text-muted">{titulo}</span>
      <span className={'mt-1 block font-mono text-2xl font-medium tabular-nums ' + (n > 0 ? TEXTO_TILE[nivel] : 'text-muted')}>{lista.isPending ? '—' : n}</span>
    </button>
  )
  const escolherFaixa = (f: Faixa) => { setVisao('certames'); setFaixaSel(x => (x === f ? '' : f)) }
  const aba = (id: typeof visao, rotulo: string, n: number) => (
    <button key={id} type="button" onClick={() => setVisao(id)} aria-pressed={visao === id} className={'rounded-lg border px-3 py-1.5 text-xs font-semibold ' + (visao === id ? 'border-gold bg-gold-soft text-ink' : 'border-line text-muted hover:bg-surface-2')}>{rotulo} ({n})</button>
  )

  return <section className="mt-5 space-y-5" aria-label="Monitoramento de licitações">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-gold">Painel de certames</p><h1 className="mt-1 text-2xl text-ink">Monitoramento de licitações</h1><p className="mt-1 max-w-3xl text-sm text-muted">Placar por urgência das oportunidades em andamento: clique numa faixa para filtrar. Cada linha mostra a situação, a próxima ação e o que falta no cadastro.</p></div>
      <div className="flex items-center gap-3"><span className="text-xs text-muted" aria-live="polite">Atualizado às {atualizadoEm} · relê a cada 2 min</span><button onClick={atualizar} disabled={atualizando} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"><RefreshCw className={'size-4 ' + (atualizando ? 'animate-spin' : '')} /> Atualizar</button></div>
    </div>
    {lista.error && <div role="alert" className="rounded-lg border border-st-critical/30 bg-surface p-4 text-sm text-ink-soft">Não foi possível ler as oportunidades do Radar: {(lista.error as Error).message}</div>}
    <div role="group" aria-label="Placar por urgência (clique para filtrar)" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {placar('acao', 'Precisam de ação', precisaAcao, 'atencao', soAcao, () => setSoAcao(v => !v))}
      {FAIXAS.map(f => placar(f.id, f.titulo, nFaixa(f.id), TOM_FAIXA[f.id], faixaSel === f.id, () => escolherFaixa(f.id)))}
    </div>

    <div className="flex flex-wrap items-center gap-2">
      {aba('certames', 'Certames (Prospect e Go)', certames.length)}
      {aba('contratos', 'Contratos (On going, Onboarding, Suspended)', contratos.length)}
      <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-soft"><input type="checkbox" className="size-4 accent-[var(--gold)]" checked={soAcao} onChange={e => setSoAcao(e.target.checked)} />Só o que precisa de ação</label>
      <div className="relative min-w-60 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted" /><input value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar nas licitações" placeholder="Buscar órgão, processo, UASG ou objeto…" className="w-full rounded-lg border border-line bg-surface px-9 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40" /></div>
    </div>

    {lista.isPending ? <p className="py-10 text-center text-sm text-muted">Carregando oportunidades…</p>
      : visiveis.length === 0 ? <p className="py-10 text-center text-sm text-muted">Nada para mostrar com este filtro.</p>
      : visao === 'certames'
        ? FAIXAS.map(f => {
          const itens = visiveis.filter(l => l.a.faixa === f.id)
          return itens.length === 0 ? null : <div key={f.id} className="space-y-2"><h2 className="text-sm font-semibold text-ink">{f.titulo} <span className="font-normal text-muted">({itens.length})</span></h2>{itens.map(l => <Cartao key={l.o.id} l={l} onAbrir={setEditando} procurar />)}</div>
        })
        : <div className="space-y-2">{visiveis.map(l => <Cartao key={l.o.id} l={l} onAbrir={setEditando} procurar={false} />)}</div>}

    <details className="rounded-xl border border-line bg-surface p-4" onToggle={e => setFontes((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold text-ink">Fontes públicas (diagnóstico)</summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-soft"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted" /><p>A busca no PNCP lista só pregões eletrônicos com propostas abertas e confere até 300 por UF. Não cobre sessões encerradas, remarcações em tempo real nem todos os portais. Correspondência é sugestão: confirme com o identificador oficial. O acompanhamento automático com histórico e alertas de mudança ainda depende de habilitar o monitor no servidor.</p></div>
        <Fonte titulo="Compras.gov.br · últimos 45 dias" query={comprasGov} vazio="A API respondeu, mas não retornou registros no período." />
        <Fonte titulo="ConLicitações · boletins da conta" query={conlicitacao} vazio="A API respondeu, mas não retornou licitações nos filtros configurados." />
      </div>
    </details>

    {me.data && opcoes.data && <OportunidadeDrawer aberto={editando !== undefined} onFechar={() => setEditando(undefined)} registro={editando ?? null} opcoes={opcoes.data} me={me.data} />}
  </section>
}
