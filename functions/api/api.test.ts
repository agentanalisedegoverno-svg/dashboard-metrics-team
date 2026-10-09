import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from './[[path]]'

const env = { GRAPH_DRIVE_ID: 'd1', GRAPH_ITEM_ID: 'i1', GRAPH_SHEET_NAME: 'Base Governo' }
const header = ['Status', 'Data Pregão', 'Processo']
const call = (path: string, init: RequestInit = {}, e = env) =>
  onRequest({ request: new Request(`https://x.test/api/${path}`, init), env: e, params: { path } })
const auth = { headers: { authorization: 'Bearer tok-do-usuario' } }

afterEach(() => vi.unstubAllGlobals())

describe('API de leitura', () => {
  it('sem Bearer -> 401, sem chamar o Graph', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect((await call('rows')).status).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('sem configuração -> 503', async () => {
    expect((await call('rows', auth, {} as typeof env)).status).toBe(503)
  })

  it('rota desconhecida e método errado -> 404', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect((await call('outra', auth)).status).toBe(404)
    expect((await call('rows', { ...auth, method: 'POST' })).status).toBe(404)
  })

  it('repassa o token do usuário ao Graph e mapeia as linhas', async () => {
    const f = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes('usedRange') ? { values: [header, ['Win', '15/01/2025', 'P-1']] } : { lastModifiedDateTime: '2026-10-09T19:12:37Z' })),
    )
    vi.stubGlobal('fetch', f)
    const res = await call('rows', auth)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = (await res.json()) as { rows: { processo: string; ano: string }[]; updatedAt: string; isMock: boolean }
    expect(body).toMatchObject({ updatedAt: '2026-10-09T19:12:37Z', isMock: false })
    expect(body.rows[0]).toMatchObject({ processo: 'P-1', ano: '2025' })
    for (const [, init] of f.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.headers).toEqual({ authorization: 'Bearer tok-do-usuario' })
    }
  })

  it('status devolve contagem e data do arquivo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes('usedRange') ? { values: [header, ['Win', '15/01/2025', 'P-1'], ['Lost', '16/01/2025', 'P-2']] } : {})),
    ))
    expect(await (await call('status', auth)).json()).toMatchObject({ rowCount: 2, isMock: false, error: null })
  })

  it.each([401, 403])('Graph %i -> mesmo status para o cliente', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
    expect((await call('rows', auth)).status).toBe(status)
  })

  it('falha do Graph (500) -> 502 sem vazar detalhes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call('rows', auth)
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toMatch(/graph|500/i)
  })
})
