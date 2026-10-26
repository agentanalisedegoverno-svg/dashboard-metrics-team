import { describe, expect, it, vi } from 'vitest'
import { ErroGraph, graphApp } from './graph.ts'

const cred = { tenantId: 'tenant-1', clientId: 'cliente-1', clientSecret: 'SEGREDO-DO-APP' }
const json = (corpo: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(corpo), { status, headers })

/** fetch falso: devolve as respostas na ordem e guarda as chamadas. */
function falso(...respostas: Response[]) {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init })
    const r = respostas.shift()
    if (!r) throw new Error('resposta não prevista: ' + url)
    return r
  })
  return { f: f as unknown as typeof fetch, chamadas }
}
const token = () => json({ access_token: 'tok-1', expires_in: 3600 })

describe('graphApp (credencial de aplicação)', () => {
  it('pede o token com client credentials e o reaproveita até perto de expirar', async () => {
    const { f, chamadas } = falso(token(), json({ id: 'a' }), json({ id: 'b' }))
    const g = graphApp(cred, f)
    await g.get('/users/x')
    await g.get('/users/y')
    expect(chamadas.filter((c) => c.url.includes('oauth2/v2.0/token'))).toHaveLength(1)
    const corpo = String(chamadas[0].init?.body)
    expect(corpo).toContain('grant_type=client_credentials')
    expect(corpo).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default')
    expect(chamadas[0].url).toContain('/tenant-1/')
    expect((chamadas[1].init?.headers as Record<string, string>).authorization).toBe('Bearer tok-1')
  })
  it('PATCH leva If-Match; POST e PATCH pedem a representação; resposta vazia vira objeto vazio', async () => {
    const { f, chamadas } = falso(token(), new Response(null, { status: 204 }))
    const r = await graphApp(cred, f).patch('/planner/tasks/1', { a: 1 }, 'W/"etag"')
    expect(r).toEqual({})
    const h = chamadas[1].init?.headers as Record<string, string>
    expect(h['if-match']).toBe('W/"etag"')
    expect(h.prefer).toBe('return=representation')
  })
  it('429 e 503 esperam o Retry-After e tentam de novo (no máximo 3 vezes)', async () => {
    const dormir = vi.fn(async () => {})
    const { f } = falso(token(), json({}, 429, { 'retry-after': '3' }), json({}, 503), json({ ok: true }))
    expect(await graphApp(cred, f, dormir).get('/x')).toEqual({ ok: true })
    expect(dormir).toHaveBeenNthCalledWith(1, 3000)
    expect(dormir).toHaveBeenCalledTimes(2)
    const esgota = falso(token(), json({}, 429), json({}, 429), json({}, 429), json({}, 429))
    await expect(graphApp(cred, esgota.f, async () => {}).get('/x')).rejects.toMatchObject({ status: 429 })
  })
  it('401 renova o token uma vez; o segundo 401 vira erro', async () => {
    const { f, chamadas } = falso(token(), json({}, 401), json({ access_token: 'tok-2', expires_in: 3600 }), json({ ok: 1 }))
    expect(await graphApp(cred, f).get('/x')).toEqual({ ok: 1 })
    expect(chamadas.filter((c) => c.url.includes('oauth2')).length).toBe(2)
    const dois = falso(token(), json({}, 401), token(), json({ error: 'x' }, 401))
    await expect(graphApp(cred, dois.f).get('/x')).rejects.toBeInstanceOf(ErroGraph)
  })
  it('erros carregam o status e NUNCA o segredo; falha de token não ecoa a resposta', async () => {
    const { f } = falso(json({ error_description: 'AADSTS7000215 secret SEGREDO-DO-APP invalid', client: 'cliente-1' }, 401))
    const e = await graphApp(cred, f).get('/x').catch((x) => x)
    expect(e).toBeInstanceOf(ErroGraph)
    expect(e.status).toBe(401)
    expect(e.message).not.toContain('SEGREDO-DO-APP')
    expect(e.message).not.toContain('cliente-1')
    const { f: f2 } = falso(token(), json({ error: { message: 'Not found' } }, 404))
    const e2 = await graphApp(cred, f2).get('/planner/tasks/zzz?$select=id').catch((x) => x)
    expect(e2).toMatchObject({ status: 404 })
    expect(e2.message).toContain('/planner/tasks/zzz')
    expect(e2.message).not.toContain('$select') // a consulta não vai para a mensagem
  })
  it('paginado segue @odata.nextLink até o fim', async () => {
    const { f, chamadas } = falso(token(), json({ value: [1, 2], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/p?page=2' }), json({ value: [3] }))
    expect(await graphApp(cred, f).paginado('/p')).toEqual([1, 2, 3])
    expect(chamadas[2].url).toBe('https://graph.microsoft.com/v1.0/p?page=2')
  })
})
