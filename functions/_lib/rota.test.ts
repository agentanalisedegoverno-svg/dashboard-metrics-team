import { describe, expect, it, vi } from 'vitest'

vi.mock('./http.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http.ts')>()),
  identificar: async () => ({ email: 'a@ctctech.com.br' }),
  csrfOk: () => true,
  bancoApp: () => (async () => []) as never,
}))
const disparo = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('./dispararEmails.ts', () => ({ dispararEnvioEmails: disparo }))
const planner = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('./dispararPlanner.ts', () => ({ dispararPlanner: planner }))

import { rota } from './rota.ts'

const ctx = (metodo: string, waitUntil = vi.fn()) => ({ request: new Request('https://radar.test/api/x', { method: metodo }), env: {}, params: {}, waitUntil })

describe('rota: aviso de e-mail ao cadastrar', () => {
  it('201 em POST aciona o envio de e-mails em segundo plano (waitUntil)', async () => {
    disparo.mockClear()
    const r = rota({ POST: async () => new Response('{}', { status: 201 }) }, { aoCriar: 'enviarEmails' })
    const c = ctx('POST')
    expect((await r(c)).status).toBe(201)
    expect(disparo).toHaveBeenCalledTimes(1)
    expect(c.waitUntil).toHaveBeenCalledTimes(1)
  })
  it('criar aciona e-mails e Planner; salvar (PUT 200) também, mas só com a opção aoSalvar', async () => {
    disparo.mockClear(); planner.mockClear()
    await rota({ POST: async () => new Response('{}', { status: 201 }) }, { aoCriar: 'enviarEmails' })(ctx('POST'))
    expect([disparo.mock.calls.length, planner.mock.calls.length]).toEqual([1, 1])
    await rota({ PUT: async () => new Response('{}', { status: 200 }) }, { aoSalvar: 'integracoes' })(ctx('PUT'))
    expect([disparo.mock.calls.length, planner.mock.calls.length]).toEqual([2, 2])
    await rota({ PUT: async () => new Response('{}', { status: 200 }) })(ctx('PUT'))
    await rota({ PUT: async () => new Response('{}', { status: 409 }) }, { aoSalvar: 'integracoes' })(ctx('PUT'))
    expect([disparo.mock.calls.length, planner.mock.calls.length]).toEqual([2, 2])
  })
  it('não aciona em GET, em erro, nem em rota sem a opção', async () => {
    disparo.mockClear()
    await rota({ GET: async () => new Response('{}', { status: 200 }) }, { aoCriar: 'enviarEmails' })(ctx('GET'))
    await rota({ POST: async () => new Response('{}', { status: 422 }) }, { aoCriar: 'enviarEmails' })(ctx('POST'))
    await rota({ POST: async () => new Response('{}', { status: 201 }) })(ctx('POST'))
    expect(disparo).not.toHaveBeenCalled()
  })
})
