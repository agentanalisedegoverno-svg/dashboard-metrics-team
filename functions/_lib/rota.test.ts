import { describe, expect, it, vi } from 'vitest'

vi.mock('./http.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http.ts')>()),
  identificar: async () => ({ email: 'a@ctctech.com.br' }),
  csrfOk: () => true,
  bancoApp: () => (async () => []) as never,
}))
const disparo = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('./dispararEmails.ts', () => ({ dispararEnvioEmails: disparo }))

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
  it('não aciona em GET, em erro, nem em rota sem a opção', async () => {
    disparo.mockClear()
    await rota({ GET: async () => new Response('{}', { status: 200 }) }, { aoCriar: 'enviarEmails' })(ctx('GET'))
    await rota({ POST: async () => new Response('{}', { status: 422 }) }, { aoCriar: 'enviarEmails' })(ctx('POST'))
    await rota({ POST: async () => new Response('{}', { status: 201 }) })(ctx('POST'))
    expect(disparo).not.toHaveBeenCalled()
  })
})
