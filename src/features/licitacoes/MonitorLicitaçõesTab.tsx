import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, ArrowUpRight, BellRing, CheckCircle2, Clock3, ExternalLink, Link2, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

type Monitor = {
  id: number; oportunidade_id: number; portal: 'PNCP' | 'COMPRAS_GOV' | null; identificador_externo: string | null;
  url_oficial: string | null; habilitado: boolean; estado_vinculo: string; estado_coleta: string;
  ultima_tentativa_em: string | null; ultima_sucesso_em: string | null; proxima_coleta_em: string | null; ultimo_erro: string | null;
  codigo: string | null; status: string; orgao: string; processo: string | null; descritivo: string; objeto: string | null;
  site: string | null; uasg: string | null; data_pregao_dt: string | null; analista: string | null; total_eventos: number; alertas_abertos: number;
}
type Evento = { id: number; monitor_id: number; oportunidade_id: number; codigo: string | null; orgao: string; tipo: string; severidade: string; titulo: string; descricao: string; fonte: string; url_evidencia: string | null; classificacao: string; detectado_em: string; estado_alerta: string | null }
type Resumo = { total: number; habilitados: number; vinculados: number; pendentes: number; falhas: number; alertas: number }
type Payload = { rows: Monitor[]; eventos: Evento[]; resumo: Resumo }
const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const method = init?.method ?? 'GET'
  const res = await fetch(API + path, { ...init, method, credentials: 'same-origin', cache: 'no-store',
    headers: { accept: 'application/json', ...(method !== 'GET' ? { 'x-radar-csrf': '1', 'content-type': 'application/json' } : {}), ...init?.headers } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `Falha na API (HTTP ${res.status})`)
  return body as T
}
const dataHora = (v: string | null) => v ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : 'Ainda não executada'
const pill = (kind: 'ok' | 'warn' | 'bad' | 'neutral') => ({
  ok: 'border-st-good/30 bg-st-good/10 text-st-good',
  warn: 'border-st-warn/35 bg-st-warn/10 text-st-warn',
  bad: 'border-st-critical/35 bg-st-critical/10 text-st-critical',
  neutral: 'border-line bg-surface-2 text-muted',
}[kind])
const statusColeta = (m: Monitor) => m.estado_coleta === 'ok' ? ['Consulta concluída', 'ok'] : m.estado_coleta === 'falha' ? ['Falha na consulta', 'bad'] : m.estado_coleta === 'parcial' ? ['Consulta parcial', 'warn'] : ['Aguardando vínculo/consulta', 'neutral']
const prioridade = (e: Evento) => e.severidade === 'critica' || e.severidade === 'alta' ? 'bad' : e.severidade === 'atencao' ? 'warn' : 'neutral'

function Vincular({ item, onClose }: { item: Monitor; onClose: () => void }) {
  const qc = useQueryClient()
  const [portal, setPortal] = useState<'PNCP' | 'COMPRAS_GOV'>(item.portal === 'COMPRAS_GOV' ? 'COMPRAS_GOV' : 'PNCP')
  const [identificador, setIdentificador] = useState(item.identificador_externo ?? '')
  const [url, setUrl] = useState(item.url_oficial ?? item.site ?? '')
  const [habilitado, setHabilitado] = useState(item.habilitado)
  const salvar = useMutation({
    mutationFn: () => request(`/monitor-licitacoes/${item.oportunidade_id}`, { method: 'PUT', body: JSON.stringify({ portal, identificador_externo: identificador, url_oficial: url, habilitado }) }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['monitor-licitacoes'] }); toast.success('Vínculo de monitoramento salvo'); onClose() },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o vínculo'),
  })
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="vinculo-titulo" className="w-full max-w-xl rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-gold">Vínculo oficial</p><h2 id="vinculo-titulo" className="mt-1 text-xl">Configurar monitoramento</h2><p className="mt-1 text-sm text-muted">{item.codigo ?? `Oportunidade #${item.oportunidade_id}`} · {item.orgao}</p></div><button className="rounded-md px-2 py-1 text-muted hover:text-ink" onClick={onClose} aria-label="Fechar">✕</button></div>
      <p className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-soft">Use o identificador oficial do processo/contratação. Não usamos somente o nome do órgão para afirmar que encontramos o certame correto.</p>
      <label className="mt-4 block text-sm font-medium text-ink">Fonte oficial</label>
      <select value={portal} onChange={e => setPortal(e.target.value as 'PNCP'|'COMPRAS_GOV')} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><option value="PNCP">PNCP — Portal Nacional de Contratações Públicas</option><option value="COMPRAS_GOV">Compras.gov.br — Dados Abertos</option></select>
      <label className="mt-3 block text-sm font-medium text-ink">Identificador oficial</label>
      <input value={identificador} onChange={e => setIdentificador(e.target.value)} maxLength={200} placeholder="Número/ID conforme o portal oficial" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40"/>
      <label className="mt-3 block text-sm font-medium text-ink">URL oficial (opcional)</label>
      <input value={url} onChange={e => setUrl(e.target.value)} maxLength={1000} placeholder="https://..." className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40"/>
      <label className="mt-4 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={habilitado} onChange={e => setHabilitado(e.target.checked)} className="accent-[var(--gold)]"/> Monitoramento habilitado</label>
      <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-line px-3 py-2 text-sm text-ink">Cancelar</button><button disabled={salvar.isPending || !identificador.trim()} onClick={() => salvar.mutate()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-page disabled:opacity-50">{salvar.isPending ? 'Salvando…' : 'Salvar vínculo'}</button></div>
    </section>
  </div>
}

