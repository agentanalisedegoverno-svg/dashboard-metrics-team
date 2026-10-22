import { describe, expect, it, vi } from 'vitest'
import { consultaCnpj } from './cnpj.ts'

const resposta = (status: number, corpo: unknown = {}) => vi.fn().mockResolvedValue(new Response(JSON.stringify(corpo), { status }))

describe('consultaCnpj (BrasilAPI / Receita Federal)', () => {
  it('matriz', async () => {
    const f = resposta(200, { razao_social: ' BANCO DO BRASIL SA ', identificador_matriz_filial: 1, descricao_situacao_cadastral: 'ATIVA' })
    const r = await consultaCnpj('00.000.000/0001-91', f as unknown as typeof fetch)
    expect(r).toEqual({ ok: true, empresa: { cnpj: '00000000000191', razao_social: 'BANCO DO BRASIL SA', tipo: 'Matriz', situacao: 'ATIVA' } })
    expect(String(f.mock.calls[0][0])).toBe('https://brasilapi.com.br/api/cnpj/v1/00000000000191')
  })
  it('filial (pelo identificador ou pela descrição)', async () => {
    const a = await consultaCnpj('00000000000191', resposta(200, { razao_social: 'X', identificador_matriz_filial: 2 }) as unknown as typeof fetch)
    const b = await consultaCnpj('00000000000191', resposta(200, { razao_social: 'X', descricao_identificador_matriz_filial: 'FILIAL' }) as unknown as typeof fetch)
    expect(a.ok && a.empresa.tipo).toBe('Filial')
    expect(b.ok && b.empresa.tipo).toBe('Filial')
  })
  it('inválido nem chama a rede; 404 = não encontrado; erro ou falha de rede = indisponível', async () => {
    const f = resposta(200)
    expect(await consultaCnpj('123', f as unknown as typeof fetch)).toMatchObject({ ok: false, motivo: 'invalido' })
    expect(f).not.toHaveBeenCalled()
    expect(await consultaCnpj('00000000000191', resposta(404) as unknown as typeof fetch)).toMatchObject({ ok: false, motivo: 'nao_encontrado' })
    expect(await consultaCnpj('00000000000191', resposta(429) as unknown as typeof fetch)).toMatchObject({ ok: false, motivo: 'indisponivel' })
    expect(await consultaCnpj('00000000000191', vi.fn().mockRejectedValue(new Error('rede')) as unknown as typeof fetch)).toMatchObject({ ok: false, motivo: 'indisponivel' })
    expect(await consultaCnpj('00000000000191', resposta(200, { razao_social: '' }) as unknown as typeof fetch)).toMatchObject({ ok: false, motivo: 'indisponivel' })
  })
})
