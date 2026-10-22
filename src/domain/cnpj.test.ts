import { describe, expect, it } from 'vitest'
import { oportunidadeInput, regrasNegocio, torreDaLinha } from './oportunidade'
import { formataCnpj, soDigitos, validaCnpj } from './cnpj'

describe('cnpj', () => {
  it('valida os dígitos verificadores', () => {
    expect(validaCnpj('00.000.000/0001-91')).toBe(true)
    expect(validaCnpj('33000167000101')).toBe(true) // Petrobras
    expect(validaCnpj('00.000.000/0001-92')).toBe(false)
    expect(validaCnpj('11111111111111')).toBe(false)
    expect(validaCnpj('123')).toBe(false)
  })
  it('máscara enquanto digita e só dígitos', () => {
    expect(formataCnpj('00000000000191')).toBe('00.000.000/0001-91')
    expect(formataCnpj('0000')).toBe('00.00')
    expect(formataCnpj('abc00000000000191xyz')).toBe('00.000.000/0001-91')
    expect(soDigitos('00.000.000/0001-91')).toBe('00000000000191')
  })
})

describe('schema: descritivo, CNPJ e torre', () => {
  it('descritivo aceita texto longo (sem limite de 300)', () => {
    const r = oportunidadeInput.safeParse({ descritivo: 'x'.repeat(20_000) })
    expect(r.success && r.data.descritivo?.length).toBe(20_000)
    expect(regrasNegocio(oportunidadeInput.parse({ status: 'Go', orgao: 'X', descritivo: 'x'.repeat(5000), torre: 'ITS', data_pregao_dt: '2026-01-01' }))).toEqual([])
  })
  it('CNPJ com máscara vira 14 dígitos; inválido é recusado; vazio vira null', () => {
    expect(oportunidadeInput.parse({ empresa_vencedora_cnpj: '00.000.000/0001-91' }).empresa_vencedora_cnpj).toBe('00000000000191')
    expect(oportunidadeInput.parse({ empresa_vencedora_cnpj: '' }).empresa_vencedora_cnpj).toBeNull()
    const r = oportunidadeInput.safeParse({ empresa_vencedora_cnpj: '00.000.000/0001-92' })
    expect(!r.success && r.error.issues[0].path[0]).toBe('empresa_vencedora_cnpj')
    expect(oportunidadeInput.parse({ empresa_vencedora_tipo: '' }).empresa_vencedora_tipo).toBeNull()
  })
  it('torre pela linha: mapeadas vão para DIGITAL/HEALTH; qualquer outra é ITS; sem linha não calcula', () => {
    const mapa = { 'Software Development': 'DIGITAL', 'Key Talent': 'DIGITAL', 'Lya Gov': 'HEALTH' }
    expect(torreDaLinha(mapa, 'Software Development')).toBe('DIGITAL')
    expect(torreDaLinha(mapa, 'Lya Gov')).toBe('HEALTH')
    expect(torreDaLinha(mapa, 'Service Desk')).toBe('ITS')
    expect(torreDaLinha(mapa, '')).toBeNull()
    expect(torreDaLinha(mapa, null)).toBeNull()
  })
})