export default function MonitorLicitaçõesTab() {
  const [selecionado, setSelecionado] = useState<Monitor | null>(null)
  const [filtro, setFiltro] = useState<'todos'|'pendentes'|'vinculados'|'falhas'>('todos')
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['monitor-licitacoes'], queryFn: ({ signal }) => request<Payload>('/monitor-licitacoes', { signal }), staleTime: 15_000, refetchInterval: 60_000, retry: false })
  const rows = query.data?.rows ?? []
  const filtradas = useMemo(() => rows.filter(m => filtro === 'todos' || (filtro === 'pendentes' && m.estado_vinculo !== 'vinculado') || (filtro === 'vinculados' && m.estado_vinculo === 'vinculado') || (filtro === 'falhas' && m.estado_coleta === 'falha')), [rows, filtro])
  const resumo = query.data?.resumo
  return <section className="mt-5 space-y-5" aria-label="Monitoramento de licitações">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-gold">Módulo de inteligência de certames</p><h1 className="mt-1 text-2xl text-ink">Monitoramento de licitações</h1><p className="mt-1 max-w-3xl text-sm text-muted">Acompanhe oportunidades do Radar, vínculos oficiais, mudanças publicadas e alertas com histórico e evidência.</p></div><button onClick={() => query.refetch()} disabled={query.isFetching} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"><RefreshCw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`}/> Atualizar painel</button></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      {[
        { label: 'Oportunidades na fila', value: resumo?.total ?? '—', icon: Activity, tone: 'neutral' },
        { label: 'Vínculos oficiais', value: resumo?.vinculados ?? '—', icon: Link2, tone: 'ok' },
        { label: 'Aguardando vínculo', value: resumo?.pendentes ?? '—', icon: Clock3, tone: 'warn' },
        { label: 'Falhas de consulta', value: resumo?.falhas ?? '—', icon: WifiOff, tone: 'bad' },
        { label: 'Alertas em aberto', value: resumo?.alertas ?? '—', icon: BellRing, tone: 'warn' },
      ].map(k => <div key={k.label} className="rounded-xl border border-line bg-surface p-4 shadow-card"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted">{k.label}</span><k.icon className="size-4 text-muted"/></div><p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink">{k.value}</p></div>)}
    </div>
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg text-ink">Processos monitorados</h2><p className="text-xs text-muted">As oportunidades elegíveis entram na fila automaticamente. Para consultar a fonte correta, confirme o identificador oficial.</p></div><div className="flex flex-wrap gap-2">{(['todos','pendentes','vinculados','falhas'] as const).map(v => <button key={v} onClick={() => setFiltro(v)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${filtro===v ? 'border-gold bg-gold-soft text-ink' : 'border-line text-muted hover:bg-surface-2'}`}>{({todos:'Todos',pendentes:'Pendentes',vinculados:'Vinculados',falhas:'Com falha'})[v]}</button>)}</div></div>
      {query.isPending ? <p className="py-10 text-center text-sm text-muted">Carregando monitoramento…</p> : query.error ? <div role="alert" className="mt-4 rounded-lg border border-st-critical/30 bg-surface-2 p-4 text-sm text-ink-soft">Não foi possível carregar o monitoramento. {query.error.message}</div> : filtradas.length===0 ? <div className="py-10 text-center"><Activity className="mx-auto size-7 text-muted"/><p className="mt-2 text-sm text-ink">Nenhuma oportunidade nesta visão.</p><p className="mt-1 text-xs text-muted">O módulo será preenchido quando oportunidades elegíveis forem cadastradas.</p></div> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-left text-sm"><thead><tr className="border-b border-line text-xs text-muted"><th className="px-3 py-3 font-medium">Oportunidade / órgão</th><th className="px-3 py-3 font-medium">Etapa</th><th className="px-3 py-3 font-medium">Fonte e vínculo</th><th className="px-3 py-3 font-medium">Última consulta</th><th className="px-3 py-3 font-medium">Estado</th><th className="px-3 py-3 font-medium">Alertas</th><th className="px-3 py-3 font-medium">Ação</th></tr></thead><tbody>{filtradas.map(m => {const [rotulo,tom]=statusColeta(m) as [string,'ok'|'warn'|'bad'|'neutral']; return <tr key={m.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2/60"><td className="max-w-[280px] px-3 py-3"><p className="font-semibold text-ink">{m.codigo ?? `#${m.oportunidade_id}`} · {m.orgao}</p><p className="mt-0.5 truncate text-xs text-muted">{m.objeto || m.descritivo || m.processo || 'Sem descrição'}</p><p className="mt-1 text-[11px] text-muted">{m.analista || 'Sem responsável'}{m.data_pregao_dt ? ` · Pregão ${m.data_pregao_dt}` : ''}</p></td><td className="px-3 py-3"><span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink">{m.status}</span></td><td className="px-3 py-3"><p className="text-xs font-semibold text-ink">{m.portal === 'COMPRAS_GOV' ? 'Compras.gov.br' : m.portal || 'Fonte não definida'}</p><p className="mt-1 max-w-[190px] truncate text-xs text-muted">{m.identificador_externo || 'Identificador pendente'}</p>{m.url_oficial && <a className="mt-1 inline-flex items-center gap-1 text-xs text-gold hover:underline" href={m.url_oficial} target="_blank" rel="noreferrer">Abrir fonte <ExternalLink className="size-3"/></a>}</td><td className="px-3 py-3 text-xs text-muted">{dataHora(m.ultima_sucesso_em)}<p className="mt-1 text-[11px]">Próxima: {dataHora(m.proxima_coleta_em)}</p></td><td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-medium ${pill(tom)}`}>{rotulo}</span>{m.ultimo_erro && <p className="mt-1 max-w-[170px] text-xs text-st-critical">{m.ultimo_erro}</p>}</td><td className="px-3 py-3"><span className={`font-mono text-sm ${m.alertas_abertos ? 'text-st-warn' : 'text-muted'}`}>{m.alertas_abertos}</span></td><td className="px-3 py-3"><button onClick={() => setSelecionado(m)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"><Link2 className="size-3.5"/>{m.estado_vinculo === 'vinculado' ? 'Editar vínculo' : 'Vincular processo'}</button></td></tr>})}</tbody></table></div>}
    </div>
    <div className="rounded-xl border border-line bg-surface p-4"><div className="flex items-start gap-3"><div className="rounded-lg bg-gold-soft p-2 text-gold"><ShieldAlert className="size-5"/></div><div><h2 className="text-lg text-ink">Critérios de monitoramento</h2><p className="mt-1 max-w-4xl text-sm text-muted">A primeira etapa usa dados públicos estruturados. Uma oportunidade em Prospect, Go, Onboarding ou On going entra na fila, mas a coleta só é considerada confiável depois de confirmar o processo oficial. O módulo não afirma posição em tempo real se a fonte aberta não a disponibilizar.</p><ul className="mt-3 grid gap-2 text-sm text-ink-soft md:grid-cols-2"><li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-st-good"/> Mudança publicada com fonte e horário de observação.</li><li className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-st-warn"/> Diferença entre consultas identificada separadamente de fato publicado.</li><li className="flex gap-2"><WifiOff className="mt-0.5 size-4 shrink-0 text-st-critical"/> Falha mantém o último estado confirmado e aparece como falha.</li><li className="flex gap-2"><ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted"/> Alertas não concluem convocação, vitória ou contratação sem evidência oficial.</li></ul><div className="mt-4 flex flex-wrap gap-3 text-xs"><a className="inline-flex items-center gap-1 text-gold hover:underline" href="https://pncp.gov.br/api/consulta/swagger-ui/index.html" target="_blank" rel="noreferrer">API oficial PNCP <ExternalLink className="size-3"/></a><a className="inline-flex items-center gap-1 text-gold hover:underline" href="https://dadosabertos.compras.gov.br/swagger-ui/index.html" target="_blank" rel="noreferrer">API Dados Abertos Compras.gov.br <ExternalLink className="size-3"/></a></div></div></div></div>
    <div className="rounded-xl border border-line bg-surface p-4"><div className="flex items-center gap-2"><BellRing className="size-4 text-gold"/><h2 className="text-lg text-ink">Eventos recentes</h2></div>{(query.data?.eventos ?? []).length===0 ? <p className="py-5 text-sm text-muted">Ainda não há eventos registrados. Os eventos aparecerão após a primeira coleta bem-sucedida.</p> : <div className="mt-3 divide-y divide-line-soft">{query.data?.eventos.map(e => <article key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pill(prioridade(e) as 'bad'|'warn'|'neutral')}`}>{e.severidade}</span><span className="text-xs text-muted">{e.classificacao === 'publicado' ? 'Publicado pela fonte' : e.classificacao === 'detectado_comparacao' ? 'Detectado por comparação' : 'A validar'}</span><span className="text-xs text-muted">{e.codigo || `#${e.oportunidade_id}`} · {e.orgao}</span></div><p className="mt-1 text-sm font-semibold text-ink">{e.titulo}</p><p className="mt-0.5 text-sm text-muted">{e.descricao}</p><p className="mt-1 text-[11px] text-muted">{e.fonte} · Detectado em {dataHora(e.detectado_em)}</p></div>{e.url_evidencia && <a href={e.url_evidencia} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gold hover:underline">Evidência <ExternalLink className="size-3"/></a>}</article>)}</div>}</div>
    {selecionado && <Vincular item={selecionado} onClose={() => setSelecionado(null)}/>}
  </section>
}
