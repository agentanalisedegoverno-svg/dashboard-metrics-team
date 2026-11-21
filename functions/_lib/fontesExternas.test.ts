import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyId = vi.fn()
vi.mock('./access', () => ({ verifyAccessIdentity: (...a: unknown[]) => verifyId(...a), verifyAccessJwt: vi.fn() }))

import { atenderFonteExterna, caminhoDe, mapearItemConlicitacao } from './fontesExternas.ts'
import * as rotaApiPncp from '../api/pncp/[[path]].ts'
import * as rotaPncp from '../pncp/[[path]].ts'
import * as rotaComprasgov from '../comprasgov/[[path]].ts'
import * as rotaConlicitacao from '../conlicitacao.ts'

const ENV = { CF_ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', CF_ACCESS_AUD: 'aud', CONLICITACAO_TOKEN: 'segredo-do-token' }
const req = (url = 'https://radar.test/pncp/x', method = 'GET') => new Request(url, { method, headers: { 'cf-access-jwt-assertion': 'jwt' } })
const fetchMock = vi.fn()

beforeEach(() => {
  verifyId.mockResolvedValue({ email: 'a@x.com' })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  fetchMock.mockReset()
  verifyId.mockReset()
  vi.unstubAllGlobals()
})

describe('guardas comuns', () => {
  it('só aceita GET', async () => {
    for (const m of ['POST', 'PUT', 'DELETE']) {
      const r = await atenderFonteExterna(req('https://radar.test/pncp/x', m), ENV, 'consulta/v1/contratacoes/proposta')
      expect(r.status).toBe(405)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem identidade válida nada passa e a fonte externa não é consultada', async () => {
    verifyId.mockResolvedValue(null)
    for (const c of ['consulta/v1/contratacoes/proposta', 'comprasgov/modulo-legado/1_consultarLicitacao', 'conlicitacao']) {
      expect((await atenderFonteExterna(req(), ENV, c)).status).toBe(401)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha fechada sem a configuração do Access', async () => {
    const r = await atenderFonteExterna(req(), { CONLICITACAO_TOKEN: 'x' }, 'conlicitacao')
    expect(r.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caminho fora da lista fechada -> 404, sem consultar a fonte', async () => {
    for (const c of ['', 'consulta/v1/outra', 'comprasgov/modulo-legado/outra', 'comprasgov/', '../etc/passwd', 'conlicitacao/x']) {
      expect((await atenderFonteExterna(req(), ENV, c)).status, c).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('proxy PNCP e Compras.gov.br', () => {
  it('repassa os parâmetros e marca a origem', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const r = await atenderFonteExterna(req('https://radar.test/pncp/consulta/v1/contratacoes/proposta?pagina=2&uf=DF'), ENV, 'consulta/v1/contratacoes/proposta')
    expect(r.status).toBe(200)
    expect(r.headers.get('x-radar-source')).toBe('pncp')
    expect(r.headers.get('cache-control')).toBe('private, max-age=60')
    const alvo = fetchMock.mock.calls[0][0] as URL
    expect(alvo.origin).toBe('https://pncp.gov.br')
    expect(alvo.pathname).toBe('/api/consulta/v1/contratacoes/proposta')
    expect(alvo.searchParams.get('pagina')).toBe('2')
    expect(alvo.searchParams.get('uf')).toBe('DF')
  })

  it('Compras.gov.br usa o host oficial', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }))
    const r = await atenderFonteExterna(req(), ENV, 'comprasgov/modulo-legado/1_consultarLicitacao')
    expect(r.headers.get('x-radar-source')).toBe('compras-gov-dados-abertos')
    expect((fetchMock.mock.calls[0][0] as URL).origin).toBe('https://dadosabertos.compras.gov.br')
  })

  it('falha de rede -> 502 genérico, sem detalhes internos', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1'))
    const r = await atenderFonteExterna(req(), ENV, 'consulta/v1/contratacoes/proposta')
    expect(r.status).toBe(502)
    const corpo = JSON.stringify(await r.json())
    expect(corpo).toContain('PNCP')
    expect(corpo).not.toContain('10.0.0.1')
  })
})

describe('ConLicitações', () => {
  it('sem token configurado -> 503', async () => {
    const r = await atenderFonteExterna(req(), { ...ENV, CONLICITACAO_TOKEN: undefined }, 'conlicitacao')
    expect(r.status).toBe(503)
  })

  it('lê os boletins dos filtros e devolve no formato do PNCP', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/filtros')) return Response.json({ filtros: [{ descricao: 'TI', ultimo_boletim: { id: 7 } }, { descricao: 'Sem boletim' }] })
      return Response.json({ licitacoes: [{ id: 1, edital: 'PE 1/2026', objeto: 'Link', orgao: { nome: 'Órgão', cidade: 'Brasília', uf: 'DF' }, modalidade: { descricao: 'Pregão' } }], acompanhamentos: [] })
    })
    const r = await atenderFonteExterna(req(), ENV, 'conlicitacao')
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo).toMatchObject({ total: 1, filtrosConsultados: 2, filtrosComFalha: 0, fonte: 'ConLicitações' })
    expect(corpo.resultado[0]).toMatchObject({ processo: 'PE 1/2026', modalidadeNome: 'Pregão', numeroControlePNCP: 'conlicitacao-1', source: 'ConLicitações · TI' })
    expect(fetchMock.mock.calls[0][1].headers['X-AUTH-TOKEN']).toBe('segredo-do-token')
  })

  it.each([[401, 401], [403, 403], [500, 502]])('fonte responde %i -> %i, sem vazar o token', async (recebido, esperado) => {
    fetchMock.mockResolvedValue(new Response('{}', { status: recebido }))
    const r = await atenderFonteExterna(req(), ENV, 'conlicitacao')
    expect(r.status).toBe(esperado)
    const corpo = JSON.stringify(await r.json())
    expect(corpo).not.toContain('segredo-do-token')
    expect(corpo).toContain(`HTTP ${recebido}`)
  })

  it('mapeia órgão em texto e usa o boletim como identificador de reserva', () => {
    const m = mapearItemConlicitacao({ orgao: 'Prefeitura X' }, { descricao: 'F' }, 9)
    expect(m.orgaoEntidade.razaoSocial).toBe('Prefeitura X')
    expect(m.numeroControlePNCP).toBe('conlicitacao-9')
    expect(m.modalidadeNome).toBe('Licitação')
  })
})

