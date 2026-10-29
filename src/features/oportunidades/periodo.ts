/** Filtro de período (Ano > Quarter > Mês e/ou intervalo de datas) pela data do pregão. */
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'] as const
export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const

/** `de` e `ate` (aaaa-mm-dd, inclusivos) são opcionais; combinam com Ano/Quarter/Mês (todos precisam valer). */
export type Periodo = { ano: string; quarter: string; mes: string; de?: string; ate?: string }

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
const doisDigitos = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`

/** Segunda a domingo da semana de `base`, deslocada `semanas` semanas (0 = esta, 1 = próxima). */
export function semanaDe(base: Date, semanas = 0) {
  const dia = (base.getDay() + 6) % 7 // segunda = 0
  const segunda = new Date(base.getFullYear(), base.getMonth(), base.getDate() - dia + semanas * 7)
  const domingo = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6)
  return { de: iso(segunda), ate: iso(domingo) }
}

/** Primeiro ao último dia do mês de `base`. */
export function mesDe(base: Date) {
  return { de: iso(new Date(base.getFullYear(), base.getMonth(), 1)), ate: iso(new Date(base.getFullYear(), base.getMonth() + 1, 0)) }
}

/** true se o intervalo é válido para uso (datas completas e `de` não depois de `ate`). */
export const intervaloInvertido = (p: Pick<Periodo, 'de' | 'ate'>) => !!p.de && !!p.ate && DATA_ISO.test(p.de) && DATA_ISO.test(p.ate) && p.de > p.ate

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
  const de = p.de && DATA_ISO.test(p.de) ? p.de : ''
  const ate = p.ate && DATA_ISO.test(p.ate) ? p.ate : ''
  if (!p.ano && !p.quarter && !p.mes && !de && !ate) return true
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data ?? '')
  if (!m) return false
  const mes = Number(m[2])
  const dia = `${m[1]}-${m[2]}-${m[3]}`
  return (
    (!p.ano || m[1] === p.ano) &&
    (!p.quarter || quarterDoMes(mes) === p.quarter) &&
    (!p.mes || mes === Number(p.mes)) &&
    (!de || dia >= de) &&
    (!ate || dia <= ate)
  )
}
