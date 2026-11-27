import { useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertTriangle, CalendarClock, Clock3, Globe } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { CHECKLIST_PREGAO, rotuloDoSite, type Linha } from './noc'
import { corDoPrazo } from './prazo'

const dataBR = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : 'sem data'
}

type Props = { linha: Linha | null; onCancelar: () => void; onContinuar: (l: Linha) => void }

/**
 * Pop-up que aparece ANTES de abrir o cadastro de um certame com pregão marcado: lembra as conferências que a operação
 * costuma precisar. É um lembrete, não uma trava: marcar os itens ajuda a pessoa a conferir (não é gravado) e "Abrir cadastro"
 * está sempre disponível.
 */
export function ChecklistPregao({ linha, onCancelar, onContinuar }: Props) {
  return (
    <DialogPrimitive.Root open={linha !== null} onOpenChange={(aberto) => !aberto && onCancelar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-100 bg-[rgba(10,14,24,.5)]" />
        {linha && <Conteudo key={linha.o.id} linha={linha} onCancelar={onCancelar} onContinuar={onContinuar} />}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Conteudo({ linha, onCancelar, onContinuar }: { linha: Linha; onCancelar: () => void; onContinuar: (l: Linha) => void }) {
  const { o, a } = linha
  const [marcados, setMarcados] = useState<boolean[]>(() => CHECKLIST_PREGAO.map(() => false))
  const cor = corDoPrazo(a.uteis)
  const faixaCor = a.nivel === 'critico' ? 'border-st-critical/60 bg-st-critical/10' : a.nivel === 'atencao' ? 'border-st-warn/60 bg-st-warn/15' : 'border-line bg-surface-2'
  const Icone = a.nivel === 'critico' ? AlertTriangle : a.nivel === 'atencao' ? Clock3 : CalendarClock
  const site = rotuloDoSite(o.site) ?? 'portal não informado'
  const hora = o.hora_pregao ? ` às ${String(o.hora_pregao).slice(0, 5)}` : ''
  const pendentes = marcados.filter((m) => !m).length

  return (
    <DialogPrimitive.Content
      aria-describedby="checklist-pregao-desc"
      className="fixed left-1/2 top-1/2 z-101 flex max-h-[85vh] w-[calc(100%-40px)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] bg-surface shadow-card outline-none"
    >
      <div className="overflow-y-auto p-5">
        <DialogPrimitive.Title className="font-serif text-xl font-semibold text-ink">Antes de abrir {o.codigo ?? '#' + o.id}</DialogPrimitive.Title>
        <p className="mt-1 text-sm text-ink-soft">{(o.sigla ? o.sigla + ' — ' : '') + o.orgao}</p>

        <div className={'mt-3 rounded-lg border p-3 text-sm ' + faixaCor}>
          <p className="flex items-center gap-2 font-semibold text-ink"><Icone className="size-4 shrink-0" aria-hidden />{a.titulo}</p>
          <p className="mt-1 text-xs text-ink-soft">
            Pregão em <strong>{dataBR(o.data_pregao_dt)}</strong>{hora}
            {cor && a.uteis !== null ? <> · faltam <strong>{a.uteis} dia{a.uteis === 1 ? '' : 's'} útei{a.uteis === 1 ? 'l' : 's'}</strong></> : null}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft"><Globe className="size-3.5 shrink-0" aria-hidden />Site: <strong className="text-ink">{site}</strong></p>
        </div>

        <DialogPrimitive.Description id="checklist-pregao-desc" className="mt-4 text-sm text-ink-soft">
          Confira antes de abrir os dados. Marcar é só para você acompanhar: não é gravado e não impede de abrir.
        </DialogPrimitive.Description>
        <ul className="mt-2 space-y-2" aria-label="Checklist do pregão">
          {CHECKLIST_PREGAO.map((pergunta, i) => {
            const id = `chk-pregao-${i}`
            return (
              <li key={id} className="flex items-start gap-2.5 rounded-lg border border-line p-2.5">
                <Checkbox id={id} checked={marcados[i]} onCheckedChange={(v) => setMarcados((m) => m.map((x, j) => (j === i ? v === true : x)))} className="mt-0.5" />
                <label htmlFor={id} className="cursor-pointer text-sm text-ink">{pergunta.replace('{site}', site)}</label>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-muted" aria-live="polite">{pendentes === 0 ? 'Tudo conferido.' : `${pendentes} ${pendentes === 1 ? 'item' : 'itens'} sem marcar.`}</p>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
        <button type="button" onClick={onCancelar} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2">Cancelar</button>
        <button type="button" onClick={() => onContinuar(linha)} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-page hover:opacity-90">Abrir cadastro</button>
      </div>
    </DialogPrimitive.Content>
  )
}
