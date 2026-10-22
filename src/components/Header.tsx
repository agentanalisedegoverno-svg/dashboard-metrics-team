import { Monitor, Moon, Sun } from 'lucide-react'
import { fmtInt } from '@/lib/format'
import { useTema, type EscolhaTema } from '@/lib/tema'
import { cn } from '@/lib/utils'

const OPCOES: { valor: EscolhaTema; rotulo: string; Icone: typeof Sun }[] = [
  { valor: 'sistema', rotulo: 'Tema do sistema', Icone: Monitor },
  { valor: 'claro', rotulo: 'Tema claro', Icone: Sun },
  { valor: 'escuro', rotulo: 'Tema escuro', Icone: Moon },
]

function SeletorTema() {
  const { escolha, definir } = useTema()
  return (
    <div role="group" aria-label="Aparência" className="mb-2 inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {OPCOES.map(({ valor, rotulo, Icone }) => (
        <button
          key={valor}
          type="button"
          aria-label={rotulo}
          aria-pressed={escolha === valor}
          title={rotulo}
          onClick={() => definir(valor)}
          className={cn(
            'inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-gold',
            escolha === valor && 'bg-surface text-ink shadow-card',
          )}
        >
          <Icone className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  )
}

export function Header({ total, all, updatedAt, noYear }: { total: number; all: number; updatedAt: string | null; noYear: boolean }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4.5 border-b border-line pb-5 max-sm:items-start">
      <div className="flex items-center gap-4 max-sm:gap-3">
        {/* O logo é branco: vai numa faixa azul-marinho da marca para aparecer nos temas claro e escuro. */}
        <div className="shrink-0 rounded-xl bg-[#16233f] px-3.5 py-2.5 shadow-card max-sm:px-2.5 max-sm:py-2">
          <img src="/logo-ctc.png" alt="CTC" width={120} height={52} className="h-9 w-auto max-sm:h-7" />
        </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.12em] text-gold">CTC · Pré-Vendas · Editais Governo</div>
        <h1 className="text-[clamp(24px,4vw,36px)] text-brand-ink">Radar Pré-Vendas</h1>
        <div className="mt-1.5 max-w-[56ch] text-[14.5px] text-ink-soft">
          Arquitetura de métricas, diagnóstico da base e plano de ação — com filtros por ano, mês, linha de serviço, torre e status.
        </div>
      </div>
      </div>
      <div className="text-right text-[12.5px] text-muted max-sm:w-full max-sm:text-left">
        <SeletorTema />
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
