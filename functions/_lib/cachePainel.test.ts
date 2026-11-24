import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { respostaComCache } from './cachePainel'

/** Cache API de mentira: guarda por URL e devolve cópias (como o do Cloudflare). */
function criarCache() {
  const guardado = new Map<string, Response>()
  return {
    guardado,
    match: vi.fn(async (r: Request) => guardado.get(r.url)?.clone()),
    put: vi.fn(async (r: Request, res: Response) => void guardado.set(r.url, res)),
  }
}

const cabecalhos = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
const montar = (gerar: () => Promise<{ corpo: string; tempo: string }>, extra: { fresco?: boolean; waitUntil?: (p: Promise<unknown>) => void } = {}) =>
  respostaComCache({ rota: 'rows', ttl: 20, fresco: extra.fresco ?? false, cabecalhos, gerar, waitUntil: extra.waitUntil })
const gerador = (corpo = '{"rows":[]}') => vi.fn(async () => ({ corpo, tempo: 'consulta;dur=9' }))

let cache: ReturnType<typeof criarCache>
beforeEach(() => {
  cache = criarCache()
  vi.stubGlobal('caches', { default: cache })
})
afterEach(() => vi.unstubAllGlobals())

describe('cache de curta duração do painel', () => {
  it('1ª leitura vai ao banco e guarda; a 2ª sai da cópia e NÃO chama o banco', async () => {
    const gerar = gerador('{"rows":[1]}')
    const a = await montar(gerar)
    expect(a.headers.get('x-radar-cache')).toBe('miss')
    expect(await a.text()).toBe('{"rows":[1]}')
    const b = await montar(gerar)
    expect(b.headers.get('x-radar-cache')).toBe('hit')
    expect(await b.text()).toBe('{"rows":[1]}')
    expect(gerar).toHaveBeenCalledTimes(1)
  })

  it('o navegador sempre recebe private, no-store; o public/max-age fica só na cópia interna', async () => {
    const gerar = gerador()
    const a = await montar(gerar)
    expect(a.headers.get('cache-control')).toBe('private, no-store')
    const b = await montar(gerar)
    expect(b.headers.get('cache-control')).toBe('private, no-store')
    const interna = [...cache.guardado.values()][0]
    expect(interna.headers.get('cache-control')).toBe('public, max-age=20')
  })

  it('a chave da cópia não depende do usuário nem da URL do pedido', async () => {
    await montar(gerador())
    expect([...cache.guardado.keys()]).toEqual(['https://cache.radar.internal/api/rows'])
  })

  it('?fresco ignora a cópia, lê do banco e a SUBSTITUI (os demais passam a ver o dado novo)', async () => {
    await montar(gerador('{"v":1}'))
    const f = await montar(gerador('{"v":2}'), { fresco: true })
    expect(f.headers.get('x-radar-cache')).toBe('fresco')
    expect(await f.text()).toBe('{"v":2}')
    const depois = await montar(gerador('{"v":3}'))
    expect(depois.headers.get('x-radar-cache')).toBe('hit')
    expect(await depois.text()).toBe('{"v":2}')
  })

  it('sem Cache API (off): responde do banco como antes', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('caches', undefined)
    const gerar = gerador()
    const r = await montar(gerar)
    expect(r.status).toBe(200)
    expect(r.headers.get('x-radar-cache')).toBe('off')
    await montar(gerar)
    expect(gerar).toHaveBeenCalledTimes(2)
  })

  it('falha ao ler ou gravar o cache nunca derruba a resposta', async () => {
    cache.match.mockRejectedValue(new Error('cache fora'))
    cache.put.mockRejectedValue(new Error('cache fora'))
    const r = await montar(gerador('{"ok":true}'))
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('{"ok":true}')
  })

  it('erro do banco propaga (a rota o transforma em 502) e nada é guardado', async () => {
    await expect(montar(async () => { throw new Error('banco fora') })).rejects.toThrow('banco fora')
    expect(cache.guardado.size).toBe(0)
  })

  it('a gravação da cópia vai por waitUntil quando existe (não atrasa a resposta)', async () => {
    const waitUntil = vi.fn()
    await montar(gerador(), { waitUntil })
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('o hit informa a idade da cópia no Server-Timing', async () => {
    await montar(gerador())
    const b = await montar(gerador())
    expect(b.headers.get('server-timing')).toMatch(/^cache;dur=0;desc="copia de \d+ s"$/)
  })
})
