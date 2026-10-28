import { useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, Clock3, ExternalLink, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import { useOportunidades } from '@/features/oportunidades/api'
import type { Oportunidade } from '@/domain/oportunidade'

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

const STATUS = new Set(['prospect', 'go', 'on going', 'ongoing', 'suspended', 'suspenso', 'suspensa', 'onboarding'])
const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const hoje = () => {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('')
}
const pncpUrl = (control?: string) => {
  const m = control?.match(/^(\d{14})-\d+-(\d+)\/(\d{4})$/)
  return m ? 'https://pncp.gov.br/app/editais/' + m[1] + '/' + m[3] + '/' + m[2] : null
}
async function consultarPncp(uf: string, signal?: AbortSignal): Promise<PncpItem[]> {
  const url = new URL('/api/pncp/consulta/v1/contratacoes/proposta', window.location.origin)
  url.searchParams.set('dataFinal', hoje())
  url.searchParams.set('pagina', '1')
  url.searchParams.set('tamanhoPagina', '50')
  url.searchParams.set('uf', uf)
  // O PNCP pode ficar sem responder; não deixe uma consulta presa indefinidamente.
  const timeout = AbortSignal.timeout(12_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: requestSignal })
  if (!response.ok) throw new Error('PNCP respondeu HTTP ' + response.status)
  const json = await response.json() as PncpResponse | PncpItem[]
  if (Array.isArray(json)) return json
  return json.data ?? json.items ?? json.content ?? json.resultado ?? []
}

const dataISO = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
async function consultarConlicitacao(): Promise<PncpItem[]> {
  const response = await fetch(new URL('/api/pncp/conlicitacao', window.location.origin), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  })
  const json = await response.json() as PncpResponse & { error?: string }
  if (!response.ok) throw new Error(json.error || 'ConLicitações respondeu HTTP ' + response.status)
  return json.resultado ?? json.data ?? []
}

