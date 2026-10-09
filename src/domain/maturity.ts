import { fmtPct } from '@/lib/format'
import { sumField } from './metrics'
import type { Row } from './types'

export type MaturityItem = { dim: string; detail: string; level: 1 | 2 | 3 | 4 }
export const LEVEL_NAMES = ['', 'Inicial', 'Em Estruturação', 'Gerenciado', 'Otimizado'] as const

const lvl = (p: number, t: [number, number, number]): 1 | 2 | 3 | 4 => (p >= t[2] ? 4 : p >= t[1] ? 3 : p >= t[0] ? 2 : 1)

/** Avaliação sobre a base completa, independente dos filtros ativos. */
export function computeMaturity(rows: readonly Row[]): MaturityItem[] {
  const total = rows.length
  if (!total) return []
  const statusFilled = rows.filter((r) => r.status).length
  const nogo = rows.filter((r) => r.status === 'No Go')
  const nogoComMotivo = nogo.filter((r) => r.motivoNoGo).length
  const lost = rows.filter((r) => r.status === 'Lost')
  const lostComMotivo = lost.filter((r) => r.motivoLost).length
  const orcPct = (sumField(rows, 'orcamento').count / total) * 100
  const ctcPct = (sumField(rows, 'valorCtc').count / total) * 100
  const omissaPct = (rows.filter((r) => r.vistoria === 'Omissa').length / total) * 100
  const atribPct = (rows.filter((r) => r.analista).length / total) * 100
  const nogoPct = nogo.length ? (nogoComMotivo / nogo.length) * 100 : 0
  const lostPct = lost.length ? (lostComMotivo / lost.length) * 100 : 0

  return [
    { dim: 'Cobertura de status / triagem', detail: `Status preenchido em ${fmtPct((statusFilled / total) * 100)} das ${total} linhas`, level: lvl((statusFilled / total) * 100, [50, 80, 95]) },
    { dim: 'Rastreabilidade de motivo', detail: `No Go com motivo em ${fmtPct(nogoPct)}; Lost com motivo em ${fmtPct(lostPct)}`, level: lvl(Math.min(nogoPct, lost.length ? lostPct : 0), [40, 60, 90]) },
    { dim: 'Dados financeiros', detail: `Orçamento em ${fmtPct(orcPct)}; Valor CTC em ${fmtPct(ctcPct)} da base`, level: lvl(ctcPct, [10, 30, 60]) },
    { dim: 'Dados temporais / SLA', detail: 'Sem campo de data de decisão Go/No Go', level: 1 },
    { dim: 'Padronização operacional', detail: `Vistoria "Omissa" em ${fmtPct(omissaPct)} dos casos`, level: lvl(100 - omissaPct, [40, 60, 85]) },
    { dim: 'Atribuição / governança', detail: `${fmtPct(atribPct)} com responsável nomeado`, level: lvl(atribPct, [50, 70, 90]) },
  ]
}
