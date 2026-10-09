import { useMemo } from 'react'
import { Card, NoteBox, Section, Tag } from '@/components/Primitives'
import { computeMaturity, LEVEL_NAMES } from '@/domain/maturity'
import type { Row } from '@/domain/types'
import { fmtDec1, fmtInt } from '@/lib/format'
import { cn } from '@/lib/utils'

const LACUNAS: { lacuna: React.ReactNode; impacto: string; kind: 'lacuna' | 'inferido' }[] = [
  { lacuna: <>Não existe campo de <b>data da decisão Go/No Go</b> — só Data de distribuição e Data de Pregão.</>, impacto: 'SLA real de triagem não é mensurável; o indicador exibido no Funil de triagem é um proxy (distribuição → pregão).', kind: 'lacuna' },
  { lacuna: 'Valor CTC e MC CTC só são preenchidos quando a oportunidade passa da triagem.', impacto: 'O Pipeline financeiro tem cobertura baixa sobre a base total — leitura de "perda por preço" no agregado é amostral.', kind: 'lacuna' },
  { lacuna: 'Campo Vistoria com alta proporção em "Omissa".', impacto: 'Indica leitura não padronizada da exigência de vistoria no edital, não necessariamente ausência real da exigência.', kind: 'lacuna' },
  { lacuna: 'Motivo do Lost sem categorização padronizada.', impacto: 'Loss Analysis (em Competitividade & conversão) fica limitado a uma única categoria confiável ("Preço").', kind: 'lacuna' },
  { lacuna: 'Torre concentrada em DIGITAL/ITS; Health aparece isoladamente.', impacto: 'Sugere que a linha Health é controlada em outra base/planilha, não nesta.', kind: 'inferido' },
  { lacuna: 'Conta Vinculada e Valor Vencedor ainda incompletos nas oportunidades viáveis.', impacto: 'Alguns processos usam numeração interna/estadual não indexada no PNCP nacional; outros aguardam homologação.', kind: 'lacuna' },
]

export default function MetaTab({ allRows }: { allRows: readonly Row[] }) {
  const mat = useMemo(() => computeMaturity(allRows), [allRows])
  const avg = mat.length ? mat.reduce((a, x) => a + x.level, 0) / mat.length : 0
  const overall = Math.round(avg)
  const p = 'text-[13.5px] leading-[1.6] text-ink-soft'

  return (
    <>
      <Section title="Como os dados são captados">
        <Card>
          <p className={cn(p, 'mb-3')}>
            A base é a planilha de controle interno de editais mantida pela Pré-Vendas, alimentada manualmente a partir da leitura de editais publicados em portais públicos — <b>PNCP</b>, <b>ComprasNet</b> e portais estaduais/municipais. Cada linha representa um edital analisado, com status de triagem, motivo de descarte, responsável, torre/linha de serviço, exigência de vistoria e, quando a oportunidade avança, os campos financeiros (Orçamento, Valor CTC, MC CTC, Valor Vencedor).
          </p>
          <p className={p}>
            Para as oportunidades classificadas como viáveis (status diferente de No Go e Lost), as colunas <b>Conta Vinculada</b> e <b>Valor Vencedor</b> vêm sendo complementadas por consulta direta ao PNCP/ComprasNet. Esse trabalho é mantido sob demanda (disparo manual), nunca com dados estimados ou inventados.
          </p>
        </Card>
      </Section>

      <Section title="O que faltou — lacunas identificadas">
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] max-[520px]:text-xs">
            <thead>
              <tr>{['Lacuna', 'Impacto', 'Classificação'].map((h) => <th key={h} className="border-b border-line px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.04em] text-muted">{h}</th>)}</tr>
            </thead>
            <tbody>
              {LACUNAS.map((l, i) => (
                <tr key={i} className="[&:last-child>td]:border-b-0">
                  <td className="border-b border-line-soft px-2.5 py-2.25 text-ink-soft [&_b]:text-ink">{l.lacuna}</td>
                  <td className="border-b border-line-soft px-2.5 py-2.25 text-ink-soft">{l.impacto}</td>
                  <td className="border-b border-line-soft px-2.5 py-2.25"><Tag kind={l.kind} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Nível de maturidade da base">
        <Card>
          <div className="mb-4 flex items-center gap-4.5 rounded-xl bg-surface-2 px-4.5 py-4">
            <div className="font-serif text-[34px] font-semibold text-gold">{mat.length ? `${overall}/4` : '—'}</div>
            <div>
              <div className="text-sm font-semibold">{mat.length ? `${LEVEL_NAMES[overall]} — média ${fmtDec1(avg)} entre as 6 dimensões avaliadas` : '—'}</div>
              <div className="max-w-[52ch] text-[12.5px] text-muted">
                Escala de 4 níveis proposta para esta base: Inicial → Em Estruturação → Gerenciado → Otimizado. Avaliação sobre a base completa ({fmtInt(allRows.length)}), independente dos filtros ativos. <Tag kind="recomendacao" />
              </div>
            </div>
          </div>
          {mat.map((x) => (
            <div key={x.dim} className="grid grid-cols-[220px_1fr_130px] items-center gap-3.5 border-b border-line-soft py-2.5 last:border-b-0 max-sm:grid-cols-1 max-sm:gap-1.5 max-sm:py-3">
              <div className="text-[13px] font-semibold text-ink">
                {x.dim}
                <small className="mt-0.5 block text-[11.5px] font-normal text-muted">{x.detail}</small>
              </div>
              <div className="flex gap-1.25 max-sm:order-2" aria-hidden>
                {[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-2 w-5.5 rounded-xs bg-surface-2', i <= x.level && 'bg-gold')} />)}
              </div>
              <div className="text-right text-xs font-semibold text-ink-soft max-sm:text-left">{LEVEL_NAMES[x.level]}</div>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Como este dashboard se mantém atualizado">
        <Card>
          <p className={cn(p, 'mb-2.5')}>
            A planilha vive no computador local da Pré-Vendas — não em um servidor —, então uma atualização "a cada clique salvo" não é tecnicamente possível a partir deste dashboard. O mecanismo disponível é uma tarefa de atualização com <b>disparo manual</b>: quando solicitado, ela relê a planilha mais recente, recalcula todos os indicadores linha a linha e publica o resultado aqui — todos os filtros continuam funcionando normalmente sobre os dados atualizados.
          </p>
          <NoteBox className="mt-0"><b>Defasagem esperada:</b> igual ao intervalo entre um disparo manual e o próximo. <Tag kind="premissa" /></NoteBox>
        </Card>
      </Section>
    </>
  )
}
