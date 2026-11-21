import { describe, expect, it } from 'vitest'
import { parseArrayTexto, serializarArrayTexto, serializarJson } from './banco'

describe('serializarJson (parâmetros ::jsonb)', () => {
  it('texto já serializado passa direto, sem JSON duplo', () => {
    expect(serializarJson('{"a":1}')).toBe('{"a":1}')
    expect(serializarJson(JSON.stringify([]))).toBe('[]')
  })
  it('objeto e array são serializados', () => {
    expect(serializarJson({ a: 1 })).toBe('{"a":1}')
    expect(serializarJson(['Go'])).toBe('["Go"]')
  })
})

describe('arrays text[] (colunas como status_gatilho e pendencias)', () => {
  it.each([
    ['{}', []],
    ['{Go}', ['Go']],
    ['{Canceled,Go,Lost,"No Go","On going",Prospect,Suspended,Win}', ['Canceled', 'Go', 'Lost', 'No Go', 'On going', 'Prospect', 'Suspended', 'Win']],
    ['{"a,b","c d"}', ['a,b', 'c d']],
    ['{"com \\"aspas\\"","barra \\\\"}', ['com "aspas"', 'barra \\']],
    ['{a,NULL,"NULL"}', ['a', null, 'NULL']],
  ])('converte %s', (entrada, esperado) => {
    expect(parseArrayTexto(entrada)).toEqual(esperado)
  })
  it('ida e volta: o que sai serializado volta igual', () => {
    const lista = ['Go', 'No Go', 'com "aspas"', 'a,b', 'barra \\', 'ç ã']
    expect(parseArrayTexto(serializarArrayTexto(lista))).toEqual(lista)
    expect(parseArrayTexto(serializarArrayTexto([]))).toEqual([])
  })
})
