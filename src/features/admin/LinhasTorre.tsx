import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { torreDaLinha } from '@/domain/oportunidade'
import { useSalvarLinhaTorre, useSalvarOpcao, type Opcoes } from '../oportunidades/api'

const campo = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40'

/** Qual torre cada linha de serviço produz. O administrador troca a torre de uma linha ou cadastra uma linha nova já com a torre. */
export function LinhasTorre({ opcoes }: { opcoes: Opcoes }) {
  const salvar = useSalvarLinhaTorre()
  const salvarOpcao = useSalvarOpcao()
  const [nova, setNova] = useState('')
  const [torreNova, setTorreNova] = useState('ITS')
  const mapa = opcoes.linhasTorre ?? {}
  const linhas = (opcoes.listas.linha_servico ?? []).filter((o) => o.ativo).map((o) => o.valor)
  const torres = (opcoes.listas.torre ?? []).filter((o) => o.ativo).map((o) => o.valor)
  // Linhas mapeadas que não estão (mais) na lista de opções também aparecem, para não esconder regra.
  const extras = Object.keys(mapa).filter((l) => !linhas.includes(l))
  const erro = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')
  const ocupado = salvar.isPending || salvarOpcao.isPending

  return (
    <div>
      <h2 className="font-serif text-lg font-semibold text-ink">Linha de serviço → Torre</h2>
      <p className="mt-0.5 max-w-[70ch] text-xs text-muted">
        A torre é calculada pela linha de serviço: a linha vai para a torre indicada abaixo e <strong>qualquer linha sem torre definida é ITS</strong>.
        A mudança vale para os próximos cadastros e para as oportunidades que forem salvas de novo; as já gravadas não mudam sozinhas.
        As torres disponíveis são as da lista <em>Torre</em> (em Listas).
      </p>
      <div className="mt-4 overflow-x-auto rounded-[10px] border border-line bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">Linha de serviço e a torre resultante</caption>
          <thead className="bg-surface-2 text-xs text-ink-soft">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Linha de serviço</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Torre</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Origem</th>
            </tr>
          </thead>
          <tbody>
            {[...linhas, ...extras].map((l) => {
              const atual = torreDaLinha(mapa, l) ?? 'ITS'
              const opcoesTorre = torres.includes(atual) ? torres : [...torres, atual]
              return (
                <tr key={l} className="border-t border-line-soft">
                  <td className="px-3 py-2">{l}{extras.includes(l) && <span className="ml-2 text-xs text-muted">(fora da lista de opções)</span>}</td>
                  <td className="px-3 py-2">
                    <select
                      className={campo}
                      aria-label={`Torre da linha ${l}`}
                      value={atual}
                      disabled={ocupado || extras.includes(l)}
                      onChange={(e) => salvar.mutate({ linha: l, torre: e.target.value }, { onSuccess: () => toast.success('Torre da linha atualizada.'), onError: erro })}
                    >
                      {opcoesTorre.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{l in mapa ? 'definida' : 'padrão (ITS)'}</td>
                </tr>
              )
            })}
            {linhas.length + extras.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">Sem linhas cadastradas.</td></tr>}
          </tbody>
        </table>
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const linha = nova.trim()
          if (!linha) return
          // A linha precisa existir na lista de opções antes de receber torre.
          salvarOpcao.mutate(
            { lista: 'linha_servico', valor: linha, ativo: true, ordem: linhas.length + 1 },
            {
              onError: erro,
              onSuccess: () =>
                salvar.mutate({ linha, torre: torreNova }, { onSuccess: () => { setNova(''); toast.success('Linha cadastrada.') }, onError: erro }),
            },
          )
        }}
      >
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-ink-soft">
          Nova linha de serviço
          <input className={campo} placeholder="Nome da linha" value={nova} onChange={(e) => setNova(e.target.value)} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          Torre
          <select className={campo} aria-label="Torre da nova linha" value={torreNova} onChange={(e) => setTorreNova(e.target.value)}>
            {torres.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <Button type="submit" disabled={ocupado}>Cadastrar linha</Button>
      </form>
    </div>
  )
}
