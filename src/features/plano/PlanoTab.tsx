import { Card, NoteBox, Section, Tag } from '@/components/Primitives'
import { PLANO, type Prioridade } from '@/domain/plano'

const PRIO: Record<Prioridade, string> = { Alta: 'var(--st-critical)', Média: 'var(--gold)', Baixa: 'var(--muted)' }

export default function PlanoTab() {
  return (
    <>
      <Section title="Plano de ação estratégico" note="Baseado nos gargalos confirmados na base completa — cada item com prioridade, responsável sugerido e próximo passo.">
        <Card>
          {PLANO.map((a) => (
            <div key={a.n} className="grid grid-cols-[auto_1fr] gap-3.5 border-b border-line-soft py-4 first:pt-0 last:border-b-0 last:pb-0 max-sm:grid-cols-[28px_1fr] max-sm:gap-2.5">
              <div className="w-8.5 font-serif text-[22px] font-semibold text-gold">{String(a.n).padStart(2, '0')}</div>
              <div>
                <h4 className="mb-1 text-[14.5px] font-semibold text-ink">{a.h}</h4>
                <p className="mb-2 text-[13px] leading-[1.55] text-ink-soft">{a.p}</p>
                <div className="flex flex-wrap gap-2 text-[11px] [&_span]:rounded-md [&_span]:bg-surface-2 [&_span]:px-2 [&_span]:py-0.75 [&_span]:font-medium [&_span]:text-ink-soft [&_b]:font-semibold [&_b]:text-ink">
                  <span>Prioridade: <b style={{ color: PRIO[a.prioridade] }}>{a.prioridade}</b></span>
                  <span>Responsável sugerido: <b>{a.responsavel}</b></span>
                  <span>Próximo passo: <b>{a.proximoPasso}</b></span>
                </div>
              </div>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Modelo de dashboard recomendado">
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr>{['Visão', 'Foco', 'KPIs principais'].map((h) => <th key={h} className="border-b border-line px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.04em] text-muted">{h}</th>)}</tr></thead>
            <tbody>
              {[
                ['Executiva / Diretoria', 'Eficiência e conversão', 'Volume processado, Win Rate, Total ganho (R$), No Go Rate'],
                ['Intersetorial & Portfólio', 'Motivos de perda e gaps de oferta', 'Top motivos de No Go por Torre, faltas de atestado mais recorrentes, incompatibilidade financeira'],
                ['Operacional de Pré-Vendas', 'Produtividade e prazos', 'Oportunidades por analista, distribuição por UF/Órgão, status do pipeline (On going, Validar)'],
              ].map(([a, b, c]) => (
                <tr key={a}>
                  <td className="border-b border-line-soft px-2.5 py-2.25 text-ink-soft last:border-0"><b className="text-ink">{a}</b></td>
                  <td className="border-b border-line-soft px-2.5 py-2.25 text-ink-soft">{b}</td>
                  <td className="border-b border-line-soft px-2.5 py-2.25 text-ink-soft">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <NoteBox>Esta página já implementa as três visões como abas, agora combinadas com filtros de mês, linha de serviço, torre e status. <Tag kind="confirmado" /></NoteBox>
        </Card>
      </Section>
    </>
  )
}
