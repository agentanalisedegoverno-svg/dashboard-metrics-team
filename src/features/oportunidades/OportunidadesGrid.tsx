import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Oportunidade } from '@/domain/oportunidade'
import { cn } from '@/lib/utils'
import { brl, dataBr } from './formato'

const STATUS_PONTO: Record<string, string> = { Win: 'bg-st-good', Lost: 'bg-st-critical', 'No Go': 'bg-st-warn' }

/** Texto sempre em tinta padrão (contraste AA); a cor do status vai no ponto. */
export const Selo = ({ status }: { status: string | null }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-line-soft px-2 py-0.5 text-xs font-semibold text-ink">
    <span aria-hidden className={cn('size-2 rounded-full', STATUS_PONTO[status ?? ''] ?? 'bg-muted')} />
    {status ?? '—'}
  </span>
)

const colunas: ColumnDef<Oportunidade>[] = [
  { accessorKey: 'status', header: 'Status', size: 110, cell: (c) => <Selo status={c.getValue<string | null>()} /> },
  { accessorKey: 'orgao', header: 'Órgão', size: 260, cell: (c) => <span className="line-clamp-1" title={c.getValue<string>() ?? ''}>{c.getValue<string>() ?? '—'}</span> },
  { accessorKey: 'processo', header: 'Processo', size: 130 },
  { accessorKey: 'data_pregao_dt', header: 'Pregão', size: 100, cell: (c) => dataBr(c.getValue<string | null>()) },
  { accessorKey: 'torre', header: 'Torre', size: 90 },
  { accessorKey: 'linha_servico', header: 'Linha de serviço', size: 170 },
  { accessorKey: 'uf', header: 'UF', size: 60 },
  { accessorKey: 'analista', header: 'Pré-vendas', size: 130 },
  {
    accessorKey: 'orcamento',
    header: 'Orçamento',
    size: 130,
    meta: { direita: true },
    cell: (c) => (c.row.original.orcamento_sigiloso ? <em className="text-muted">Sigiloso</em> : brl(c.getValue<number | null>())),
  },
  { accessorKey: 'valor_ctc', header: 'Valor CTC', size: 130, meta: { direita: true }, cell: (c) => brl(c.getValue<number | null>()) },
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

type Props = { dados: Oportunidade[]; onAbrir: (o: Oportunidade) => void; compacto: boolean }

export function OportunidadesGrid({ dados, onAbrir, compacto }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'data_pregao_dt', desc: true }])
  const tabela = useReactTable({ data: dados, columns: colunas, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })
  const linhas = tabela.getRowModel().rows
  const pai = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({ count: linhas.length, getScrollElement: () => pai.current, estimateSize: () => (compacto ? ALTURA_CARD : ALTURA_LINHA), overscan: 12 })
  const itens = virtual.getVirtualItems()

  if (compacto) {
    return (
      <div ref={pai} className="h-[70vh] overflow-auto rounded-[10px] border border-line bg-surface" role="list" aria-label="Oportunidades">
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {itens.map((v) => {
            const o = linhas[v.index].original
            return (
              <div key={o.id} role="listitem" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}>
                <button
                  onClick={() => onAbrir(o)}
                  className="size-full cursor-pointer border-b border-line-soft px-4 py-2 text-left hover:bg-line-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Selo status={o.status} />
                    <span className="text-xs text-muted">{dataBr(o.data_pregao_dt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[13px] font-semibold text-ink">{o.orgao ?? '—'}</p>
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
    <div ref={pai} className="h-[70vh] overflow-auto rounded-[10px] border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]" style={{ minWidth: LARGURA }} aria-rowcount={linhas.length + 1}>
        <thead className="sticky top-0 z-10 bg-surface-2">
          {tabela.getHeaderGroups().map((g) => (
            <tr key={g.id}>
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
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onAbrir(linha.original))}
                style={{ height: ALTURA_LINHA }}
                className="cursor-pointer border-b border-line-soft hover:bg-line-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
              >
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
