import { useCallback, useMemo } from 'react'
import { BarList, type BarItem } from '@/components/BarList'
import { DonutCard } from '@/components/Charts'
import { Card, EmptyNote, KpiGrid, NoteBox, Section, Tag } from '@/components/Primitives'
import { KpiCard } from '@/components/KpiCard'
import { NV } from '@/domain/types'
import { fmtPct } from '@/lib/format'
import { EmptySections, useShowDrill, type TabProps } from '../shared'

const NOGO_COLORS = ['var(--series-red)', 'var(--muted)', 'var(--series-orange)', 'var(--series-gold)', 'var(--series-gold)', 'var(--series-orange)', 'var(--muted)', 'var(--muted)', 'var(--series-blue)', 'var(--muted)']
const VIST_COLORS: Record<string, string> = { Omissa: 'var(--series-red)', Opcional: 'var(--gold)', Não: 'var(--muted)', Sim: 'var(--series-blue)' }
const TORRE_COLORS: Record<string, string> = { DIGITAL: 'var(--series-blue)', ITS: 'var(--series-gold)', HEALTH: 'var(--series-violet)' }
const LINHA_COLORS = ['var(--series-blue)', 'var(--series-gold)', 'var(--series-violet)', 'var(--series-orange)', 'var(--muted)', 'var(--series-red)']

export function InterTab({ m, rows, noYear }: TabProps) {
  const show = useShowDrill()

  const nogoItems = useMemo<BarItem[]>(
    () => m.nogoMotivos.map((x, i) => ({ label: x.label, count: x.count, pct: x.pct, color: NOGO_COLORS[i] || 'var(--muted)', extra: fmtPct(x.pct), drill: x.drill })),
    [m.nogoMotivos],
  )
  const onNogoDrill = useCallback(
    (it: BarItem) => show(it.label, rows.filter((r) => r.status === 'No Go' && it.drill!.includes(r.motivoNoGo || NV))),
    [rows, show],
  )
  const vistoria = useMemo(() => m.vistoria.map((v) => ({ label: v.label, count: v.count, pct: v.pct, color: VIST_COLORS[v.label] || 'var(--muted)' })), [m.vistoria])
  const linha = useMemo(() => m.linhaServico.map((l, i) => ({ label: l.label, count: l.count, pct: l.pct, color: LINHA_COLORS[i] || 'var(--muted)' })), [m.linhaServico])
  const linhaDonut = useMemo(() => {
    const top = linha.slice(0, 5).map(({ label, count, color }) => ({ label, count, color }))
    const rest = linha.slice(5).reduce((a, l) => a + l.count, 0)
    if (rest > 0) top.push({ label: `Outros (${linha.length - 5})`, count: rest, color: 'var(--muted)' })
    return top
  }, [linha])
  const torre = useMemo(() => m.torre.map((t) => ({ label: t.label, count: t.count, pct: t.pct, color: TORRE_COLORS[t.label] || 'var(--muted)' })), [m.torre])

  if (m.total === 0) return <EmptySections noYear={noYear} titles={['Motivos de No Go', 'Gargalos', 'Vistoria técnica & complexidade operacional', 'Linha de serviço', 'Torre']} />

  const nogoN = m.nogoRows.length
  const gt = nogoN ? (m.gargaloTecnicoCount / nogoN) * 100 : 0
  const gf = nogoN ? (m.gargaloFinanceiroCount / nogoN) * 100 : 0
  const gs = nogoN ? (m.gargaloServicoCount / nogoN) * 100 : 0
  const omissa = m.vistoria.find((v) => v.label === 'Omissa')

  return (
    <>
      <Section title="Motivos de No Go" note="Sobre as oportunidades com status No Go no recorte filtrado. Clique em um motivo para ver as oportunidades.">
        <Card>{nogoN ? <BarList items={nogoItems} onDrill={onNogoDrill} /> : <EmptyNote>Nenhum No Go no recorte selecionado.</EmptyNote>}</Card>
      </Section>

      <section className="mb-8.5">
        <div className="grid grid-cols-[1.15fr_.85fr] gap-4 max-md:grid-cols-1">
          <Card>
            <h3 className="mb-2.5 text-[15px]">Gargalo técnico (Pré-Vendas × Produtos/Técnico)</h3>
            <KpiGrid className="grid-cols-2">
              <KpiCard flat label="Casos" value={m.gargaloTecnicoCount} />
              <KpiCard flat label="% dos No Go" value={fmtPct(gt)} />
            </KpiGrid>
            {nogoN > 0 && <NoteBox>Falta de acervo técnico (atestados + certificação + time técnico) responde por {fmtPct(gt)} dos No Go no recorte.</NoteBox>}
          </Card>
          <Card>
            <h3 className="mb-2.5 text-[15px]">Gargalo financeiro (Pré-Vendas × Financeiro)</h3>
            <KpiGrid className="grid-cols-1">
              <KpiCard flat label="Índices financeiros excludentes" value={<>{m.gargaloFinanceiroCount} <span className="text-sm text-muted">({fmtPct(gf)} dos No Go)</span></>} />
            </KpiGrid>
            {nogoN > 0 && (
              <NoteBox>
                Falta de linha de serviço operante soma <b>{m.gargaloServicoCount}</b> casos ({fmtPct(gs)} dos No Go) — mesma ordem de grandeza do gargalo financeiro. <Tag kind="confirmado" />
              </NoteBox>
            )}
          </Card>
        </div>
      </section>

      <Section title="Vistoria técnica & complexidade operacional">
        <Card>
          <BarList items={vistoria} />
          {omissa && (
            <NoteBox>
              <b>"Omissa" é {omissa.count === Math.max(...m.vistoria.map((v) => v.count)) ? 'a categoria mais frequente' : 'relevante'} ({fmtPct(omissa.pct)})</b> — sinal de leitura não padronizada dessa etapa da triagem. <Tag kind="inferido" />
            </NoteBox>
          )}
        </Card>
      </Section>

      <Section title="Linha de serviço">
        <Card><BarList items={linha} /></Card>
        <Card className="mt-4"><DonutCard title="Distribuição em pizza — Linha de Serviço (top 5 + Outros)" segments={linhaDonut} /></Card>
      </Section>

      <Section title="Torre">
        <Card><BarList items={torre} /></Card>
        <Card className="mt-4"><DonutCard title="Distribuição em pizza — Torre" segments={torre.map(({ label, count, color }) => ({ label, count, color }))} /></Card>
      </Section>
    </>
  )
}
