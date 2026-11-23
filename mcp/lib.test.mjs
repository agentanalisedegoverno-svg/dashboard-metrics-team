import { describe, expect, it, vi } from 'vitest'
import { ErroRadar, LIMITE_MAXIMO, LIMITE_PADRAO, URL_PADRAO, criarCliente, lerConfig, listarCampos, listarOportunidades, verOportunidade } from './lib.mjs'

const CHAVE = 'rdr_' + 'K'.repeat(43)
const BASE = 'https://radar.test/api/externo'
const json = (corpo, init = {}) => new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

describe('lerConfig', () => {
  it('exige a chave e o formato rdr_..., sem nunca ecoar o valor informado', () => {
    expect(() => lerConfig({})).toThrow(/RADAR_API_KEY/)
    const ruim = 'rdr_curta'
    try {
      lerConfig({ RADAR_API_KEY: ruim })
    } catch (e) {
      expect(e).toBeInstanceOf(ErroRadar)
      expect(e.message).not.toContain(ruim)
    }
    expect(() => lerConfig({ RADAR_API_KEY: ruim })).toThrow(/formato/)
  })
  it('usa a URL de produção por padrão e tira a barra final', () => {
    expect(lerConfig({ RADAR_API_KEY: CHAVE }).baseUrl).toBe(URL_PADRAO)
    expect(lerConfig({ RADAR_API_KEY: CHAVE, RADAR_API_URL: `${BASE}/` }).baseUrl).toBe(BASE)
  })
  it('só aceita https (http apenas em localhost) e recusa credenciais na URL', () => {
    expect(() => lerConfig({ RADAR_API_KEY: CHAVE, RADAR_API_URL: 'http://radar.test/api/externo' })).toThrow(/https/)
    expect(() => lerConfig({ RADAR_API_KEY: CHAVE, RADAR_API_URL: 'ftp://radar.test' })).toThrow(/https/)
    expect(() => lerConfig({ RADAR_API_KEY: CHAVE, RADAR_API_URL: 'https://user:senha@radar.test' })).toThrow(/usuário/)
    expect(() => lerConfig({ RADAR_API_KEY: CHAVE, RADAR_API_URL: 'não é url' })).toThrow(/URL/)
    expect(lerConfig({ RADAR_API_KEY: CHAVE, RADAR_API_URL: 'http://127.0.0.1:8788/api/externo' }).baseUrl).toBe('http://127.0.0.1:8788/api/externo')
  })
})

