import { groupCount, type Count } from './filters'
import { NV, type Row } from './types'

export const TECNICO_MOTIVOS = new Set([
  'Habilitação técnica - Atestados',
  'Habilitação técnica - Certificação',
  'Habilitação técnica - Time técnico',
  'Habilitação Técnica',
])

export const STATUS_COLOR: Record<string, string> = {
  'No Go': 'var(--st-critical)',
  Lost: 'var(--series-orange)',
  Canceled: 'var(--muted)',
  Suspended: 'var(--muted)',
  'On going': 'var(--gold)',
  Validar: 'var(--gold)',
  Prospect: 'var(--gold)',
  Go: 'var(--series-blue)',
  Win: 'var(--st-good)',
}
const BACKLOG_STATUS = ['On going', 'Validar', 'Prospect']

export type Share = Count & { pct: number }
export type StatusShare = Share & { color: string }
export type MotivoShare = Share & { drill: string[] }
export type Analista = Count & { pctBase: number; pctAtrib: number | null }
export type Sum = { sum: number; count: number }

export function sumField(rows: readonly Row[], field: 'orcamento' | 'valorCtc' | 'valorVencedor'): Sum {
  let sum = 0
  let count = 0
  for (const r of rows) {
    const v = r[field]
    if (typeof v === 'number' && v > 0) {
      sum += v
      count++
    }
  }
  return { sum, count }
}

const withPct = (list: Count[], total: number): Share[] =>
  list.map((x) => ({ ...x, pct: total ? (x.count / total) * 100 : 0 }))

export function computeMetrics(rows: readonly Row[]) {
  const total = rows.length
  const status: StatusShare[] = withPct(groupCount(rows, 'status'), total).map((s) => ({
    ...s,
    color: STATUS_COLOR[s.label] || 'var(--muted)',
  }))

  const nogoRows = rows.filter((r) => r.status === 'No Go')
  const nogoRaw = groupCount(nogoRows, 'motivoNoGo')
  const TOPN = 9
  const nogoMotivos: MotivoShare[] = nogoRaw
    .slice(0, TOPN)
    .map((m) => ({ ...m, pct: 0, drill: [m.label] }))
  const rest = nogoRaw.slice(TOPN)
  const restCount = rest.reduce((a, m) => a + m.count, 0)
  if (restCount > 0)
    nogoMotivos.push({
      label: `Outros motivos (${nogoRaw.length - TOPN})`,
      count: restCount,
      pct: 0,
      drill: rest.map((m) => m.label),
    })
  for (const m of nogoMotivos) m.pct = nogoRows.length ? (m.count / nogoRows.length) * 100 : 0

  const gargaloTecnicoCount = nogoRows.filter((r) => r.motivoNoGo && TECNICO_MOTIVOS.has(r.motivoNoGo)).length
  const gargaloFinanceiroCount = nogoRows.filter((r) => r.motivoNoGo === 'Indices financeiros').length
  const gargaloServicoCount = nogoRows.filter((r) => r.motivoNoGo === 'Linha de serviço não operante').length

  const vistoria = withPct(groupCount(rows, 'vistoria'), total)
  const torre = withPct(groupCount(rows, 'torre'), total)
  const linhaServico = withPct(groupCount(rows, 'linhaServico'), total)

  const atribCount = rows.filter((r) => r.analista).length
  const analistas: Analista[] = groupCount(rows, 'analista').map((a) => ({
    ...a,
    pctBase: total ? (a.count / total) * 100 : 0,
    pctAtrib: a.label !== NV && atribCount ? (a.count / atribCount) * 100 : null,
  }))

  const ufRaw = groupCount(rows.filter((r) => r.uf), 'uf')
  const uf: Count[] = ufRaw.slice(0, 9)
  const ufRest = ufRaw.slice(9).reduce((a, m) => a + m.count, 0)
  if (ufRest > 0) uf.push({ label: `Demais UFs (${ufRaw.length - 9})`, count: ufRest })

  const orcamento = sumField(rows, 'orcamento')
  const valorCtc = sumField(rows, 'valorCtc')
  const valorVencedor = sumField(rows, 'valorVencedor')
  const backlogRows = rows.filter((r) => r.status && BACKLOG_STATUS.includes(r.status))
  const backlogOrc = sumField(backlogRows, 'orcamento')

  const lostRows = rows.filter((r) => r.status === 'Lost')
  const lostComMotivo = lostRows.filter((r) => r.motivoLost).length

  const viaveis = rows.filter((r) => r.status !== 'No Go' && r.status !== 'Lost')
  const cvSim = viaveis.filter((r) => r.contaVinculada === 'Sim').length
  const cvNao = viaveis.filter((r) => r.contaVinculada === 'Não').length
  const cvSem = viaveis.length - cvSim - cvNao
  const vvPreenchido = viaveis.filter((r) => typeof r.valorVencedor === 'number' && r.valorVencedor > 0).length

  const winCount = status.find((s) => s.label === 'Win')?.count || 0
  const lostCount = status.find((s) => s.label === 'Lost')?.count || 0
  const winRate = winCount + lostCount > 0 ? (winCount / (winCount + lostCount)) * 100 : null

  return {
    total,
    status,
    nogoRows,
    nogoMotivos,
    gargaloTecnicoCount,
    gargaloFinanceiroCount,
    gargaloServicoCount,
    vistoria,
    torre,
    linhaServico,
    analistas,
    atribCount,
    uf,
    financeiro: {
      orcamento,
      valorCtc,
      valorVencedor,
      backlog: { sum: backlogOrc.sum, comOrcamento: backlogOrc.count, count: backlogRows.length },
    },
    lost: { count: lostRows.length, comMotivo: lostComMotivo },
    viaveis: { total: viaveis.length, cvSim, cvNao, cvSem, vvPreenchido },
    winRate,
    winCount,
    backlogCount: backlogRows.length,
  }
}
export type Metrics = ReturnType<typeof computeMetrics>

/** Contagem por status (0 se ausente) – evita repetir find() nas telas. */
export const statusOf = (m: Metrics, label: string): StatusShare =>
  m.status.find((s) => s.label === label) || { label, count: 0, pct: 0, color: STATUS_COLOR[label] || 'var(--muted)' }
