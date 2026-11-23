import type { Oportunidade } from '@/domain/oportunidade'

/**
 * Esfera do órgão (federal, estadual, municipal). O cadastro não tem esse campo: ela é DEDUZIDA do nome do órgão e da sigla.
 * Quando o nome não permite concluir (empresas privadas, siglas soltas), a esfera é "Não identificada" em vez de chutar.
 */
export const ESFERAS = ['Federal', 'Estadual', 'Municipal'] as const
export type Esfera = (typeof ESFERAS)[number]
export const NAO_IDENTIFICADA = 'Não identificada'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const MUNICIPAL = /\b(prefeitura|municipio|municipal|camara de vereadores|vereadores|samae|saae|semae|fundo municipal)\b/
// "distrito federal" conta como estadual (o DF acumula as competências estaduais), por isso é tratado antes de "federal".
const ESTADUAL =
  /\b(estado d[eoa]s?|estadual|governo d[eoa] estado|assembleia legislativa|distrito federal|secretaria de estado|tribunal de justica|policia (militar|civil)|corpo de bombeiros|detran|sefaz|defensoria publica d[eo] estado|ministerio publico d[eo] (estado|[a-z]{2}\b)|tribunal de contas d[eo] estado)\b/
const FEDERAL =
  /\b(federal|uniao|ministerio d[aeo]s?|exercito|marinha|aeronautica|senado|camara dos deputados|presidencia da republica|tribunal superior|tribunal regional (do trabalho|eleitoral)|inss|ibama|anvisa|anatel|dnit|fnde|caixa economica|banco do brasil|bndes|correios|serpro|dataprev|embrapa|fiocruz|ebserh|hospital universitario)\b/

export function esferaDoOrgao(orgao: string | null | undefined, sigla?: string | null): Esfera | null {
  const s = fold(`${orgao ?? ''} ${sigla ?? ''}`)
  if (!s.trim()) return null
  if (MUNICIPAL.test(s)) return 'Municipal'
  if (ESTADUAL.test(s)) return 'Estadual'
  if (FEDERAL.test(s)) return 'Federal'
  return null
}

/** "" = todas; senão uma das esferas ou "Não identificada". */
export const naEsfera = (o: Pick<Oportunidade, 'orgao' | 'sigla'>, filtro: string): boolean => {
  if (!filtro) return true
  const e = esferaDoOrgao(o.orgao, o.sigla)
  return filtro === NAO_IDENTIFICADA ? e === null : e === filtro
}

/** Texto digitado em reais ("1.500.000", "1500000,50", "R$ 2,5") -> número; vazio ou ilegível -> null. */
export function lerValor(texto: string): number | null {
  const t = texto.replace(/R\$|\s/g, '')
  if (!t || !/^[\d.,]+$/.test(t)) return null
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Faixa de valor sobre o orçamento (valor estimado). Sem faixa, tudo passa. Com faixa, só entra quem tem valor:
 * orçamento sigiloso ou em branco não tem como cair numa faixa.
 */
export function naFaixaDeValor(o: Pick<Oportunidade, 'orcamento' | 'orcamento_sigiloso'>, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  if (o.orcamento_sigiloso || o.orcamento === null || o.orcamento === undefined) return false
  return (min === null || o.orcamento >= min) && (max === null || o.orcamento <= max)
}

/** Faixa em que o mínimo passa do máximo: nenhuma oportunidade cabe (a tela avisa, como no intervalo de datas). */
export const faixaInvertida = (min: number | null, max: number | null) => min !== null && max !== null && min > max
