import { describe, expect, it } from 'vitest'
import { serializarJson } from './banco'

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
