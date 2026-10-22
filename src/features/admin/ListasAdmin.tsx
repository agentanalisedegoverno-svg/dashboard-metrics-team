import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSalvarOpcao, type Opcoes } from '../oportunidades/api'

const LISTAS: Record<string, string> = {
  status: 'Status',
  torre: 'Torre',
  linha_servico: 'Linha de serviço',
  unidade_fornecimento: 'Unidade de fornecimento',
  criterio: 'Critério',
  modalidade: 'Modalidade',
  modo_disputa: 'Modo de disputa',
  origem_oportunidade: 'Origem',
  site: 'Site',
  vistoria: 'Vistoria',
  conta_vinculada: 'Conta vinculada',
  motivo_no_go: 'Motivo do No Go',
  motivo_lost: 'Motivo do Lost',
  situacao_lance: 'Situação do lance',
  uf: 'UF',
}

const campo = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40'

export function ListasAdmin({ opcoes }: { opcoes: Opcoes }) {
  const salvar = useSalvarOpcao()
  const [lista, setLista] = useState('status')
  const [novo, setNovo] = useState('')
  const itens = opcoes.listas[lista] ?? []
  const erro = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')

  return (
    <div>
      <h2 className="font-serif text-lg font-semibold text-ink">Listas de opções</h2>
      <p className="mt-0.5 max-w-[70ch] text-xs text-muted">
        Itens desativados deixam de aparecer no cadastro, mas continuam válidos nos registros que já os usam. Nada é apagado.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Listas" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {Object.entries(LISTAS).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              aria-current={lista === k ? 'true' : undefined}
              onClick={() => setLista(k)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-gold',
                lista === k ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-soft hover:bg-line-soft',
              )}
            >
              {rotulo}
              <span className="text-xs text-muted">{(opcoes.listas[k] ?? []).length}</span>
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{LISTAS[lista]}</h3>
          <ul className="mt-2 divide-y divide-line-soft rounded-[10px] border border-line bg-surface">
            {itens.map((o) => (
              <li key={o.valor} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <span className={o.ativo ? 'text-ink' : 'text-muted line-through'}>{o.valor}</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--gold)]"
                    checked={o.ativo}
                    disabled={salvar.isPending}
                    onChange={(e) => salvar.mutate({ lista, valor: o.valor, ativo: e.target.checked, ordem: o.ordem }, { onError: erro })}
                  />
                  Ativo
                </label>
              </li>
            ))}
            {itens.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">Lista vazia.</li>}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!novo.trim()) return
              salvar.mutate(
                { lista, valor: novo.trim(), ativo: true, ordem: itens.length + 1 },
                { onSuccess: () => { setNovo(''); toast.success('Item adicionado.') }, onError: erro },
              )
            }}
          >
            <input className={cn(campo, 'flex-1')} aria-label="Novo item da lista" placeholder="Novo item" value={novo} onChange={(e) => setNovo(e.target.value)} maxLength={120} />
            <Button type="submit" disabled={salvar.isPending}>Adicionar</Button>
          </form>
          {lista === 'linha_servico' && (
            <p className="mt-2 text-xs text-muted">
              Uma linha nova resulta em torre <strong>ITS</strong>, a menos que seja mapeada em <em>Linha → Torre</em>.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
