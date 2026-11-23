import type { Oportunidade } from '@/domain/oportunidade'
import { brl } from './formato'

/** Dica ao passar o mouse (ou focar com o teclado) numa oportunidade: só objeto, valor estimado e duração do contrato. */
export type Dica = { o: Oportunidade; x: number; y: number }

export const ID_DICA = 'dica-oportunidade'
const LARGURA = 256
const ALTURA_ESTIMADA = 120

export const duracaoTexto = (meses: number | null | undefined) => (meses === null || meses === undefined ? '—' : `${meses} ${meses === 1 ? 'mês' : 'meses'}`)

export function DicaOportunidade({ dica }: { dica: Dica | null }) {
  if (!dica) return null
  const { o, x, y } = dica
  // Perto da borda direita/inferior, a caixa abre para o outro lado do cursor.
  const esq = Math.max(8, Math.min(x + 14, window.innerWidth - LARGURA - 8))
  const topo = y + 16 + ALTURA_ESTIMADA > window.innerHeight ? Math.max(8, y - ALTURA_ESTIMADA - 8) : y + 16
  return (
    <div
      id={ID_DICA}
      role="tooltip"
      style={{ position: 'fixed', left: esq, top: topo, width: LARGURA }}
      className="pointer-events-none z-50 rounded-md border border-line bg-surface p-2 text-[12px] leading-snug text-ink shadow-lg"
    >
      <p className="line-clamp-3">
        <span className="font-semibold">Objeto: </span>
        {o.objeto?.trim() || '—'}
      </p>
      <p className="mt-1">
        <span className="font-semibold">Valor estimado: </span>
        {o.orcamento_sigiloso ? <em>Sigiloso</em> : brl(o.orcamento)}
      </p>
      <p className="mt-1">
        <span className="font-semibold">Duração: </span>
        {duracaoTexto(o.duracao_contrato_meses)}
      </p>
    </div>
  )
}
