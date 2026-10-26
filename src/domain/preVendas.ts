/** Pré-vendas de uma oportunidade: vários nomes no mesmo campo, separados por vírgula (ex.: "Ana, Marcia"). */
export const nomesPreVendas = (v: string | null | undefined): string[] =>
  [...new Set(String(v ?? '').split(/\s*[,;]\s*/).map((n) => n.trim()).filter(Boolean))]

export const juntaPreVendas = (nomes: readonly string[]) => nomes.join(', ')
