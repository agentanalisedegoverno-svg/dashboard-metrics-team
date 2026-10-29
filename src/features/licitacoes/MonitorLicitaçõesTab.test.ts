import { afterEach, describe, expect, it, vi } from 'vitest'
import { consultarComprasGov, consultarPncp, pncpUrl } from './MonitorLicitaçõesTab'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('consultas públicas de licitações', () => {
  it('envia a modalidade obrigatória ao PNCP', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://radar.test' } })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await consultarPncp('SP')

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requestUrl.pathname).toBe('/pncp/consulta/v1/contratacoes/proposta')
    expect(requestUrl.searchParams.get('codigoModalidadeContratacao')).toBe('1')
    expect(requestUrl.searchParams.get('uf')).toBe('SP')
    expect(requestUrl.searchParams.get('dataFinal')).toMatch(/^\\d{8}$/)
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
    expect(atual?.searchParams.get('codigoModalidade')).toBe('1')
    expect(atual?.searchParams.get('dataPublicacaoPncpInicial')).toMatch(/^\\d{4}-\\d{2}-\\d{2}$/)
    expect(atual?.searchParams.get('dataPublicacaoPncpFinal')).toMatch(/^\\d{4}-\\d{2}-\\d{2}$/)
  })

  it('monta o link oficial do PNCP com ano e sequencial na ordem correta', () => {
    expect(pncpUrl('12345678000199-1-000123/2026'))
      .toBe('https://pncp.gov.br/app/editais/12345678000199/2026/000123')
  })
})
