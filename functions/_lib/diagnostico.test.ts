import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequest as middleware } from '../api/_middleware.ts'
import { comDiagnostico, dentroDoLimite, entradaTempo, LENTO_MS, novoId, ORIGEM, REQ, reiniciarLimiteDiagnostico } from './diagnostico.ts'

const req = (url = 'https://radar.test/api/rows?filtro=segredo', headers: Record<string, string> = { 'cf-ray': 'abc123-GRU' }) => new Request(url, { headers })
const json = (status: number, extra: Record<string, string> = {}) => new Response('{"ok":true}', { status, headers: { 'content-type': 'application/json', ...extra } })

let erro: ReturnType<typeof vi.spyOn>
let aviso: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  erro = vi.spyOn(console, 'error').mockImplementation(() => {})
  aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
  reiniciarLimiteDiagnostico()
})
afterEach(() => vi.useRealTimers())

describe('comDiagnostico: marca a resposta com origem, código e tempo', () => {
  it('toda resposta do Radar leva x-radar-origem, x-radar-req (8 hex) e server-timing; o corpo e o status passam intactos', async () => {
    const r = await comDiagnostico(req(), async () => json(200))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect(r.headers.get(ORIGEM)).toBe('funcao')
    expect(r.headers.get(REQ)).toMatch(/^[0-9a-f]{8}$/)
    expect(r.headers.get('server-timing')).toMatch(/^app;dur=\d+$/)
    expect(r.headers.get('content-type')).toBe('application/json')
  })

  it('cada requisição tem um código diferente', () => {
    expect(new Set(Array.from({ length: 50 }, novoId)).size).toBe(50)
  })

  it('preserva as etapas que a rota registrou no server-timing e acrescenta o total', async () => {
    const r = await comDiagnostico(req(), async () => json(200, { 'server-timing': 'status;dur=5, linhas;dur=120;desc="809 linhas"' }))
    expect(r.headers.get('server-timing')).toMatch(/^app;dur=\d+, status;dur=5, linhas;dur=120;desc="809 linhas"$/)
  })

  it('mantém respostas imutáveis (como as de fetch) e sem corpo (204) funcionando', async () => {
    const r = await comDiagnostico(req(), async () => new Response(null, { status: 204 }))
    expect(r.status).toBe(204)
    expect(r.headers.get(ORIGEM)).toBe('funcao')
  })
})

describe('comDiagnostico: o que vai (e o que não vai) para o log', () => {
  it('5xx e 429 geram uma linha de erro com req, status, rota, ray e etapas, sem query string, e-mail nem corpo', async () => {
    const r = await comDiagnostico(req(), async () => json(503, { 'server-timing': 'status;dur=7' }))
    expect(erro).toHaveBeenCalledTimes(1)
    const linha = JSON.parse(String(erro.mock.calls[0][0]))
    expect(linha).toMatchObject({ evt: 'api', req: r.headers.get(REQ), s: 503, m: 'GET', rota: '/api/rows', ray: 'abc123-GRU', st: 'status;dur=7' })
    expect(JSON.stringify(linha)).not.toMatch(/segredo|filtro/)
    await comDiagnostico(req(), async () => json(429))
    expect(erro).toHaveBeenCalledTimes(2)
  })

  it('erros comuns (401, 403, 404, 422) e respostas rápidas não geram log', async () => {
    for (const s of [200, 201, 401, 403, 404, 405, 409, 422]) await comDiagnostico(req(), async () => json(s))
    expect(erro).not.toHaveBeenCalled()
    expect(aviso).not.toHaveBeenCalled()
  })

  it('resposta lenta (>= limite) gera aviso mesmo com 200', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'))
    const r = await comDiagnostico(req(), async () => {
      vi.advanceTimersByTime(LENTO_MS + 10)
      return json(200)
    })
    expect(r.status).toBe(200)
    expect(aviso).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(aviso.mock.calls[0][0]))).toMatchObject({ s: 200, lento: true })
    expect(erro).not.toHaveBeenCalled()
  })
})

describe('comDiagnostico: exceção não tratada', () => {
  it('vira 500 JSON com o código da requisição (e não uma página do Cloudflare sem pista), sem vazar o erro ao cliente', async () => {
    const r = await comDiagnostico(req(), async () => {
      throw new Error('password authentication failed for user "radar_app" host=db.interno')
    })
    expect(r.status).toBe(500)
    const corpo = await r.json()
    expect(corpo).toEqual({ error: 'Erro interno ao processar a requisição.', req: r.headers.get(REQ) })
    expect(JSON.stringify(corpo)).not.toMatch(/radar_app|password|db\.interno/)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get(ORIGEM)).toBe('funcao')
    expect(JSON.parse(String(erro.mock.calls[0][0])).excecao).toMatch(/^Error: password authentication failed/) // o log tem o motivo
  })
})

describe('middleware de /api', () => {
  it('chama a rota (next) e marca a resposta', async () => {
    const next = vi.fn().mockResolvedValue(json(200))
    const r = await middleware({ request: req(), next })
    expect(next).toHaveBeenCalledTimes(1)
    expect(r.headers.get(ORIGEM)).toBe('funcao')
  })
})

describe('utilitários', () => {
  it('entradaTempo formata e limpa a descrição', () => {
    expect(entradaTempo('linhas', 120.6, '809 linhas')).toBe('linhas;dur=121;desc="809 linhas"')
    expect(entradaTempo('x', -5)).toBe('x;dur=0')
    expect(entradaTempo('x', 1, 'a"b;c')).toBe('x;dur=1;desc="abc"')
  })

  it('dentroDoLimite: janela de 1 minuto por chave', () => {
    const t = 1_000_000
    for (let i = 0; i < 3; i++) expect(dentroDoLimite('u', 3, t)).toBe(true)
    expect(dentroDoLimite('u', 3, t + 1000)).toBe(false)
    expect(dentroDoLimite('outro', 3, t + 1000)).toBe(true)
    expect(dentroDoLimite('u', 3, t + 61_000)).toBe(true)
  })
})
