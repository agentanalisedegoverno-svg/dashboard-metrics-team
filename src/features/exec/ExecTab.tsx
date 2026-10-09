import { useMemo } from 'react'
import { Card, DonutTitle, KpiGrid, NoteBox, Section, Tag } from '@/components/Primitives'
import { Donut, StackBar } from '@/components/Charts'
import { KpiCard } from '@/components/KpiCard'
import { statusOf } from '@/domain/metrics'
import { fmtBRLCompact, fmtInt, fmtPct } from '@/lib/format'
import { EmptySections, useShowDrill, type TabProps } from '../shared'

export function ExecTab({ m, rows, noYear }: TabProps) {
  const show = useShowDrill()
  const drillStatus = (title: string, statuses: string[]) => () => show(title, rows.filter((r) => r.status && statuses.includes(r.status)))
  const segments = useMemo(() => m.status.map((s) => ({ label: s.label, count: s.count, color: s.color })), [m.status])

  if (m.total === 0) return <EmptySections noYear={noYear} titles={['Funil de triagem', 'Pipeline financeiro', 'Competitividade & conversão']} />

  const win = statusOf(m, 'Win')
  const go = statusOf(m, 'Go')
  const ongoing = statusOf(m, 'On going')
  const lost = statusOf(m, 'Lost')
  const nogo = statusOf(m, 'No Go')
  const worked = win.count + go.count + ongoing.count + lost.count
  const F = m.financeiro

  return (
    <>
      <Section title="Funil de triagem" note="Distribuição de status sobre o total filtrado de oportunidades.">
        <KpiGrid>
          <KpiCard label="Win" value={win.count} sub={`${fmtPct(win.pct)} do recorte`} tag="confirmado" onClick={drillStatus('Win', ['Win'])} />
          <KpiCard label="Go" value={go.count} sub={`${fmtPct(go.pct)} do recorte · sendo trabalhada agora`} tag="confirmado" onClick={drillStatus('Go', ['Go'])} />
          <KpiCard label="On going" value={ongoing.count} sub={`${fmtPct(ongoing.pct)} do recorte`} tag="confirmado" onClick={drillStatus('On going', ['On going'])} />
          <KpiCard label="Lost" value={lost.count} sub={`${fmtPct(lost.pct)} do recorte`} tag="confirmado" onClick={drillStatus('Lost', ['Lost'])} />
          <KpiCard
            label="Oportunidades trabalhadas"
            value={worked}
            sub={`${fmtPct(m.total ? (worked / m.total) * 100 : 0)} do recorte`}
            tag="confirmado"
            info="Soma de Win + Go + On going + Lost — tudo que a equipe efetivamente disputou (venceu, está disputando ou perdeu) no recorte selecionado."
            onClick={drillStatus('Oportunidades trabalhadas', ['Win', 'Go', 'On going', 'Lost'])}
          />
        </KpiGrid>
        <Card className="mt-4">
          <StackBar segments={segments} total={m.total} />
          <NoteBox>
            <b>No Go Rate de {fmtPct(nogo.pct)}</b> no recorte atual — maior indicador de eficiência do funil de triagem a acompanhar. <Tag kind="confirmado" className="ml-1" />
          </NoteBox>
        </Card>
        <Card className="mt-4">
          <DonutTitle>Distribuição em pizza — status (visão rápida do total filtrado)</DonutTitle>
          <Donut segments={segments} />
        </Card>
      </Section>

      <Section title="Pipeline financeiro" note="Valores em R$, somados sobre os campos preenchidos da planilha, no recorte filtrado.">
        <KpiGrid>
          <KpiCard
            label="Pipeline analisado"
            value={fmtBRLCompact(F.orcamento.sum)}
            sub={`${F.orcamento.count} editais com orçamento informado (${fmtPct(m.total ? (F.orcamento.count / m.total) * 100 : 0)})`}
            tag="confirmado"
            info="Soma do campo Orçamento (valor estimado do edital) de todas as oportunidades do recorte que têm esse dado preenchido. É o tamanho do mercado que a equipe analisou."
          />
          <KpiCard
            label="Pipeline precificado (Valor CTC)"
            value={fmtBRLCompact(F.valorCtc.sum)}
            sub={`${F.valorCtc.count} oportunidades (${fmtPct(m.total ? (F.valorCtc.count / m.total) * 100 : 0)})`}
            tag="confirmado"
            info="Soma do campo Valor CTC — o valor que a CTC efetivamente ofertou/precificou nas oportunidades do recorte. Mostra quanto do pipeline analisado já virou proposta de preço."
          />
          <KpiCard
            label="Valor Vencedor mapeado"
            value={fmtBRLCompact(F.valorVencedor.sum)}
            sub={`${F.valorVencedor.count} disputas com valor homologado`}
            tag="confirmado"
            info="Soma do campo Valor Vencedor — o valor da empresa que venceu cada disputa já encerrada (CTC ou concorrente). Serve de referência do preço que o mercado realmente paga."
          />
          <KpiCard
            label="Backlog (R$)"
            value={fmtBRLCompact(F.backlog.sum)}
            sub={`${F.backlog.comOrcamento} de ${F.backlog.count} oportunidades em andamento com orçamento informado`}
            tag="confirmado"
            info="Soma do Orçamento das oportunidades ainda em andamento (On going, Validar ou Prospect) — o valor que ainda está em jogo, sem desfecho."
          />
        </KpiGrid>
        <NoteBox>
          <b>Funil de precificação:</b> de {fmtBRLCompact(F.orcamento.sum)} em editais analisados no recorte, {fmtPct(F.orcamento.sum ? (F.valorCtc.sum / F.orcamento.sum) * 100 : 0)} chegam a ter Valor CTC lançado. <Tag kind="confirmado" />
        </NoteBox>
      </Section>

      <Section title="Competitividade & conversão">
        <KpiGrid>
          <KpiCard
            label="Win Rate sobre disputas encerradas"
            value={m.winRate != null ? fmtPct(m.winRate) : '—'}
            sub={`${m.winCount} Win sobre ${fmtInt(m.winCount + m.lost.count)} disputas com desfecho (Win+Lost)`}
            tag="inferido"
            info="Percentual de vitórias (Win) sobre o total de disputas já encerradas com desfecho conhecido (Win + Lost). Não conta No Go, Canceled, Suspended nem o que ainda está em andamento."
          />
          <KpiCard
            label="Backlog ativo"
            value={m.backlogCount}
            sub="On going + Validar + Prospect"
            tag="confirmado"
            info='Quantidade de oportunidades ainda em aberto (On going, Validar ou Prospect) no recorte — contagem de oportunidades, não valor em R$ (esse é o card "Backlog (R$)" acima).'
          />
          <KpiCard
            label="Loss por preço"
            value={<>{m.lost.comMotivo} <span className="text-[15px] text-muted">/ {m.lost.count}</span></>}
            sub={`${m.lost.count ? fmtPct((m.lost.comMotivo / m.lost.count) * 100) : '—'} dos Lost com motivo informado`}
            tag="lacuna"
            info="Quantas das oportunidades perdidas (Lost) têm o Motivo do Lost preenchido, sobre o total de Lost no recorte — mostra o quanto dá pra rastrear por que a equipe perdeu."
          />
        </KpiGrid>
      </Section>
    </>
  )
}
