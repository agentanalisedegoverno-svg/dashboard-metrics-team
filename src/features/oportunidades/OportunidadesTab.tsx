import { Download, Plus } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Oportunidade } from '@/domain/oportunidade'
import { useMe, useOpcoes, useOportunidades } from './api'
import { OportunidadeDrawer } from './OportunidadeDrawer'
import { OportunidadesGrid } from './OportunidadesGrid'
import { baixarCsv } from './exportarCsv'
import { nomesPreVendas } from '@/domain/preVendas'
import { anosDisponiveis, MESES, mesesDoQuarter, noPeriodo, QUARTERS } from './periodo'

const fold = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function useMenorQue(px: number) {
  const consulta = `(max-width: ${px - 1}px)`
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const m = window.matchMedia(consulta)
    const f = () => setV(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [consulta])
  return v
}

const selectCls = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40'

export default function OportunidadesTab() {
  const me = useMe()
  const opcoes = useOpcoes()
  const [arquivadas, setArquivadas] = useState(false)
  const lista = useOportunidades(arquivadas)
  const [busca, setBusca] = useState('')
  const buscaAdiada = useDeferredValue(busca)
  const [status, setStatus] = useState('')
  const [torre, setTorre] = useState('')
  const [linha, setLinha] = useState('')
  const [analista, setAnalista] = useState('')
  const [soPendencias, setSoPendencias] = useState(false)
  const [periodo, setPeriodo] = useState({ ano: '', quarter: '', mes: '' })
  const [editando, setEditando] = useState<Oportunidade | null | undefined>(undefined)
  const compacto = useMenorQue(768)

  const dados = useMemo(() => {
    const q = fold(buscaAdiada)
    return (lista.data ?? []).filter(
      (o) =>
        (!status || o.status === status) &&
        (!torre || o.torre === torre) &&
        (!linha || o.linha_servico === linha) &&
        (!analista || nomesPreVendas(o.analista).includes(analista)) &&
        noPeriodo(o.data_pregao_dt, periodo) &&
        (!soPendencias || (o.pendencias?.length ?? 0) > 0) &&
        (!q || fold([o.codigo, o.sigla, o.orgao, o.processo, o.descritivo, o.objeto, o.uasg, o.analista, o.linha_servico].join(' ')).includes(q)),
    )
  }, [lista.data, buscaAdiada, status, torre, linha, analista, soPendencias, periodo])

  if (me.error || opcoes.error || lista.error) {
    const e = (me.error ?? opcoes.error ?? lista.error) as Error
    return (
      <div role="alert" className="mt-6 rounded-[10px] border border-st-critical/40 bg-surface p-4 text-[13px] text-ink-soft">
        Não foi possível carregar o cadastro. {e.message}
      </div>
    )
  }
  if (!me.data || !opcoes.data || !lista.data) return <p className="mt-6 text-[13px] text-muted">Carregando cadastro…</p>

  const valores = (nome: string) => (opcoes.data.listas[nome] ?? []).map((o) => o.valor)
  const pendentes = (lista.data ?? []).filter((o) => (o.pendencias?.length ?? 0) > 0).length

  return (
    <section className="mt-5" aria-label="Cadastro de oportunidades">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar código, órgão, processo, descritivo…"
          aria-label="Buscar oportunidades"
          className={`${selectCls} min-w-60 flex-1`}
        />
        <select aria-label="Filtrar por status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Status</option>
          {valores('status').map((v) => <option key={v}>{v}</option>)}
        </select>
        <select aria-label="Filtrar por torre" className={selectCls} value={torre} onChange={(e) => setTorre(e.target.value)}>
          <option value="">Torre</option>
          {valores('torre').map((v) => <option key={v}>{v}</option>)}
        </select>
        <select aria-label="Filtrar por linha de serviço" className={selectCls} value={linha} onChange={(e) => setLinha(e.target.value)}>
          <option value="">Linha de serviço</option>
          {valores('linha_servico').map((v) => <option key={v}>{v}</option>)}
        </select>
        <select aria-label="Filtrar por pré-vendas" className={selectCls} value={analista} onChange={(e) => setAnalista(e.target.value)}>
          <option value="">Pré-vendas</option>
          {opcoes.data.preVendas.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select aria-label="Filtrar por ano do pregão" className={selectCls} value={periodo.ano} onChange={(e) => setPeriodo((p) => ({ ...p, ano: e.target.value }))}>
          <option value="">Ano</option>
          {anosDisponiveis(lista.data.map((o) => o.data_pregao_dt)).map((a) => <option key={a}>{a}</option>)}
        </select>
        <select
          aria-label="Filtrar por quarter do pregão"
          className={selectCls}
          value={periodo.quarter}
          onChange={(e) => setPeriodo((p) => ({ ...p, quarter: e.target.value, mes: '' }))}
        >
          <option value="">Quarter</option>
          {QUARTERS.map((q) => <option key={q} value={q}>{q} ({mesesDoQuarter(q).map((m) => MESES[m - 1].slice(0, 3)).join('/')})</option>)}
        </select>
        <select aria-label="Filtrar por mês do pregão" className={selectCls} value={periodo.mes} onChange={(e) => setPeriodo((p) => ({ ...p, mes: e.target.value }))}>
          <option value="">Mês</option>
          {mesesDoQuarter(periodo.quarter).map((m) => <option key={m} value={m}>{MESES[m - 1]}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-soft">
          <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={soPendencias} onChange={(e) => setSoPendencias(e.target.checked)} />
          Só com pendências ({pendentes})
        </label>
        {me.data.admin && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-soft">
            <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={arquivadas} onChange={(e) => setArquivadas(e.target.checked)} />
            Incluir arquivadas
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => baixarCsv(dados)}
            disabled={dados.length === 0}
            title="Baixa em CSV (abre no Excel) as oportunidades que estão na tela, com os filtros aplicados"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-[7px] text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <Download className="size-4" /> Baixar CSV ({dados.length})
          </button>
          {!me.data.somenteLeitura && (
            <button
              onClick={() => setEditando(null)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3.5 py-[7px] text-[13px] font-semibold text-page hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <Plus className="size-4" /> Nova oportunidade
            </button>
          )}
        </div>
      </div>
      <p className="mb-2 mt-3 text-xs text-muted" aria-live="polite">
        {dados.length} de {lista.data.length} oportunidades · logado como {me.data.nome ?? me.data.email} ({me.data.perfil})
        {me.data.somenteLeitura ? ' — somente consulta' : ''}
      </p>
      <OportunidadesGrid dados={dados} onAbrir={setEditando} compacto={compacto} />
      <OportunidadeDrawer aberto={editando !== undefined} onFechar={() => setEditando(undefined)} registro={editando ?? null} opcoes={opcoes.data} me={me.data} />
    </section>
  )
}
