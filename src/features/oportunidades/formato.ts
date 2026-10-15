import { oportunidadeInput, type Oportunidade, type OportunidadeInput } from '@/domain/oportunidade'
import { TODOS_CAMPOS, type Nome } from './campos'

/** Estado do formulário: tudo texto (inputs HTML), exceto o checkbox. */
export type FormValores = Record<Exclude<Nome, 'orcamento_sigiloso' | 'pendencias'>, string> & { orcamento_sigiloso: boolean }

const fmtNum = (n: number) => String(n).replace('.', ',')

export function paraForm(o?: Partial<Oportunidade> | null): FormValores {
  const v = {} as Record<string, string | boolean>
  for (const c of TODOS_CAMPOS) {
    if (c.nome === 'orcamento_sigiloso') continue
    const bruto = o?.[c.nome as keyof Oportunidade] as unknown
    if (bruto === null || bruto === undefined) v[c.nome] = ''
    else if (c.tipo === 'percentual') v[c.nome] = fmtNum(Math.round(Number(bruto) * 10000) / 100)
    else if (c.tipo === 'dinheiro' || c.tipo === 'inteiro') v[c.nome] = fmtNum(Number(bruto))
    else v[c.nome] = String(bruto)
  }
  v.orcamento_sigiloso = Boolean(o?.orcamento_sigiloso)
  return v as FormValores
}

/** Converte o texto do formulário no contrato da API (vírgula decimal, % -> fração, vazio -> null). */
export function deForm(v: FormValores, pendenciasAtuais: string[] = []) {
  const bruto: Record<string, unknown> = { ...v }
  for (const c of TODOS_CAMPOS) {
    if (c.tipo === 'percentual' && v[c.nome as keyof FormValores] !== '') {
      const n = Number(String(v[c.nome as keyof FormValores]).replace(',', '.'))
      bruto[c.nome] = Number.isFinite(n) ? n / 100 : v[c.nome as keyof FormValores]
    }
  }
  // Pendência resolvida some sozinha: o campo marcado ganhou valor.
  bruto.pendencias = pendenciasAtuais.filter((campo) => {
    const x = bruto[campo]
    return x === undefined || x === null || String(x).trim() === ''
  })
  // O campo Valor CTC etc. aceita "1.234,50": remove separador de milhar antes de converter.
  for (const c of TODOS_CAMPOS) {
    if (c.tipo === 'dinheiro' && typeof bruto[c.nome] === 'string') bruto[c.nome] = String(bruto[c.nome]).replace(/\.(?=\d{3}(\D|$))/g, '')
  }
  return oportunidadeInput.safeParse(bruto)
}

export type Resultado = ReturnType<typeof deForm>

export const brl = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export const dataBr = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export const dataHoraBr = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—'

export type { OportunidadeInput }