describe('cliente HTTP', () => {
  it('só tem leitura: o único método é get', () => {
    expect(Object.keys(criarCliente({ baseUrl: BASE, chave: CHAVE }))).toEqual(['get'])
  })

  it('faz GET com a chave no Authorization, descarta parâmetros vazios e não segue redirecionamento', async () => {
    const f = vi.fn().mockResolvedValue(json({ ok: true }))
    await criarCliente({ baseUrl: BASE, chave: CHAVE, fetchImpl: f }).get('/oportunidades', { status: 'Go', q: '', uf: undefined, limite: 5 })
    const [url, init] = f.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/oportunidades?status=Go&limite=5`)
    expect(init.method).toBe('GET')
    expect(init.headers.authorization).toBe(`Bearer ${CHAVE}`)
    expect(init.redirect).toBe('error') // a tela de login do Access nunca recebe a chave
    expect(init.body).toBeUndefined()
  })

  it.each([
    [401, 'ausente, inválida ou revogada'],
    [403, 'LEITURA'],
    [404, 'não encontrada'],
    [429, 'Muitas consultas'],
    [503, 'banco de consulta'],
    [500, 'HTTP 500'],
  ])('HTTP %i vira mensagem clara, sem vazar a chave', async (status, trecho) => {
    const f = vi.fn().mockResolvedValue(json({ error: `falha com ${CHAVE}` }, { status, headers: { 'retry-after': '30' } }))
    const e = await criarCliente({ baseUrl: BASE, chave: CHAVE, fetchImpl: f }).get('/x').catch((x) => x)
    expect(e).toBeInstanceOf(ErroRadar)
    expect(e.status).toBe(status)
    expect(e.message).toContain(trecho)
    expect(e.message).not.toContain(CHAVE) // a mensagem vem de um texto fixo, não do corpo do servidor
  })

  it('422 mostra quais filtros estão errados', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'Parâmetros inválidos.', erros: [{ campo: 'limite', mensagem: 'Use de 1 a 500' }] }, { status: 422 }))
    const e = await criarCliente({ baseUrl: BASE, chave: CHAVE, fetchImpl: f }).get('/x').catch((x) => x)
    expect(e.message).toContain('limite: Use de 1 a 500')
  })

  it('erro de rede, tempo esgotado e resposta que não é JSON viram mensagens genéricas', async () => {
    const rede = await criarCliente({ baseUrl: BASE, chave: CHAVE, fetchImpl: vi.fn().mockRejectedValue(new TypeError(`fetch failed ${CHAVE}`)) }).get('/x').catch((x) => x)
    expect(rede.message).toMatch(/rede/)
    expect(rede.message).not.toContain(CHAVE)
    const tempo = await criarCliente({ baseUrl: BASE, chave: CHAVE, fetchImpl: vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })) }).get('/x').catch((x) => x)
    expect(tempo.message).toMatch(/demorou/)
    const html = await criarCliente({ baseUrl: BASE, chave: CHAVE, fetchImpl: vi.fn().mockResolvedValue(new Response('<html>login</html>', { status: 200 })) }).get('/x').catch((x) => x)
    expect(html.message).toMatch(/não é JSON/)
  })
})

describe('ferramentas', () => {
  const cliente = (resposta = { total: 2, limite: 25, offset: 0, proximo_offset: null, itens: [{ id: 1 }, { id: 2 }] }) => ({ get: vi.fn().mockResolvedValue(resposta) })

  it('listar: limite padrão 25, teto 100, filtros repassados e argumentos desconhecidos descartados', async () => {
    const c = cliente()
    const r = await listarOportunidades(c, { status: 'Go', valor_min: 1_000_000, arquivadas: true, perigoso: 'x', 'drop table': 1 })
    expect(c.get).toHaveBeenCalledWith('/oportunidades', { status: 'Go', valor_min: 1_000_000, arquivadas: true, limite: LIMITE_PADRAO })
    expect(r).toEqual({ total: 2, retornadas: 2, offset: 0, proximo_offset: null, itens: [{ id: 1 }, { id: 2 }] })
    await listarOportunidades(c, { limite: 5000, offset: 200 })
    expect(c.get).toHaveBeenLastCalledWith('/oportunidades', { limite: LIMITE_MAXIMO, offset: 200 })
    await listarOportunidades(c, { limite: 0 })
    expect(c.get.mock.lastCall[1].limite).toBe(1)
    await listarOportunidades(c, { limite: 7.5, offset: -3 })
    expect(c.get.mock.lastCall[1]).toEqual({ limite: LIMITE_PADRAO })
  })

  it('ver: aceita código AAAA-NNNN e id; recusa qualquer outra coisa antes de chamar a API', async () => {
    const c = cliente({ id: 9 })
    await verOportunidade(c, { codigo: ' 2026-0001 ' })
    expect(c.get).toHaveBeenLastCalledWith('/oportunidades/2026-0001')
    await verOportunidade(c, { codigo: '42' })
    expect(c.get).toHaveBeenLastCalledWith('/oportunidades/42')
    c.get.mockClear()
    for (const codigo of ['', '../../etc/passwd', "1'; drop table x;--", '2026-', 'abc', undefined, '2026-0001/historico', '1?a=b']) {
      await expect(verOportunidade(c, { codigo })).rejects.toThrow(/código/)
    }
    expect(c.get).not.toHaveBeenCalled()
  })

  it('campos consulta o catálogo', async () => {
    const c = cliente({ campos: [] })
    await listarCampos(c)
    expect(c.get).toHaveBeenCalledWith('/campos')
  })
})