describe('as quatro rotas usam a mesma implementação (e a mesma guarda)', () => {
  const rotas: [string, (c: any) => Promise<Response>, object][] = [
    ['/api/pncp/*', rotaApiPncp.onRequest, { path: ['consulta', 'v1', 'contratacoes', 'proposta'] }],
    ['/pncp/*', rotaPncp.onRequest, { path: ['consulta', 'v1', 'contratacoes', 'proposta'] }],
    ['/comprasgov/*', rotaComprasgov.onRequest, { path: ['modulo-legado', '1_consultarLicitacao'] }],
    ['/conlicitacao', rotaConlicitacao.onRequest, {}],
  ]
  it.each(rotas)('%s exige identidade', async (_n, onRequest, params) => {
    verifyId.mockResolvedValue(null)
    expect((await onRequest({ request: req(), env: ENV, params })).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(rotas)('%s atende com identidade válida', async (_n, onRequest, params) => {
    fetchMock.mockResolvedValue(Response.json({ filtros: [] }))
    expect((await onRequest({ request: req(), env: ENV, params })).status).toBe(200)
  })
  it('caminhoDe junta os segmentos', () => {
    expect(caminhoDe(['a', 'b'])).toBe('a/b')
    expect(caminhoDe('a')).toBe('a')
    expect(caminhoDe(undefined)).toBe('')
  })
})
