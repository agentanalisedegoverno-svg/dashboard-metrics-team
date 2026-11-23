import { Archive, Download, Plus } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Oportunidade } from '@/domain/oportunidade'
import { useArquivarLote, useMe, useOpcoes, useOportunidades } from './api'
import { OportunidadeDrawer } from './OportunidadeDrawer'
import { OportunidadesGrid, type Selecao } from './OportunidadesGrid'
import { baixarCsv } from './exportarCsv'
import { MAX_ARQUIVAR_EM_LOTE, SEGMENTOS, STATUS_ARQUIVAR_EM_LOTE } from '@/domain/oportunidade'
import { nomesPreVendas } from '@/domain/preVendas'
import { ESFERAS, faixaInvertida, lerValor, NAO_IDENTIFICADA, naEsfera, naFaixaDeValor } from './filtrosOrgaoValor'
import { anosDisponiveis, intervaloInvertido, MESES, mesDe, mesesDoQuarter, noPeriodo, QUARTERS, semanaDe } from './periodo'

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

/** Só as Radar-TIC ativas podem ser marcadas para arquivar em lote (o servidor confere de novo). */
const selecionavel = (o: Oportunidade) => o.status === STATUS_ARQUIVAR_EM_LOTE && !o.arquivado_em

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
  const [segmento, setSegmento] = useState('')
  const [linha, setLinha] = useState('')
  const [analista, setAnalista] = useState('')
  const [esfera, setEsfera] = useState('')
  const [valorMin, setValorMin] = useState('')
  const [valorMax, setValorMax] = useState('')
  const [soPendencias, setSoPendencias] = useState(false)
  const [periodo, setPeriodo] = useState({ ano: '', quarter: '', mes: '', de: '', ate: '' })
  const [editando, setEditando] = useState<Oportunidade | null | undefined>(undefined)
  const compacto = useMenorQue(768)
  const [marcados, setMarcados] = useState<Set<number>>(() => new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const arquivarLote = useArquivarLote()

  const vMin = lerValor(valorMin)
  const vMax = lerValor(valorMax)
  const dados = useMemo(() => {
    const q = fold(buscaAdiada)
    return (lista.data ?? []).filter(
      (o) =>
        (!status || o.status === status) &&
        (!torre || o.torre === torre) &&
        (!segmento || o.segmento === segmento) &&
        (!linha || o.linha_servico === linha) &&
        (!analista || nomesPreVendas(o.analista).includes(analista)) &&
        noPeriodo(o.data_pregao_dt, periodo) &&
        naEsfera(o, esfera) &&
        naFaixaDeValor(o, vMin, vMax) &&
        (!soPendencias || (o.pendencias?.length ?? 0) > 0) &&
        (!q || fold([o.codigo, o.sigla, o.orgao, o.processo, o.descritivo, o.objeto, o.uasg, o.analista, o.linha_servico].join(' ')).includes(q)),
    )
  }, [lista.data, buscaAdiada, status, torre, segmento, linha, analista, soPendencias, periodo, esfera, vMin, vMax])

  if (me.error || opcoes.error || lista.error) {
    const e = (me.error ?? opcoes.error ?? lista.error) as Error
    return (
      <div role="alert" className="mt-6 rounded-[10px] border border-st-critical/40 bg-surface p-4 text-[13px] text-ink-soft">
        Não foi possível carregar o cadastro. {e.message}
      </div>
    )
  }
  if (!me.data || !opcoes.data || !lista.data) return <p className="mt-6 text-[13px] text-muted">Carregando cadastro…</p>

  // Arquivada não entra em nenhuma conta: contadores e pendências olham só as ativas (a arquivada aparece na lista, se o admin pedir).
  const ativas = lista.data.filter((o) => !o.arquivado_em)
  const arquivadasNaLista = lista.data.length - ativas.length
  const dadosAtivos = dados.filter((o) => !o.arquivado_em).length
  const intervaloRuim = intervaloInvertido(periodo)
  const faixaRuim = faixaInvertida(vMin, vMax)
  const atalho = (de: string, ate: string) => setPeriodo((p) => ({ ...p, de, ate }))
  const hoje = new Date()

  // Arquivamento em lote: só administradores; só Radar-TIC ativas; só o que está visível na lista (filtros aplicados).
  const podeLote = me.data.admin && !me.data.somenteLeitura
  const elegiveisLista = dados.filter(selecionavel)
  const idsParaArquivar = dados.filter((o) => selecionavel(o) && marcados.has(o.id)).map((o) => o.id)
  const selecao: Selecao | undefined = podeLote
    ? {
        marcados,
        selecionavel,
        alternar: (id) => setMarcados((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n }),
        alternarTodas: (ids, marcar) => setMarcados((prev) => { const n = new Set(prev); ids.forEach((id) => (marcar ? n.add(id) : n.delete(id))); return n }),
      }
    : undefined
  const arquivarSelecionadas = async () => {
    setAviso(null)
    try {
      const r = await arquivarLote.mutateAsync(idsParaArquivar)
      setMarcados(new Set())
      setAviso({ tipo: 'ok', texto: `${r.arquivadas} ${r.arquivadas === 1 ? 'oportunidade Radar-TIC arquivada' : 'oportunidades Radar-TIC arquivadas'}.` })
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível arquivar.' })
    } finally {
      setConfirmando(false)
    }
  }

  const valores = (nome: string) => (opcoes.data.listas[nome] ?? []).map((o) => o.valor)
  const pendentes = ativas.filter((o) => (o.pendencias?.length ?? 0) > 0).length

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
        <select aria-label="Filtrar por segmento" className={selectCls} value={segmento} onChange={(e) => setSegmento(e.target.value)}>
          <option value="">Segmento</option>
          {SEGMENTOS.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select aria-label="Filtrar por linha de serviço" className={selectCls} value={linha} onChange={(e) => setLinha(e.target.value)}>
          <option value="">Linha de serviço</option>
          {valores('linha_servico').map((v) => <option key={v}>{v}</option>)}
        </select>
        <select aria-label="Filtrar por pré-vendas" className={selectCls} value={analista} onChange={(e) => setAnalista(e.target.value)}>
          <option value="">Pré-vendas</option>
          {opcoes.data.preVendas.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select aria-label="Filtrar por esfera do órgão" title="Esfera deduzida do nome do órgão (o cadastro não tem esse campo)" className={selectCls} value={esfera} onChange={(e) => setEsfera(e.target.value)}>
          <option value="">Esfera do órgão</option>
          {[...ESFERAS, NAO_IDENTIFICADA].map((v) => <option key={v}>{v}</option>)}
        </select>
        <fieldset className="flex items-center gap-1.5 border-0 p-0" aria-label="Faixa de valor estimado" title="Só entram oportunidades com valor informado (as de orçamento sigiloso ou em branco ficam de fora)">
          <label className="flex items-center gap-1 text-[13px] text-ink-soft">
            Valor de
            <input inputMode="decimal" placeholder="R$ mín" aria-label="Valor estimado mínimo" className={` w-28`} value={valorMin} onChange={(e) => setValorMin(e.target.value)} />
          </label>
          <label className="flex items-center gap-1 text-[13px] text-ink-soft">
            até
            <input inputMode="decimal" placeholder="R$ máx" aria-label="Valor estimado máximo" className={` w-28`} value={valorMax} onChange={(e) => setValorMax(e.target.value)} />
          </label>
        </fieldset>
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
        <fieldset className="flex flex-wrap items-center gap-1.5 border-0 p-0" aria-label="Intervalo da data do pregão">
          <label className="flex items-center gap-1 text-[13px] text-ink-soft">
            Pregão de
            <input type="date" aria-label="Pregão a partir de" className={selectCls} value={periodo.de} max={periodo.ate || undefined} onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))} />
          </label>
          <label className="flex items-center gap-1 text-[13px] text-ink-soft">
            até
            <input type="date" aria-label="Pregão até" className={selectCls} value={periodo.ate} min={periodo.de || undefined} onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))} />
          </label>
          <button type="button" className={`${selectCls} cursor-pointer hover:bg-surface-2`} onClick={() => { const s = semanaDe(hoje); atalho(s.de, s.ate) }}>Esta semana</button>
          <button type="button" className={`${selectCls} cursor-pointer hover:bg-surface-2`} onClick={() => { const s = semanaDe(hoje, 1); atalho(s.de, s.ate) }}>Próxima semana</button>
          <button type="button" className={`${selectCls} cursor-pointer hover:bg-surface-2`} onClick={() => { const m = mesDe(hoje); atalho(m.de, m.ate) }}>Este mês</button>
          {(periodo.de || periodo.ate) && (
            <button type="button" className={`${selectCls} cursor-pointer hover:bg-surface-2`} onClick={() => atalho('', '')}>Limpar datas</button>
          )}
        </fieldset>
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
        {dadosAtivos} de {ativas.length} oportunidades{arquivadasNaLista > 0 ? ` (+${arquivadasNaLista} arquivadas na lista, fora das contas)` : ''} · logado como {me.data.nome ?? me.data.email} ({me.data.perfil})
        {me.data.somenteLeitura ? ' — somente consulta' : ''}
      </p>
      {intervaloRuim && (
        <p role="alert" className="mb-2 text-xs font-semibold text-st-critical">A data inicial é depois da final: nenhuma oportunidade cabe nesse intervalo.</p>
      )}
      {faixaRuim && (
        <p role="alert" className="mb-2 text-xs font-semibold text-st-critical">O valor mínimo é maior que o máximo: nenhuma oportunidade cabe nessa faixa.</p>
      )}
      {podeLote && compacto && elegiveisLista.length > 0 && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            className="size-5 accent-[var(--gold)]"
            aria-label="Selecionar todas as Radar-TIC da lista para arquivar"
            checked={elegiveisLista.every((o) => marcados.has(o.id))}
            onChange={(e) => selecao?.alternarTodas(elegiveisLista.map((o) => o.id), e.target.checked)}
          />
          Selecionar todas as Radar-TIC da lista ({elegiveisLista.length})
        </label>
      )}
      {podeLote && (idsParaArquivar.length > 0 || aviso) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px]" role="region" aria-label="Arquivar Radar-TIC em lote">
          {idsParaArquivar.length > 0 && (
            <>
              <span className="font-semibold text-ink" aria-live="polite">
                {idsParaArquivar.length} {idsParaArquivar.length === 1 ? 'selecionada' : 'selecionadas'} ({STATUS_ARQUIVAR_EM_LOTE})
              </span>
              {idsParaArquivar.length > MAX_ARQUIVAR_EM_LOTE ? (
                <span role="alert" className="text-st-critical">Máximo de {MAX_ARQUIVAR_EM_LOTE} por vez: desmarque algumas.</span>
              ) : confirmando ? (
                <>
                  <span className="text-ink-soft">Arquivar {idsParaArquivar.length} {idsParaArquivar.length === 1 ? 'oportunidade' : 'oportunidades'}? Elas saem das contas e podem ser restauradas depois.</span>
                  <button type="button" onClick={arquivarSelecionadas} disabled={arquivarLote.isPending} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 font-semibold text-page hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                    <Archive className="size-4" /> {arquivarLote.isPending ? 'Arquivando…' : 'Confirmar'}
                  </button>
                  <button type="button" onClick={() => setConfirmando(false)} disabled={arquivarLote.isPending} className={`${selectCls} cursor-pointer hover:bg-surface`}>Cancelar</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => { setAviso(null); setConfirmando(true) }} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 font-semibold text-page hover:opacity-90">
                    <Archive className="size-4" /> Arquivar selecionadas
                  </button>
                  <button type="button" onClick={() => setMarcados(new Set())} className={`${selectCls} cursor-pointer hover:bg-surface`}>Limpar seleção</button>
                </>
              )}
            </>
          )}
          {aviso && (
            <span role={aviso.tipo === 'erro' ? 'alert' : 'status'} className={aviso.tipo === 'erro' ? 'font-semibold text-st-critical' : 'font-semibold text-ink'}>{aviso.texto}</span>
          )}
        </div>
      )}
      <OportunidadesGrid dados={dados} onAbrir={setEditando} compacto={compacto} selecao={selecao} />
      <OportunidadeDrawer aberto={editando !== undefined} onFechar={() => setEditando(undefined)} registro={editando ?? null} opcoes={opcoes.data} me={me.data} />
    </section>
  )
}
