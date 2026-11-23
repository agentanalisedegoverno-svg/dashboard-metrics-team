import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { STATUS_EMOJI } from '@/domain/metrics'
import type { Oportunidade } from '@/domain/oportunidade'
import { cn } from '@/lib/utils'
import { Dica, DicaOportunidade, ID_DICA } from './DicaOportunidade'
import { brl, pct, pregaoBr } from './formato'

/** Texto sempre em tinta padrão (contraste AA); a cor do status vai no ponto. */
export const Selo = ({ status }: { status: string | null }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-line-soft px-2 py-0.5 text-xs font-semibold text-ink">
    <span aria-hidden data-status={status ?? ''}>{STATUS_EMOJI[status ?? ''] ?? '⚪'}</span>
    {status ?? '—'}
  </span>
)

/** Oportunidades do segmento Corporate: nome (sigla e órgão) em azul. Os demais seguem a tinta padrão. */
const nomeCorporate = (o: Oportunidade) => (o.segmento === 'Corporate' ? 'font-semibold text-corporate' : '')

const colunas: ColumnDef<Oportunidade>[] = [
  { accessorKey: 'codigo', header: 'Código', size: 100, cell: (c) => <span className="font-mono text-xs">{c.getValue<string | null>() ?? '—'}</span> },
  { accessorKey: 'status', header: 'Status', size: 110, cell: (c) => <Selo status={c.getValue<string | null>()} /> },
  { accessorKey: 'sigla', header: 'Sigla', size: 90, cell: (c) => <span className={nomeCorporate(c.row.original)}>{c.getValue<string | null>() ?? ''}</span> },
  { accessorKey: 'orgao', header: 'Órgão', size: 260, cell: (c) => <span className={cn('line-clamp-1', nomeCorporate(c.row.original))} title={c.getValue<string>() ?? ''}>{c.getValue<string>() ?? '—'}</span> },
  { accessorKey: 'processo', header: 'Processo/Pregão', size: 140 },
  { accessorKey: 'data_pregao_dt', header: 'Pregão', size: 135, cell: (c) => pregaoBr(c.getValue<string | null>(), c.row.original.hora_pregao) },
  { accessorKey: 'torre', header: 'Torre', size: 90 },
  { accessorKey: 'linha_servico', header: 'Linha de serviço', size: 170 },
  { accessorKey: 'uf', header: 'UF', size: 60 },
  { accessorKey: 'analista', header: 'Pré-vendas', size: 190, cell: (c) => <span className="line-clamp-1" title={c.getValue<string>() ?? ''}>{c.getValue<string>() ?? ''}</span> },
  {
    accessorKey: 'orcamento',
    header: 'Orçamento',
    size: 130,
    meta: { direita: true },
    cell: (c) => (c.row.original.orcamento_sigiloso ? <em className="text-muted">Sigiloso</em> : brl(c.getValue<number | null>())),
  },
  { accessorKey: 'valor_ctc', header: 'Valor CTC', size: 130, meta: { direita: true }, cell: (c) => brl(c.getValue<number | null>()) },
  { accessorKey: 'impostos', header: 'Impostos', size: 100, meta: { direita: true }, cell: (c) => pct(c.getValue<number | null>()) },
  {
    id: 'pendencias',
    header: 'Pendências',
    size: 100,
    accessorFn: (r) => r.pendencias?.length ?? 0,
    cell: (c) => (c.getValue<number>() ? <span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs font-semibold text-gold">{c.getValue<number>()}</span> : null),
  },
]

const LARGURA = colunas.reduce((n, c) => n + (c.size ?? 100), 0)
const ALTURA_LINHA = 40
const ALTURA_CARD = 96

/** Seleção em lote (só administradores): `selecionavel` diz quais linhas aceitam a caixa; `marcados` são os ids marcados. */
export type Selecao = { marcados: ReadonlySet<number>; selecionavel: (o: Oportunidade) => boolean; alternar: (id: number) => void; alternarTodas: (ids: number[], marcar: boolean) => void }

type Props = { dados: Oportunidade[]; onAbrir: (o: Oportunidade) => void; compacto: boolean; selecao?: Selecao }

export function OportunidadesGrid({ dados, onAbrir, compacto, selecao }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'data_pregao_dt', desc: true }])
  const tabela = useReactTable({ data: dados, columns: colunas, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })
  const linhas = tabela.getRowModel().rows
  const pai = useRef<HTMLDivElement>(null)
  const [dica, setDica] = useState<Dica | null>(null)
  const virtual = useVirtualizer({ count: linhas.length, getScrollElement: () => pai.current, estimateSize: () => (compacto ? ALTURA_CARD : ALTURA_LINHA), overscan: 12 })
  const itens = virtual.getVirtualItems()
  const elegiveis = selecao ? dados.filter(selecao.selecionavel).map((o) => o.id) : []
  const marcadasElegiveis = selecao ? elegiveis.filter((id) => selecao.marcados.has(id)).length : 0
  const todasMarcadas = elegiveis.length > 0 && marcadasElegiveis === elegiveis.length

  if (compacto) {
    return (
      <div ref={pai} className="h-[70vh] overflow-auto rounded-[10px] border border-line bg-surface" role="list" aria-label="Oportunidades">
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {itens.map((v) => {
            const o = linhas[v.index].original
            return (
              <div key={o.id} role="listitem" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}>
                {selecao?.selecionavel(o) && (
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${o.codigo ?? o.orgao ?? 'oportunidade'} para arquivar`}
                    className="absolute left-3 top-1/2 z-[1] size-5 -translate-y-1/2 cursor-pointer accent-[var(--gold)]"
                    checked={selecao.marcados.has(o.id)}
                    onChange={() => selecao.alternar(o.id)}
                  />
                )}
                <button
                  onClick={() => onAbrir(o)}
                  className={cn(
                    'size-full cursor-pointer border-b border-line-soft py-2 pr-4 text-left hover:bg-line-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold',
                    selecao?.selecionavel(o) ? 'pl-11' : 'pl-4',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Selo status={o.status} />
                    <span className="font-mono text-xs text-muted">{o.codigo ?? ''}</span>
                    <span className="text-xs text-muted">{pregaoBr(o.data_pregao_dt, o.hora_pregao)}</span>
                  </div>
                  <p className={cn('mt-1 line-clamp-1 text-[13px] font-semibold', o.segmento === 'Corporate' ? 'text-corporate' : 'text-ink')}>{o.orgao ?? '—'}</p>
                  <p className="line-clamp-1 text-xs text-muted">{[o.processo, o.torre, o.uf].filter(Boolean).join(' · ')}</p>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div ref={pai} onScroll={() => setDica(null)} className="h-[70vh] overflow-auto rounded-[10px] border border-line bg-surface">
      <DicaOportunidade dica={dica} />
      <table className="w-full border-collapse text-[13px]" style={{ minWidth: LARGURA + (selecao ? 40 : 0) }} aria-rowcount={linhas.length + 1}>
        <thead className="sticky top-0 z-10 bg-surface-2">
          {tabela.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {selecao && (
                <th scope="col" style={{ width: 40 }} className="border-b border-line px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas as Radar-TIC da lista para arquivar"
                    title="Seleciona todas as oportunidades Radar-TIC ativas que estão na lista (com os filtros aplicados)"
                    className="size-4 cursor-pointer accent-[var(--gold)] disabled:cursor-not-allowed"
                    disabled={elegiveis.length === 0}
                    checked={todasMarcadas}
                    ref={(el) => { if (el) el.indeterminate = marcadasElegiveis > 0 && !todasMarcadas }}
                    onChange={(e) => selecao.alternarTodas(elegiveis, e.target.checked)}
                  />
                </th>
              )}
              {g.headers.map((h) => {
                const dir = h.column.getIsSorted()
                const direita = (h.column.columnDef.meta as { direita?: boolean } | undefined)?.direita
                return (
                  <th
                    key={h.id}
                    scope="col"
                    style={{ width: h.getSize() }}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                    className={cn('border-b border-line px-3 py-2 text-xs font-semibold text-ink-soft', direita ? 'text-right' : 'text-left')}
                  >
                    <button onClick={h.column.getToggleSortingHandler()} className="inline-flex cursor-pointer items-center gap-1 hover:text-ink focus-visible:outline-2 focus-visible:outline-gold">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {dir === 'asc' ? <ArrowUp className="size-3" /> : dir === 'desc' ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                    </button>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {itens.length > 0 && <tr aria-hidden style={{ height: itens[0].start }} />}
          {itens.map((v) => {
            const linha = linhas[v.index]
            return (
              <tr
                key={linha.id}
                tabIndex={0}
                aria-rowindex={v.index + 2}
                onClick={() => onAbrir(linha.original)}
                onMouseEnter={(e) => setDica({ o: linha.original, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setDica(null)}
                onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); setDica({ o: linha.original, x: r.left + 24, y: r.top + r.height / 2 }) }}
                onBlur={() => setDica(null)}
                aria-describedby={dica?.o.id === linha.original.id ? ID_DICA : undefined}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onAbrir(linha.original))}
                style={{ height: ALTURA_LINHA }}
                className="cursor-pointer border-b border-line-soft hover:bg-line-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
              >
                {selecao && (
                  <td className="px-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    {selecao.selecionavel(linha.original) && (
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${linha.original.codigo ?? linha.original.orgao ?? 'oportunidade'} para arquivar`}
                        className="size-4 cursor-pointer accent-[var(--gold)]"
                        checked={selecao.marcados.has(linha.original.id)}
                        onChange={() => selecao.alternar(linha.original.id)}
                      />
                    )}
                  </td>
                )}
                {linha.getVisibleCells().map((c) => (
                  <td key={c.id} className={cn('truncate px-3', (c.column.columnDef.meta as { direita?: boolean } | undefined)?.direita && 'text-right tabular-nums')}>
                    {flexRender(c.column.columnDef.cell ?? ((x) => x.getValue() ?? '—'), c.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
          {itens.length > 0 && <tr aria-hidden style={{ height: virtual.getTotalSize() - itens[itens.length - 1].end }} />}
        </tbody>
      </table>
      {linhas.length === 0 && <p className="p-6 text-center text-[13px] text-muted">Nenhuma oportunidade com esses filtros.</p>}
    </div>
  )
}
