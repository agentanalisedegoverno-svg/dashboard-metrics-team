import { describe, expect, it } from 'vitest'
import { juntaPreVendas, nomesPreVendas } from './preVendas'

describe('pré-vendas (vários por oportunidade)', () => {
  it('separa por vírgula ou ponto e vírgula, sem repetir nem deixar vazios', () => {
    expect(nomesPreVendas('Ana, Marcia;  Ana ,')).toEqual(['Ana', 'Marcia'])
    expect(nomesPreVendas(null)).toEqual([])
    expect(nomesPreVendas('Flávio Santanna')).toEqual(['Flávio Santanna'])
  })
  it('junta com vírgula e volta ao mesmo conjunto', () => {
    expect(juntaPreVendas(['Ana', 'Marcia'])).toBe('Ana, Marcia')
    expect(nomesPreVendas(juntaPreVendas(['Ana', 'Marcia']))).toEqual(['Ana', 'Marcia'])
  })
})
