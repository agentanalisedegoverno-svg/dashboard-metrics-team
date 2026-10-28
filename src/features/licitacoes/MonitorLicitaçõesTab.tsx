import { useMemo, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Activity, ExternalLink, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import { useOportunidades } from '@/features/oportunidades/api'
import type { Oportunidade } from '@/domain/oportunidade'

type PncpItem = {
  numeroControlePNCP?: string; numeroCompra?: string; processo?: string; objetoCompra?: string; informacaoComplementar?: string
  dataPublicacaoPncp?: string; dataEncerramentoProposta?: string; modalidadeNome?: string; situacaoCompraNome?: string
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string }
  unidadeOrgao?: { codigoUnidade?: string; nomeUnidade?: string; ufSigla?: string }
}
type PncpResponse = { data?: PncpItem[]; items?: PncpItem[]; content?: PncpItem[]; resultado?: PncpItem[] }
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
  const url = new URL('/pncp/consulta/v1/contratacoes/proposta', window.location.origin)
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
  return { item: c, score, motivos, url: pncpUrl(c.numeroControlePNCP) }
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
  const consultas = useQueries({ queries: ufs.map(uf => ({
    queryKey: ['pncp-licitacoes-front', uf],
    queryFn: ({ signal }: { signal: AbortSignal }) => consultarPncp(uf, signal),
    staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 0, refetchOnWindowFocus: false,
  })) })
  const atualizando = lista.isFetching || consultas.some(q => q.isFetching)
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
    ])
    await Promise.all([
      qc.refetchQueries({ queryKey: ['pncp-licitacoes-front'], type: 'active' }),
      lista.refetch(),
    ])
  }
  const fontesFalharam = consultas.filter(q => q.isError).length
  const fontesOk = consultas.filter(q => q.isSuccess).length
  const totalResultados = consultas.reduce((n, q) => n + (q.data?.length ?? 0), 0)
  const totalComCandidato = elegiveis.filter(o => {
    const q = porUf.get((o.uf ?? '').trim().toUpperCase())
    return q?.data && candidatos(o, q.data).length > 0
  }).length
  return <section className="mt-5 space-y-5" aria-label="Monitoramento de licitações">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-gold">Módulo de inteligência de certames</p><h1 className="mt-1 text-2xl text-ink">Monitoramento de licitações</h1><p className="mt-1 max-w-3xl text-sm text-muted">Consulta somente leitura às oportunidades do Radar e às contratações abertas publicadas no PNCP. Cache em memória do React Query; nenhuma tabela ou API do Radar é alterada por este módulo.</p></div>
      <button onClick={consultarNovamente} disabled={atualizando} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"><RefreshCw className={'size-4 ' + (atualizando ? 'animate-spin' : '')}/> Atualizar consultas</button>
    </div>
    {lista.error && <div role="alert" className="rounded-lg border border-st-critical/30 bg-surface p-4 text-sm text-ink-soft">Não foi possível ler as oportunidades do Radar: {(lista.error as Error).message}</div>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{label:'Oportunidades acompanhadas',value:lista.isPending?'—':elegiveis.length},{label:'Consultas por UF',value:ufs.length},{label:'Com candidatos no PNCP',value:lista.isPending?'—':totalComCandidato},{label:'UFs com falha',value:fontesFalharam}].map(k=><div key={k.label} className="rounded-xl border border-line bg-surface p-4 shadow-card"><p className="text-xs text-muted">{k.label}</p><p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink">{k.value}</p></div>)}
    </div>
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-soft"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted"/><p>O PNCP consultado retorna contratações com recebimento de propostas. Não garante cobertura de processos encerrados, suspensos ou de portais privados. Compatibilidade é sugestão automática, não confirmação de vínculo oficial.</p></div>
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg text-ink">Oportunidades em acompanhamento</h2><p className="text-xs text-muted">Fonte: cadastro existente do Radar · Sem escrita no banco</p></div>
        <div className="flex flex-wrap gap-2">{['Todos','Prospect','Go','On going','Suspended'].map(s=><button key={s} onClick={()=>setFiltroStatus(s)} className={'rounded-lg border px-3 py-1.5 text-xs font-semibold '+(filtroStatus===s?'border-gold bg-gold-soft text-ink':'border-line text-muted hover:bg-surface-2')}>{s}</button>)}</div>
      </div>
      <div className="relative mt-4"><Search className="absolute left-3 top-2.5 size-4 text-muted"/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar órgão, processo, UASG ou objeto..." className="w-full rounded-lg border border-line bg-surface px-9 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40"/></div>
      {lista.isPending ? <p className="py-10 text-center text-sm text-muted">Carregando oportunidades…</p> : linhas.length===0 ? <p className="py-10 text-center text-sm text-muted">Nenhuma oportunidade encontrada para este filtro.</p> : <div className="mt-4 space-y-3">{linhas.map(o=>{
        const uf=(o.uf??'').trim().toUpperCase()
        const consulta=porUf.get(uf)
        const matches=consulta?.data ? candidatos(o,consulta.data) : []
        return <article key={o.id} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="font-semibold text-ink">{(o.codigo ?? '#'+o.id) + ' · ' + o.orgao}</p><p className="mt-1 text-sm text-ink-soft">{o.descritivo || o.objeto || 'Sem descrição do objeto'}</p><p className="mt-1 text-xs text-muted">Processo/pregão: {o.processo || 'Não informado'} · UASG: {o.uasg || '—'} · UF: {uf || '—'}</p><p className="mt-1 text-xs text-muted">Portal informado: {o.site || 'Não informado'} · Pregão: {data(o.data_pregao_dt)}</p></div><span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink">{o.status}</span></div>
          <div className="mt-3 border-t border-line pt-3">
            {!uf ? <p className="text-xs text-muted">Consulta não executada: esta oportunidade está sem UF válida no cadastro.</p> : consulta?.isPending || !consulta ? <p className="text-xs text-muted">Aguardando consulta do PNCP ({uf})… A consulta será encerrada automaticamente após 12 segundos se a fonte não responder.</p> :
            consulta.isError ? <div className="text-xs text-st-critical"><p>Consulta PNCP indisponível nesta sessão (tempo limite de 12 s ou falha da fonte).</p><p className="mt-1 break-words text-muted">Detalhe técnico: {(consulta.error as Error)?.message || 'Falha de rede ou bloqueio CORS.'}</p><button type="button" onClick={() => qc.refetchQueries({ queryKey: ['pncp-licitacoes-front', uf], type: 'active' })} className="mt-1 font-semibold underline">Tentar novamente nesta UF</button></div> :
            matches.length===0 ? <p className="text-xs text-muted">Nenhum candidato compatível entre os resultados abertos consultados para {uf}. Isso não significa que o certame não exista.</p> :
            <div className="space-y-2"><p className="text-xs font-semibold text-ink"><Activity className="mr-1 inline size-3.5"/>Possíveis correspondências no PNCP</p>{matches.map((m,i)=><div key={m.item.numeroControlePNCP || i} className="rounded-md bg-surface-2 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-medium text-ink">{m.item.orgaoEntidade?.razaoSocial || 'Órgão não informado'} · {m.item.unidadeOrgao?.nomeUnidade || 'Unidade não informada'}</p><span className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">Compatibilidade {m.score}</span></div><p className="mt-1 text-xs text-ink-soft">{(m.item.processo ? 'Processo '+m.item.processo+' · ' : '')+(m.item.objetoCompra || m.item.informacaoComplementar || 'Objeto não informado')}</p><p className="mt-1 text-xs text-muted">{m.motivos.join(' · ')} · Situação: {m.item.situacaoCompraNome || 'Não informada'} · Encerramento: {data(m.item.dataEncerramentoProposta)}</p>{m.url && <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline" href={m.url} target="_blank" rel="noreferrer">Abrir contratação no PNCP <ExternalLink className="size-3"/></a>}</div>)}</div>}
          </div>
        </article>
      })}</div>}
      <p className="mt-4 text-xs text-muted">Fontes consultadas: {fontesOk}/{ufs.length} UFs com resposta · {totalResultados} registros recebidos · Cache de 5 minutos · {fontesFalharam ? fontesFalharam+' consulta(s) com erro' : 'Sem falhas registradas'}.</p>
    </div>
  </section>
}
