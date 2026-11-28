import { beforeEach, describe, expect, it, vi } from 'vitest'

const conectar = vi.fn()
vi.mock('./banco', () => ({ conectar: (...a: unknown[]) => conectar(...a) }))

import { comLeitura, usaHyperdrive } from './leitura'

const HD = { connectionString: 'postgres://leitor:x@abc.hyperdrive.local:5432/radar' }
const DIRETA = 'postgres://leitor:senha@host.postgres.database.azure.com/radar'

beforeEach(() => {
  conectar.mockReset().mockImplementation((url: string) => ({ url }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('conexão de leitura do painel (Hyperdrive opcional)', () => {
  it('sem o binding usa a DATABASE_URL, com TLS, como sempre foi', async () => {
    const usada = await comLeitura({ DATABASE_URL: DIRETA }, async (sql) => (sql as unknown as { url: string }).url)
    expect(usada).toBe(DIRETA)
    expect(conectar).toHaveBeenCalledTimes(1)
    expect(conectar).toHaveBeenCalledWith(DIRETA)
  })

  it('com o binding usa o Hyperdrive (sem TLS no trecho local) e nem abre a conexão direta', async () => {
    const usada = await comLeitura({ DATABASE_URL: DIRETA, HYPERDRIVE: HD }, async (sql) => (sql as unknown as { url: string }).url)
    expect(usada).toBe(HD.connectionString)
    expect(conectar).toHaveBeenCalledTimes(1)
    expect(conectar).toHaveBeenCalledWith(HD.connectionString, { hyperdrive: true })
  })

  it('se o Hyperdrive falhar, tenta de novo direto pela DATABASE_URL e não derruba a leitura (loga só o tipo do erro)', async () => {
    const fn = vi.fn(async (sql: unknown) => {
      if ((sql as { url: string }).url === HD.connectionString) throw Object.assign(new Error('password authentication failed for user radar_leitor'), { code: 'ECONNRESET' })
      return 'ok pela direta'
    })
    expect(await comLeitura({ DATABASE_URL: DIRETA, HYPERDRIVE: HD }, fn as never)).toBe('ok pela direta')
    expect(fn).toHaveBeenCalledTimes(2)
    const log = String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.join(' '))
    expect(log).toContain('ECONNRESET')
    expect(log).not.toMatch(/password|radar_leitor/i)
  })

  it('Hyperdrive com defeito e sem DATABASE_URL: o erro sobe (a rota o transforma em 502)', async () => {
    await expect(comLeitura({ HYPERDRIVE: HD }, async () => { throw new Error('hd fora') })).rejects.toThrow('hd fora')
  })

  it('sem nenhuma das duas: erro claro, sem tentar conectar', async () => {
    await expect(comLeitura({}, async () => 1)).rejects.toThrow('DATABASE_URL ausente')
    expect(conectar).not.toHaveBeenCalled()
  })

  it('erro de consulta pela conexão direta não é repetido', async () => {
    const fn = vi.fn(async () => { throw new Error('consulta quebrou') })
    await expect(comLeitura({ DATABASE_URL: DIRETA }, fn)).rejects.toThrow('consulta quebrou')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('usaHyperdrive só é verdadeiro com a string de conexão presente', () => {
    expect(usaHyperdrive({ HYPERDRIVE: HD })).toBe(true)
    expect(usaHyperdrive({ HYPERDRIVE: { connectionString: '' } })).toBe(false)
    expect(usaHyperdrive({ DATABASE_URL: DIRETA })).toBe(false)
  })
})
