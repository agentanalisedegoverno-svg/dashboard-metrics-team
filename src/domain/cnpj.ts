/** CNPJ: só dígitos, validação dos dígitos verificadores e máscara. Compartilhado entre a tela e a API. */
export const soDigitos = (s: string) => s.replace(/\D/g, '')

export function validaCnpj(valor: string): boolean {
  const c = soDigitos(valor)
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const dv = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((a, d, i) => a + Number(d) * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = dv(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = dv(c.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return c.endsWith(`${d1}${d2}`)
}

/** 00.000.000/0001-91 (aceita número parcial enquanto a pessoa digita). */
export function formataCnpj(valor: string): string {
  const c = soDigitos(valor).slice(0, 14)
  return c
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}
