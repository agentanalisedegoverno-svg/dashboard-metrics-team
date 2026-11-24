import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarLimiteDiagnostico } from '../_lib/diagnostico.ts'

const sqlApp = vi.fn()
const sqlLeitor = vi.fn()
vi.mock('../_lib/banco', () => ({ conectar: (url: string) => (url.includes('leitor') ? sqlLeitor : sqlApp) }))
vi.mock('../_lib/access', () => ({
  verifyAccessIdentity: async () => ({ email: 'jefferson@ctctech.com.br' }),
  verifyAccessJwt: async () => true,
}))

import { onRequest } from './diagnostico.ts'

const ENV = { DATABASE_URL: 'postgres://leitor:SENHA-SECRETA@host-interno.postgres.database.azure.com/db', DATABASE_URL_APP: 'postgres://app:SENHA-APP@host-interno/db', CF_ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-secreto' }
const chamar = (env: Record<string, string | undefined> = ENV, headers: Record<string, string> = { 'cf-access-jwt-assertion': 'jwt', 'cf-ray': 'ray-1' }) =>
  onRequest({ request: new Request('https://radar.test/api/diagnostico', { headers }), env, params: {} })

beforeEach(() => {
  sqlApp.mockReset().mockResolvedValue([{ '?column?': 1 }])
  sqlLeitor.mockReset().mockResolvedValue([{ '?column?': 1 }])
  reiniciarLimiteDiagnostico()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/diagnostico', () => {
  it('tudo certo: relatório com config, os dois bancos e a consulta do painel (linhas, KB e tempo)', async () => {
    sqlLeitor.mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([{ ano: '2026', descritivo: 'x'.repeat(2048) }, { ano: '2026', descritivo: 'y' }])
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const j = await res.json()
    expect(j).toMatchObject({ ok: true, ray: 'ray-1', config: { access: true, acesso_publico: false, banco_cadastro: true, banco_painel: true } })
    expect(j.checks.map((c: { nome: string }) => c.nome)).toEqual(['banco (papel do cadastro)', 'banco (papel do painel)', 'consulta do painel (/api/rows)'])
    expect(j.checks[2]).toMatchObject({ ok: true, detalhe: '2 linhas, 2 KB' })
    expect(typeof j.checks[2].ms).toBe('number')
  })

  it('banco fora do ar: o relatório diz QUAL verificação falhou e só o tipo do erro, nunca a mensagem', async () => {
    sqlLeitor.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED host-interno.postgres.database.azure.com:5432 user=leitor'), { code: 'ECONNREFUSED' }))
    const j = await (await chamar()).json()
    expect(j.ok).toBe(false)
    expect(j.checks[0].ok).toBe(true)
    expect(j.checks[1]).toMatchObject({ ok: false, erro: 'ECONNREFUSED' })
    expect(j.checks[2]).toMatchObject({ ok: false, erro: 'ECONNREFUSED' })
    expect(JSON.stringify(j)).not.toMatch(/host-interno|azure|user=leitor/)
  })

  it('variável de banco ausente aparece no relatório (em vez de um 503 mudo)', async () => {
    const j = await (await chamar({ ...ENV, DATABASE_URL: undefined, DATABASE_URL_APP: undefined })).json()
    expect(j.ok).toBe(false)
    expect(j.config).toMatchObject({ banco_cadastro: false, banco_painel: false })
    expect(j.checks.map((c: { erro?: string }) => c.erro)).toEqual(['DATABASE_URL_APP ausente', 'DATABASE_URL ausente'])
  })

  it('não vaza segredo: nem URL de banco, nem senha, nem o AUD do Access', async () => {
    const texto = await (await chamar()).text()
    expect(texto).not.toMatch(/SENHA|postgres:\/\/|host-interno|aud-secreto|t\.cloudflareaccess/)
  })

  it('limite de 6 por minuto por usuário -> 429 (a exigência de login está em seguranca.test.ts, que testa toda rota)', async () => {
    for (let i = 0; i < 6; i++) expect((await chamar()).status).toBe(200)
    const sexta = await chamar()
    expect(sexta.status).toBe(429)
    expect(sqlApp).toHaveBeenCalledTimes(6)
  })

  it('só aceita GET', async () => {
    const r = await onRequest({ request: new Request('https://radar.test/api/diagnostico', { method: 'POST', headers: { 'cf-access-jwt-assertion': 'jwt', 'x-radar-csrf': '1' } }), env: ENV, params: {} })
    expect(r.status).toBe(405)
  })
})
