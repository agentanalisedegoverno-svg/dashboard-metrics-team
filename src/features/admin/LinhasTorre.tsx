import { torreDaLinha } from '@/domain/oportunidade'
import type { Opcoes } from '../oportunidades/api'

/** Consulta: qual torre cada linha de serviço produz (regra da planilha). Edição ainda é por SQL (ver roadmap). */
export function LinhasTorre({ opcoes }: { opcoes: Opcoes }) {
  const mapa = opcoes.linhasTorre ?? {}
  const linhas = (opcoes.listas.linha_servico ?? []).filter((o) => o.ativo).map((o) => o.valor)
  // Linhas mapeadas que não estão (mais) na lista de opções também aparecem, para não esconder regra.
  const extras = Object.keys(mapa).filter((l) => !linhas.includes(l))

  return (
    <div>
      <h2 className="font-serif text-lg font-semibold text-ink">Linha de serviço → Torre</h2>
      <p className="mt-0.5 max-w-[70ch] text-xs text-muted">
        A torre é calculada pela linha de serviço, com a mesma regra da planilha: as linhas abaixo marcadas como DIGITAL ou HEALTH; <strong>qualquer outra linha é ITS</strong>.
        Por enquanto, incluir uma linha nova nesta regra é feito pela equipe técnica (a edição por tela está no roadmap).
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
            {[...linhas, ...extras].map((l) => (
              <tr key={l} className="border-t border-line-soft">
                <td className="px-3 py-2">{l}{extras.includes(l) && <span className="ml-2 text-xs text-muted">(fora da lista de opções)</span>}</td>
                <td className="px-3 py-2 font-semibold">{torreDaLinha(mapa, l)}</td>
                <td className="px-3 py-2 text-xs text-muted">{l in mapa ? 'mapeada' : 'padrão (ITS)'}</td>
              </tr>
            ))}
            {linhas.length + extras.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">Sem linhas cadastradas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
