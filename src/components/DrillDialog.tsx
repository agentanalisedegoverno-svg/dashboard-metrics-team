import { memo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyNote } from '@/components/Primitives'
import { monthLabel } from '@/lib/format'
import { NV, type Row } from '@/domain/types'
import { useDrill } from '@/store/drill'

const DrillRow = memo(function DrillRow({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3.5 gap-y-1.5 border-b border-line-soft py-2.5 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_52px]">
      <div className="min-w-0 flex-[1_1_220px]">
        <div className="text-[13px] font-semibold text-ink">{r.orgao || NV}</div>
        {r.descritivo && <div className="mt-0.5 text-xs text-ink-soft">{r.descritivo}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-muted">
        <span>{r.processo || '—'}</span>
        <span>{r.uf || '—'}</span>
        <span>{monthLabel(r.mes)}</span>
      </div>
    </div>
  )
})

/** Janela de oportunidades (Processo / Órgão / Descritivo) — reutilizada nos cards de status e nos motivos de No Go. */
export function DrillDialog() {
  const { open, title, rows, close } = useDrill()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <div className="border-b border-line px-5 py-4 pr-12">
          <DialogTitle className="font-sans text-[15.5px] font-semibold text-ink">
            {title} — {rows.length} oportunidade{rows.length === 1 ? '' : 's'} no recorte atual
          </DialogTitle>
          <DialogDescription className="sr-only">Lista de oportunidades do indicador selecionado.</DialogDescription>
        </div>
        <div className="overflow-y-auto px-5 pb-5 pt-1.5">
          {rows.length ? rows.map((r, i) => <DrillRow key={`${r.processo ?? ''}-${i}`} r={r} />) : <EmptyNote>Nenhuma oportunidade neste recorte.</EmptyNote>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