async function consultarComprasGov(): Promise<PncpItem[]> {
  const fim = new Date()
  const inicio = new Date(fim)
  inicio.setDate(inicio.getDate() - 45)
  const de = dataISO(inicio), ate = dataISO(fim)
  const consultas = [
    { path: 'modulo-legado/3_consultarPregoes', params: { dt_data_edital_inicial: de, dt_data_edital_final: ate } },
    { path: 'modulo-legado/1_consultarLicitacao', params: { data_publicacao_inicial: de, data_publicacao_final: ate } },
    { path: 'modulo-contratacoes/1_consultarContratacoes_PNCP_14133', params: {} },
  ]
  const tentativas = await Promise.allSettled(consultas.map(async ({ path, params }) => {
    const url = new URL('/api/pncp/comprasgov/' + path, window.location.origin)
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
function alertaNoc(o: Oportunidade, matches: Resultado[], consulta: { isError?: boolean; isPending?: boolean } | undefined, comprasGov: { isError?: boolean; isPending?: boolean }, conlicitacao?: { isError?: boolean; isPending?: boolean }) {
  const uf = (o.uf ?? '').trim().toUpperCase()
  if (!uf) return { nivel: 'critico', titulo: 'Cadastro incompleto', acao: 'Corrija a UF desta oportunidade no Radar e execute a consulta novamente.' }
  if (consulta?.isError && comprasGov.isError && conlicitacao?.isError) return { nivel: 'critico', titulo: 'Fontes indisponíveis', acao: 'Não tome decisão com dados desatualizados. Reexecute as consultas e valide os portais oficiais.' }
  if (consulta?.isPending || !consulta || comprasGov.isPending || conlicitacao?.isPending) return { nivel: 'atencao', titulo: 'Consulta em andamento', acao: 'Aguarde a conclusão das fontes antes de decidir se há ou não correspondência.' }
  if (matches.some(m => m.score >= 100)) return { nivel: 'atencao', titulo: 'Correspondência forte — confirmar', acao: 'Confira processo, UASG e órgão. Confirme o vínculo oficial antes de agir sobre o certame.' }
  if (matches.length) return { nivel: 'atencao', titulo: 'Possível correspondência', acao: 'Revise os candidatos abaixo e confirme se algum corresponde à oportunidade cadastrada.' }
  if (consulta?.isError || comprasGov.isError || conlicitacao?.isError) return { nivel: 'atencao', titulo: 'Consulta parcial', acao: 'Consulte novamente a fonte com erro e verifique o portal oficial antes de concluir que não há certame.' }
  return { nivel: 'critico', titulo: 'Sem correspondência encontrada', acao: 'Valide número do processo, UASG, órgão e UF. A busca cobre apenas os registros retornados pelas fontes consultadas.' }
}

function candidatos(o: Oportunidade, itens: PncpItem[]) {
  return itens.map(c => pontuar(o, c)).filter((x): x is Resultado => x !== null).sort((a, b) => b.score - a.score).slice(0, 3)
}
function data(v: string | null | undefined) {
  if (!v) return 'Não informada'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(d)
}

export default function MonitorLicitaçõesTab() {
  const lista = useOportunidades(false)
  const qc = useQueryClient()
  const [filtroStatus, setFiltroStatus] = useState('Todos')
  const [busca, setBusca] = useState('')
  const elegiveis = useMemo(() => (lista.data ?? []).filter(o => STATUS.has(fold(o.status)) && !o.arquivado_em), [lista.data])
  const ufs = useMemo(() => [...new Set(elegiveis.map(o => (o.uf ?? '').trim().toUpperCase()).filter(uf => /^[A-Z]{2}$/.test(uf)))].sort(), [elegiveis])
  const comprasGov = useQuery({ queryKey: ['comprasgov-licitacoes-front'], queryFn: consultarComprasGov, staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 0, refetchOnWindowFocus: false })
  const conlicitacao = useQuery({ queryKey: ['conlicitacao-licitacoes-front'], queryFn: consultarConlicitacao, staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 0, refetchOnWindowFocus: false })
  const consultas = useQueries({ queries: ufs.map(uf => ({
    queryKey: ['pncp-licitacoes-front', uf],
    queryFn: ({ signal }: { signal: AbortSignal }) => consultarPncp(uf, signal),
    staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 0, refetchOnWindowFocus: false,
  })) })
  const atualizando = lista.isFetching || comprasGov.isFetching || conlicitacao.isFetching || consultas.some(q => q.isFetching)
  const porUf = useMemo(() => new Map(ufs.map((uf, i) => [uf, consultas[i]])), [ufs, consultas])
  const linhas = useMemo(() => {
    const q = fold(busca)
    return elegiveis
      .filter(o => (filtroStatus === 'Todos' || fold(o.status) === fold(filtroStatus)) &&
        (!q || fold([o.codigo, o.orgao, o.processo, o.descritivo, o.objeto, o.uasg, o.site].join(' ')).includes(q)))
      .sort((a, b) => {
        const rank = (o: Oportunidade) => {
          const uf = (o.uf ?? '').trim().toUpperCase()
          const consulta = porUf.get(uf)
          if (!consulta || consulta.isPending) return 2
          if (consulta.isError) return 3
          return consulta.data && candidatos(o, consulta.data).length > 0 ? 0 : 1
        }
        return rank(a) - rank(b)
      })
  }, [elegiveis, filtroStatus, busca, porUf])
  const consultarNovamente = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['oportunidades'] }),
      qc.invalidateQueries({ queryKey: ['pncp-licitacoes-front'] }),
      qc.invalidateQueries({ queryKey: ['comprasgov-licitacoes-front'] }),
      qc.invalidateQueries({ queryKey: ['conlicitacao-licitacoes-front'] }),
    ])
    await Promise.all([
      qc.refetchQueries({ queryKey: ['pncp-licitacoes-front'], type: 'active' }),
      qc.refetchQueries({ queryKey: ['comprasgov-licitacoes-front'], type: 'active' }),
      qc.refetchQueries({ queryKey: ['conlicitacao-licitacoes-front'], type: 'active' }),
      lista.refetch(),
    ])
  }
  const fontesOk = consultas.filter(q => q.isSuccess).length
  const totalResultados = consultas.reduce((n, q) => n + (q.data?.length ?? 0), 0) + (comprasGov.data?.length ?? 0) + (conlicitacao.data?.length ?? 0)
  const totalComCandidato = elegiveis.filter(o => {
    const q = porUf.get((o.uf ?? '').trim().toUpperCase())
    return (q?.data || comprasGov.data) && candidatos(o, [...(q?.data ?? []), ...(comprasGov.data ?? []), ...(conlicitacao.data ?? [])]).length > 0
  }).length
  const criticos = elegiveis.filter(o => { const q=porUf.get((o.uf??'').trim().toUpperCase()); const ms=candidatos(o,[...(q?.data??[]),...(comprasGov.data??[]),...(conlicitacao.data??[])]); return alertaNoc(o,ms,q,comprasGov,conlicitacao).nivel==='critico' }).length
  const atencao = elegiveis.filter(o => { const q=porUf.get((o.uf??'').trim().toUpperCase()); const ms=candidatos(o,[...(q?.data??[]),...(comprasGov.data??[]),...(conlicitacao.data??[])]); return alertaNoc(o,ms,q,comprasGov,conlicitacao).nivel==='atencao' }).length
  return <section className="mt-5 space-y-5" aria-label="Monitoramento de licitações">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-gold">Módulo de inteligência de certames</p><h1 className="mt-1 text-2xl text-ink">Monitoramento de licitações</h1><p className="mt-1 max-w-3xl text-sm text-muted">Central de comando de certames: dados da contratação, nível de atenção e próxima ação diretamente no Radar. Consulta somente leitura; sem alteração no banco do Radar.</p></div>
      <button onClick={consultarNovamente} disabled={atualizando} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"><RefreshCw className={'size-4 ' + (atualizando ? 'animate-spin' : '')}/> Atualizar consultas</button>
    </div>
    {lista.error && <div role="alert" className="rounded-lg border border-st-critical/30 bg-surface p-4 text-sm text-ink-soft">Não foi possível ler as oportunidades do Radar: {(lista.error as Error).message}</div>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{label:'Oportunidades acompanhadas',value:lista.isPending?'—':elegiveis.length},{label:'Consultas por UF',value:ufs.length},{label:'Com correspondência candidata',value:lista.isPending?'—':totalComCandidato},{label:'Alertas críticos',value:lista.isPending?'—':criticos}].map(k=><div key={k.label} className="rounded-xl border border-line bg-surface p-4 shadow-card"><p className="text-xs text-muted">{k.label}</p><p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink">{k.value}</p></div>)}
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-st-critical/30 bg-surface p-4"><div className="flex items-center gap-2 text-sm font-semibold text-ink"><AlertTriangle className="size-4 text-st-critical"/>Ação necessária</div><p className="mt-1 text-xs text-muted">{criticos} oportunidade(s) exigem correção de cadastro, validação ou nova consulta.</p></div>
      <div className="rounded-xl border border-st-warning/30 bg-surface p-4"><div className="flex items-center gap-2 text-sm font-semibold text-ink"><Clock3 className="size-4 text-st-warning"/>Em revisão</div><p className="mt-1 text-xs text-muted">{atencao} oportunidade(s) precisam de conferência operacional.</p></div>
      <div className="rounded-xl border border-st-success/30 bg-surface p-4"><div className="flex items-center gap-2 text-sm font-semibold text-ink"><CheckCircle2 className="size-4 text-st-success"/>Correspondências candidatas</div><p className="mt-1 text-xs text-muted">{totalComCandidato} oportunidade(s) têm registros para conferir nas fontes consultadas.</p></div>
    </div>
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-soft"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted"/><p>O PNCP retorna contratações com propostas abertas nesta consulta. Isso não cobre, por si só, sessões encerradas, alterações em tempo real ou todos os portais. Correspondência automática é hipótese e precisa ser confirmada com o identificador oficial.</p></div>
    <div className="rounded-xl border border-line bg-surface p-4">
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg text-ink">Teste da fonte alternativa · Compras.gov.br</h2><p className="text-xs text-muted">Pregões e licitações legadas publicados nos últimos 45 dias · somente leitura</p></div><span className="rounded-md border border-line px-2 py-1 text-xs text-muted">{comprasGov.isSuccess ? (comprasGov.data?.length ?? 0)+' registros' : comprasGov.isError ? 'Fonte indisponível' : 'Consultando…'}</span></div>
      {comprasGov.isPending ? <p className="py-4 text-sm text-muted">Consultando a API oficial de Dados Abertos do Compras.gov.br…</p> : comprasGov.isError ? <div role="alert" className="py-3 text-sm text-st-critical">Falha na consulta Compras.gov.br: {(comprasGov.error as Error)?.message || 'erro desconhecido'}</div> : (comprasGov.data ?? []).length === 0 ? <p className="py-4 text-sm text-muted">A API respondeu, mas não retornou registros no período consultado.</p> : <div className="mt-3 space-y-2">{(comprasGov.data ?? []).slice(0,8).map((item,i)=><div key={item.id_compra || item.numeroControlePNCP || i} className="rounded-lg border border-line p-3"><p className="text-sm font-semibold text-ink">{item.orgaoEntidade?.razaoSocial || item.unidadeOrgao?.nomeUnidade || 'Órgão não informado'} · {item.modalidadeNome || 'Pregão/licitação'}</p><p className="mt-1 text-xs text-ink-soft">{item.processo ? 'Processo/pregão '+item.processo+' · ' : ''}{item.objetoCompra || 'Objeto não informado'}</p><p className="mt-1 text-xs text-muted">Situação: {item.situacaoCompraNome || 'Não informada'} · Publicação: {data(item.dataPublicacaoPncp)} · Encerramento: {data(item.dataEncerramentoProposta)} · UASG: {item.unidadeOrgao?.codigoUnidade || 'Não informada'}</p></div>)}</div>}
    </div>
      <div className="rounded-xl border border-line bg-surface p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg text-ink">ConLicitações · fonte autenticada</h2><p className="text-xs text-muted">Boletins associados à conta · credencial mantida somente no servidor</p></div><span className="rounded-md border border-line px-2 py-1 text-xs text-muted">{conlicitacao.isSuccess ? (conlicitacao.data?.length ?? 0)+' registros' : conlicitacao.isError ? 'Configuração/consulta pendente' : 'Consultando…'}</span></div>
        {conlicitacao.isPending ? <p className="py-4 text-sm text-muted">Consultando boletins da ConLicitações…</p> : conlicitacao.isError ? <div role="alert" className="py-3 text-sm text-st-critical">{(conlicitacao.error as Error)?.message || 'ConLicitações indisponível'}. Configure CONLICITACAO_TOKEN no ambiente seguro do deploy e confirme a autorização do IP de saída.</div> : (conlicitacao.data ?? []).length === 0 ? <p className="py-4 text-sm text-muted">A API respondeu, mas não retornou licitações nos últimos boletins dos filtros configurados.</p> : <div className="mt-3 space-y-2">{(conlicitacao.data ?? []).slice(0,8).map((item,i)=><div key={item.numeroControlePNCP || item.processo || i} className="rounded-lg border border-line p-3"><p className="text-sm font-semibold text-ink">{item.orgaoEntidade?.razaoSocial || item.unidadeOrgao?.nomeUnidade || 'Órgão não informado'} · {item.modalidadeNome || 'Licitação'}</p><p className="mt-1 text-xs text-ink-soft">{item.processo ? 'Edital/processo '+item.processo+' · ' : ''}{item.objetoCompra || 'Objeto não informado'}</p><p className="mt-1 text-xs text-muted">Situação: {item.situacaoCompraNome || 'Não informada'} · Abertura: {data(item.dataEncerramentoProposta)} · UF: {item.unidadeOrgao?.ufSigla || '—'} · Fonte: ConLicitações</p>{item.url && <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline" href={item.url} target="_blank" rel="noreferrer">Ver fonte original <ExternalLink className="size-3"/></a>}</div>)}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg text-ink">Oportunidades em acompanhamento</h2><p className="text-xs text-muted">Fonte: cadastro existente do Radar · Sem escrita no banco</p></div>
        <div className="flex flex-wrap gap-2">{['Todos','Prospect','Go','On going','Suspended'].map(s=><button key={s} onClick={()=>setFiltroStatus(s)} className={'rounded-lg border px-3 py-1.5 text-xs font-semibold '+(filtroStatus===s?'border-gold bg-gold-soft text-ink':'border-line text-muted hover:bg-surface-2')}>{s}</button>)}</div>
      </div>
      <div className="relative mt-4"><Search className="absolute left-3 top-2.5 size-4 text-muted"/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar órgão, processo, UASG ou objeto..." className="w-full rounded-lg border border-line bg-surface px-9 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40"/></div>
      {lista.isPending ? <p className="py-10 text-center text-sm text-muted">Carregando oportunidades…</p> : linhas.length===0 ? <p className="py-10 text-center text-sm text-muted">Nenhuma oportunidade encontrada para este filtro.</p> : <div className="mt-4 space-y-3">{linhas.map(o=>{
        const uf=(o.uf??'').trim().toUpperCase()
        const consulta=porUf.get(uf)
        const matches=candidatos(o,[...(consulta?.data ?? []), ...(comprasGov.data ?? []), ...(conlicitacao.data ?? [])])
        return <article key={o.id} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="font-semibold text-ink">{(o.codigo ?? '#'+o.id) + ' · ' + o.orgao}</p><p className="mt-1 text-sm text-ink-soft">{o.descritivo || o.objeto || 'Sem descrição do objeto'}</p><p className="mt-1 text-xs text-muted">Processo/pregão: {o.processo || 'Não informado'} · UASG: {o.uasg || '—'} · UF: {uf || '—'}</p><p className="mt-1 text-xs text-muted">Portal informado: {o.site || 'Não informado'} · Pregão: {data(o.data_pregao_dt)}</p></div><span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink">{o.status}</span></div>
          {(() => { const alerta = alertaNoc(o, matches, consulta, comprasGov, conlicitacao); const cor = alerta.nivel==='critico' ? 'border-st-critical/30 bg-st-critical/5' : 'border-st-warning/30 bg-st-warning/5'; return <div className={'mt-3 rounded-lg border p-3 '+cor}><div className="flex items-center gap-2 text-sm font-semibold text-ink">{alerta.nivel==='critico' ? <AlertTriangle className="size-4 text-st-critical"/> : <Clock3 className="size-4 text-st-warning"/>}{alerta.titulo}</div><p className="mt-1 text-sm text-ink-soft"><strong>Próxima ação:</strong> {alerta.acao}</p></div> })()}
          <div className="mt-3 border-t border-line pt-3">
            {!uf ? <p className="text-xs text-muted">Consulta não executada: esta oportunidade está sem UF válida no cadastro.</p> :
            matches.length > 0 ? <div className="space-y-2"><p className="text-xs font-semibold text-ink"><Activity className="mr-1 inline size-3.5"/>Registros encontrados nas fontes públicas — confira os dados</p>{matches.map((m,i)=><div key={m.item.numeroControlePNCP || m.item.id_compra || i} className="rounded-md bg-surface-2 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-medium text-ink">{m.item.orgaoEntidade?.razaoSocial || 'Órgão não informado'} · {m.item.unidadeOrgao?.nomeUnidade || 'Unidade não informada'}</p><span className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">Compatibilidade {m.score}</span></div><p className="mt-1 text-xs text-ink-soft">{(m.item.processo ? 'Processo '+m.item.processo+' · ' : '')+(m.item.objetoCompra || m.item.informacaoComplementar || 'Objeto não informado')}</p><p className="mt-1 text-xs text-muted">{m.motivos.join(' · ')} · Fonte: {m.item.source || 'PNCP'} · Situação: {m.item.situacaoCompraNome || 'Não informada'} · Encerramento: {data(m.item.dataEncerramentoProposta)}</p>{m.url && <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline" href={m.url} target="_blank" rel="noreferrer">Ver fonte oficial <ExternalLink className="size-3"/></a>}</div>)}</div> :
            consulta?.isPending || !consulta || comprasGov.isPending ? <p className="text-xs text-muted">Consultando PNCP e Compras.gov.br para esta oportunidade…</p> :
            <div className="text-xs text-muted"><p>Nenhum candidato compatível nos resultados retornados pelas fontes públicas para {uf}.</p>{consulta?.isError && <p className="mt-1 break-words text-st-critical">PNCP: {(consulta.error as Error)?.message || 'falha de rede'}</p>}{comprasGov.isError && <p className="mt-1 break-words text-st-critical">Compras.gov.br: {(comprasGov.error as Error)?.message || 'falha de consulta'}</p>}<button type="button" onClick={() => { qc.refetchQueries({ queryKey: ['pncp-licitacoes-front', uf], type: 'active' }); qc.refetchQueries({ queryKey: ['comprasgov-licitacoes-front'], type: 'active' }) }} className="mt-1 font-semibold underline">Tentar novamente nas fontes</button></div>}
          </div>          </div>
        </article>
      })}</div>}
      <p className="mt-4 text-xs text-muted">Fontes consultadas: PNCP {fontesOk}/{ufs.length} UFs · Compras.gov.br {comprasGov.isSuccess ? 'OK' : comprasGov.isError ? 'com erro' : 'consultando'} · ConLicitações {conlicitacao.isSuccess ? 'OK' : conlicitacao.isError ? 'com erro/configuração pendente' : 'consultando'} · {totalResultados} registros recebidos · Cache de 5 minutos. A interface mostra o estado da consulta atual; detecção histórica de alterações exige snapshots persistentes, ainda não habilitados nesta etapa.</p>
    </div>
  </section>
}
