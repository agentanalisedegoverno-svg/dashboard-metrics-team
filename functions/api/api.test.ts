import { beforeEach, describe, expect, it, vi } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }))
const verify = vi.fn()
vi.mock('../_lib/access', () => ({ verifyAccessJwt: (...a: unknown[]) => verify(...a) }))

import { onRequest } from './[[path]]'

const env = { DATABASE_URL: 'postgres://leitor@h/db', CF_ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' }
const call = (path: string, method = 'GET', e: Record<string, string | undefined> = env) =>
  onRequest({ request: new Request(`https://x.test/api/${path}`, { method, headers: { 'cf-access-jwt-assertion': 'jwt' } }), env: e, params: { path } })

beforeEach(() => {
  sqlMock.mockReset()
  verify.mockReset().mockResolvedValue(true)
})

describe('API de leitura (Postgres)', () => {
  it('falha fechada sem Cloudflare Access configurado', async () => {
    const res = await call('rows', 'GET', { DATABASE_URL: env.DATABASE_URL })
    expect(res.status).toBe(503)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('JWT inválido -> 401 e nenhuma consulta ao banco', async () => {
    verify.mockResolvedValue(false)
    expect((await call('rows')).status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('sem DATABASE_URL -> 503', async () => {
    expect((await call('rows', 'GET', { ...env, DATABASE_URL: undefined })).status).toBe(503)
  })

  it('rota desconhecida e método errado -> 404', async () => {
    expect((await call('outra')).status).toBe(404)
    expect((await call('rows', 'POST')).status).toBe(404)
  })

  it('rows devolve as linhas e a data da última carga, sem cache', async () => {
    sqlMock
      .mockResolvedValueOnce([{ ultima_carga_em: '2026-10-11T00:08:41.960Z', total_linhas: 1, erro: null }])
      .mockResolvedValueOnce([{ ano: '2026', status: 'Win', orcamento: 10 }])
    const res = await call('rows')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.json()).toEqual({ rows: [{ ano: '2026', status: 'Win', orcamento: 10 }], updatedAt: '2026-10-11T00:08:41.960Z', isMock: false })
  })

  it('status e sync respondem com contagem e erro da última carga', async () => {
    const row = { ultima_carga_em: '2026-10-11T00:08:41.960Z', total_linhas: 590, erro: null }
    sqlMock.mockResolvedValue([row])
    expect(await (await call('status')).json()).toEqual({ lastSyncAt: '2026-10-11T00:08:41.960Z', rowCount: 590, error: null, isMock: false })
    expect((await call('sync', 'POST')).status).toBe(200)
  })

  it('banco sem nenhuma carga ainda -> lastSyncAt nulo', async () => {
    sqlMock.mockResolvedValue([{ ultima_carga_em: null, total_linhas: 0, erro: null }])
    expect(await (await call('status')).json()).toMatchObject({ lastSyncAt: null, rowCount: 0 })
  })

  it('erro do banco -> 502 sem vazar detalhes', async () => {
    sqlMock.mockRejectedValue(new Error('password authentication failed for user radar_leitor'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call('rows')
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toMatch(/password|radar_leitor/i)
  })
})
