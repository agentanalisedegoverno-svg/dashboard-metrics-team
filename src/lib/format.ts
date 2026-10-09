const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** 'YYYY-MM' -> 'mmm/aa'; vazio -> 'Sem data' */
export const monthLabel = (ym?: string | null): string => {
  if (!ym) return 'Sem data'
  const [y, m] = ym.split('-')
  return `${MONTH_ABBR[parseInt(m, 10) - 1]}/${y.slice(2)}`
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const num1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const num2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('pt-BR')

export const fmtInt = (v: number) => int.format(v)
export const fmtBRL = (v: number) => brl.format(v)
export const fmtBRLCompact = (v: number): string => {
  if (!v) return 'R$ 0'
  if (v >= 1e9) return `R$ ${num2.format(v / 1e9)} bi`
  if (v >= 1e6) return `R$ ${num1.format(v / 1e6)} mi`
  return fmtBRL(v)
}
export const fmtPct = (v: number): string => `${num1.format(Number.isFinite(v) ? v : 0)}%`
export const fmtDec1 = (v: number) => num1.format(v)
