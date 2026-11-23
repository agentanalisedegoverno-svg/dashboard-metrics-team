import { describe, expect, it } from 'vitest'
import { esferaDoOrgao, faixaInvertida, lerValor, NAO_IDENTIFICADA, naEsfera, naFaixaDeValor } from './filtrosOrgaoValor'

describe('esferaDoOrgao', () => {
  it.each([
    ['Prefeitura Municipal de Campinas', 'Municipal'],
    ['MUNICÍPIO DE SÃO PAULO', 'Municipal'],
    ['Câmara Municipal de Goiânia', 'Municipal'],
    ['Secretaria Municipal de Saúde', 'Municipal'],
    ['Governo do Estado de Minas Gerais', 'Estadual'],
    ['Secretaria de Estado da Fazenda', 'Estadual'],
    ['Tribunal de Justiça de São Paulo', 'Estadual'],
    ['Polícia Militar do Ceará', 'Estadual'],
    ['Governo do Distrito Federal', 'Estadual'],
    ['Assembleia Legislativa do Paraná', 'Estadual'],
    ['Ministério da Saúde', 'Federal'],
    ['Universidade Federal de Goiás', 'Federal'],
    ['Tribunal Regional do Trabalho da 10ª Região', 'Federal'],
    ['Caixa Econômica Federal', 'Federal'],
    ['Exército Brasileiro', 'Federal'],
  ])('%s -> %s', (orgao, esperado) => {
    expect(esferaDoOrgao(orgao)).toBe(esperado)
  })

  it('município prevalece sobre estado/federal quando o nome mistura (Câmara Municipal do Estado)', () => {
    expect(esferaDoOrgao('Prefeitura Municipal de Santa Rita do Estado')).toBe('Municipal')
  })

  it('usa a sigla como pista e não inventa quando não dá para concluir', () => {
    expect(esferaDoOrgao('Secretaria', 'SEFAZ-GO')).toBe('Estadual')
    expect(esferaDoOrgao('Empresa Privada Ltda')).toBeNull()
    expect(esferaDoOrgao('', null)).toBeNull()
    expect(esferaDoOrgao(null)).toBeNull()
  })

  it('naEsfera: vazio passa tudo; "Não identificada" pega só os sem conclusão', () => {
    const pref = { orgao: 'Prefeitura de X', sigla: null }
    const priv = { orgao: 'Acme', sigla: null }
    expect(naEsfera(pref, '')).toBe(true)
    expect(naEsfera(pref, 'Municipal')).toBe(true)
    expect(naEsfera(pref, 'Estadual')).toBe(false)
    expect(naEsfera(priv, NAO_IDENTIFICADA)).toBe(true)
    expect(naEsfera(pref, NAO_IDENTIFICADA)).toBe(false)
  })
})

describe('lerValor', () => {
  it.each([
    ['1.500.000', 1_500_000],
    ['1500000', 1_500_000],
    ['1.500.000,50', 1_500_000.5],
    ['R$ 2,5', 2.5],
    ['250000', 250_000],
    ['0', 0],
  ])('%s -> %s', (t, n) => expect(lerValor(t)).toBe(n))
  it.each(['', '   ', 'abc', '-5', '1,2,3x'])('"%s" -> null', (t) => expect(lerValor(t)).toBeNull())
})

describe('naFaixaDeValor', () => {
  const o = (orcamento: number | null, sig = false) => ({ orcamento, orcamento_sigiloso: sig })
  it('sem faixa tudo passa, inclusive sem valor e sigiloso', () => {
    expect(naFaixaDeValor(o(null), null, null)).toBe(true)
    expect(naFaixaDeValor(o(null, true), null, null)).toBe(true)
  })
  it('com faixa: limites inclusivos; sem valor ou sigiloso ficam de fora', () => {
    expect(naFaixaDeValor(o(100), 100, 200)).toBe(true)
    expect(naFaixaDeValor(o(200), 100, 200)).toBe(true)
    expect(naFaixaDeValor(o(99), 100, null)).toBe(false)
    expect(naFaixaDeValor(o(201), null, 200)).toBe(false)
    expect(naFaixaDeValor(o(null), 0, null)).toBe(false)
    expect(naFaixaDeValor(o(150, true), 100, 200)).toBe(false)
  })
  it('faixaInvertida', () => {
    expect(faixaInvertida(200, 100)).toBe(true)
    expect(faixaInvertida(100, 100)).toBe(false)
    expect(faixaInvertida(null, 100)).toBe(false)
  })
})
