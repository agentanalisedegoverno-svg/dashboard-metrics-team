import { Card, EmptyNote, Section } from '@/components/Primitives'
import type { Metrics } from '@/domain/metrics'
import type { Row } from '@/domain/types'
import { useDrill } from '@/store/drill'

export type TabProps = { m: Metrics; rows: readonly Row[]; noYear: boolean }

export const useShowDrill = () => useDrill((s) => s.show)

export const emptyMessage = (noYear: boolean) =>
  noYear ? 'Selecione um Ano no filtro acima para carregar os dados.' : 'Nenhuma oportunidade corresponde aos filtros selecionados.'

/** Quando o recorte está vazio: mantém os títulos das seções com o aviso. */
export function EmptySections({ titles, noYear }: { titles: string[]; noYear: boolean }) {
  return (
    <>
      {titles.map((t) => (
        <Section key={t} title={t}>
          <Card>
            <EmptyNote>{emptyMessage(noYear)}</EmptyNote>
          </Card>
        </Section>
      ))}
    </>
  )
}
