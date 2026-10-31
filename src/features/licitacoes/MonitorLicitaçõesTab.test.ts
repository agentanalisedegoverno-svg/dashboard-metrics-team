import { afterEach, describe, expect, it, vi } from 'vitest'
import { consultarComprasGov, consultarPncp, consultarPncpUf, pncpUrl } from './MonitorLicitaçõesTab'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('consultas públicas de licitações', () => {
  it('envia a modalidade obrigatória ao PNCP', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://radar.test' } })
    let requestUrl: URL | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = new URL(String(input))
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await consultarPncp('SP')

    expect(requestUrl?.pathname).toBe('/pncp/consulta/v1/contratacoes/proposta')
    expect(requestUrl?.searchParams.get('codigoModalidadeContratacao')).toBe('6') // 6 = Pregão - Eletrônico no PNCP (1 é Leilão)
    expect(requestUrl?.searchParams.get('tamanhoPagina')).toBe('50')
    expect(requestUrl?.searchParams.get('uf')).toBe('SP')
    expect(requestUrl?.searchParams.get('dataFinal')).toMatch(/^\d{8}$/)
  })

  it('envia filtros obrigatórios à consulta de contratações da Lei 14.133', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://radar.test' } })
    const urls: URL[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input)))
      return new Response(JSON.stringify({ resultado: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await consultarComprasGov()

    const atual = urls.find(url => url.pathname.endsWith('1_consultarContratacoes_PNCP_14133'))
    expect(atual).toBeDefined()
    expect(atual?.searchParams.get('codigoModalidade')).toBe('5') // no Compras.gov.br, 5 = Pregão - Eletrônico
    expect(atual?.searchParams.get('dataPublicacaoPncpInicial')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(atual?.searchParams.get('dataPublicacaoPncpFinal')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('varre as páginas do PNCP em sequência e para na última (sem passar do limite)', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://radar.test' } })
    const paginas: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const p = new URL(String(input)).searchParams.get('pagina') as string
      paginas.push(p)
      return new Response(JSON.stringify({ data: [{ numeroControlePNCP: 'x' + p }], totalPaginas: 3 }), { status: 200 })
    }))
    expect((await consultarPncpUf('BA')).map(i => i.numeroControlePNCP)).toEqual(['x1', 'x2', 'x3'])
    expect(paginas).toEqual(['1', '2', '3'])
    paginas.length = 0
    await consultarPncpUf('BA', undefined, 2) // teto de páginas
    expect(paginas).toEqual(['1', '2'])
  })

  it('trata resposta vazia do PNCP (204 sem corpo) como lista vazia, sem erro', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://radar.test' } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    expect(await consultarPncpUf('SP')).toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    expect(await consultarPncpUf('SP')).toEqual([])
  })

  it('monta o link oficial do PNCP com ano e sequencial na ordem correta', () => {
    expect(pncpUrl('12345678000199-1-000123/2026'))
      .toBe('https://pncp.gov.br/app/editais/12345678000199/2026/000123')
  })
})
