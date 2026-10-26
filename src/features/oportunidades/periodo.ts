/** Filtro de período (Ano > Quarter > Mês) pela data do pregão. */
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'] as const
export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const

export type Periodo = { ano: string; quarter: string; mes: string }

/** Quarter de um mês (1-12): 1-3 -> Q1, 4-6 -> Q2, 7-9 -> Q3, 10-12 -> Q4. */
export const quarterDoMes = (mes: number) => `Q${Math.ceil(mes / 3)}`

/** Meses (1-12) de um quarter; sem quarter, todos. */
export const mesesDoQuarter = (quarter: string) => {
  const q = QUARTERS.indexOf(quarter as (typeof QUARTERS)[number])
  return q < 0 ? MESES.map((_, i) => i + 1) : [1, 2, 3].map((i) => q * 3 + i)
}

/** Anos presentes nos dados (mais recente primeiro). */
export const anosDisponiveis = (datas: (string | null | undefined)[]) =>
  [...new Set(datas.map((d) => d?.slice(0, 4)).filter((a): a is string => !!a && /^\d{4}$/.test(a)))].sort().reverse()

/** true se a data (aaaa-mm-dd) cabe no período; sem nenhum filtro, tudo passa (inclusive sem data). */
export function noPeriodo(data: string | null | undefined, p: Periodo) {
  if (!p.ano && !p.quarter && !p.mes) return true
  const m = /^(\d{4})-(\d{2})/.exec(data ?? '')
  if (!m) return false
  const mes = Number(m[2])
  return (!p.ano || m[1] === p.ano) && (!p.quarter || quarterDoMes(mes) === p.quarter) && (!p.mes || mes === Number(p.mes))
}
