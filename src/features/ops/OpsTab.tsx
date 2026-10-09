import { useMemo } from 'react'
import { BarList } from '@/components/BarList'
import { DonutCard, StackBar } from '@/components/Charts'
import { KpiCard } from '@/components/KpiCard'
import { Card, KpiGrid, NoteBox, Section, Tag } from '@/components/Primitives'
import { NV } from '@/domain/types'
import { fmtBRLCompact, fmtPct } from '@/lib/format'
import { EmptySections, type TabProps } from '../shared'

const AN_COLORS = ['var(--series-red)', 'var(--series-orange)', 'var(--series-blue)', 'var(--gold)', 'var(--muted)', 'var(--series-violet)']

export function OpsTab({ m, noYear }: TabProps) {
  const analistas = useMemo(
    () => m.analistas.map((a, i) => ({
      label: a.label, count: a.count, pct: a.pctBase, color: AN_COLORS[i] || 'var(--muted)',
      extra: a.pctAtrib != null ? `${fmtPct(a.pctBase)} do recorte · ${fmtPct(a.pctAtrib)} dos atribuídos` : `${fmtPct(a.pctBase)} do recorte`,
    })),
    [m.analistas],
  )
  const uf = useMemo(() => m.uf.map((u) => ({ label: u.label, count: u.count, pct: m.total ? (u.count / m.total) * 100 : 0, color: 'var(--series-blue)', extra: undefined })), [m.uf, m.total])

  if (m.total === 0) return <EmptySections noYear={noYear} titles={['Concentração da equipe de Pré-Vendas', 'Distribuição geográfica (UF)', 'Backlog em andamento', 'Conta Vinculada & Valor Vencedor — cobertura nas oportunidades viáveis']} />

  const top = m.analistas.filter((a) => a.label !== NV).sort((a, b) => b.count - a.count)[0]
  const V = m.viaveis
  const cvSegs = [
    { label: 'Sim', count: V.cvSim, color: 'var(--series-red)' },
    { label: 'Não', count: V.cvNao, color: 'var(--st-good)' },
    { label: 'Sem informação', count: V.cvSem, color: 'var(--muted)' },
  ].filter((s) => s.count > 0)

  return (
    <>
      <Section title="Concentração da equipe de Pré-Vendas" note="Volume por analista responsável, no recorte filtrado.">
        <Card>
          <BarList items={analistas} />
          {top && m.atribCount > 0 && (
            <NoteBox><b>{fmtPct((top.count / m.atribCount) * 100)}</b> das análises atribuídas no recorte estão concentradas em <b>{top.label}</b>. <Tag kind="confirmado" /></NoteBox>
          )}
        </Card>
      </Section>

      <Section title="Distribuição geográfica (UF)"><Card><BarList items={uf} /></Card></Section>

      <Section title="Backlog em andamento" note="Status On going, Validar e Prospect no recorte filtrado.">
        <KpiGrid>
          <KpiCard label="Oportunidades em backlog" value={m.backlogCount} sub="On going, Validar, Prospect" />
          <KpiCard label="Valor em disputa (orçamento)" value={fmtBRLCompact(m.financeiro.backlog.sum)} sub={`${m.financeiro.backlog.count} oportunidades no backlog`} />
        </KpiGrid>
      </Section>

      <Section title="Conta Vinculada & Valor Vencedor — cobertura nas oportunidades viáveis" note="Oportunidades com status ≠ No Go / Lost, dentro do recorte filtrado. Campos complementados manualmente via PNCP/ComprasNet.">
        <Card>
          <div className="grid grid-cols-[1.15fr_.85fr] gap-4 max-md:grid-cols-1">
            <div>
              <div className="mb-1.5 text-[12.5px] text-muted">Conta Vinculada</div>
              {V.total > 0 ? (
                <>
                  <StackBar segments={cvSegs} total={V.total} showPct={false} />
                  <div className="mt-4"><DonutCard title="Em pizza" segments={cvSegs} /></div>
                </>
              ) : (
                <div className="text-[13px] text-muted">Nenhuma oportunidade viável (não No Go/Lost) no recorte.</div>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[12.5px] text-muted">Valor Vencedor preenchido</div>
              <KpiCard flat label="Cobertura" value={V.total > 0 ? `${V.vvPreenchido} / ${V.total}` : '—'} sub={V.total > 0 ? `${fmtPct((V.vvPreenchido / V.total) * 100)} das oportunidades viáveis já com valor homologado identificado` : undefined} />
            </div>
          </div>
        </Card>
      </Section>
    </>
  )
}
