import { fmtInt } from '@/lib/format'

export function Header({ total, all, updatedAt, noYear }: { total: number; all: number; updatedAt: string | null; noYear: boolean }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4.5 border-b border-line pb-5 max-sm:items-start">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.12em] text-gold">CTC · Pré-Vendas · Editais Governo</div>
        <h1 className="text-[clamp(24px,4vw,36px)] text-brand-ink">Radar Pré-Vendas</h1>
        <div className="mt-1.5 max-w-[56ch] text-[14.5px] text-ink-soft">
          Arquitetura de métricas, diagnóstico da base e plano de ação — com filtros por ano, mês, linha de serviço, torre e status.
        </div>
      </div>
      <div className="text-right text-[12.5px] text-muted max-sm:w-full max-sm:text-left">
        <div>
          Base carregada: <strong className="font-mono text-[13px] text-ink">{noYear ? '—' : `${fmtInt(total)}${total !== all ? ` de ${fmtInt(all)}` : ''}`}</strong> oportunidades
        </div>
        <div>
          Última atualização: <strong className="font-mono text-[13px] text-ink">{updatedAt ?? '—'}</strong>
        </div>
      </div>
    </header>
  )
}
