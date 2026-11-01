import { afterEach, describe, expect, it, vi } from 'vitest'
import { consultarComprasGov, consultarPncp, consultarPncpUf, fonteNaoAtivada, normalizarCompras, oportunidadeDe, pncpUrl } from './MonitorLicitaçõesTab'

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
    const dataFinal = requestUrl?.searchParams.get('dataFinal') ?? ''
    expect(dataFinal).toMatch(/^\d{8}$/)
    const hojeIso = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    expect(dataFinal > hojeIso).toBe(true) // com a data de hoje o PNCP responde 204 e a busca "não acha nada"
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

  it('normaliza o Compras.gov (formato 14.133) sem apagar objeto, processo, órgão, UASG e data de encerramento', () => {
    const r = normalizarCompras({
      processo: '64047.004227/2026-18', numeroCompra: '76', objetoCompra: 'Serviços de engenharia', orgaoEntidadeRazaoSocial: 'COMANDO DO EXERCITO',
      unidadeOrgaoCodigoUnidade: '160157', unidadeOrgaoNomeUnidade: '9 BATALHAO', unidadeOrgaoUfSigla: 'MT',
      dataEncerramentoPropostaPncp: '2026-10-30T10:00:00', numeroControlePNCP: '00394452000103-1-022223/2026',
    }, 'modulo-contratacoes/1_consultarContratacoes_PNCP_14133')
    expect([r.objetoCompra, r.processo, r.orgaoEntidade?.razaoSocial, r.unidadeOrgao?.codigoUnidade, r.unidadeOrgao?.ufSigla]).toEqual(['Serviços de engenharia', '64047.004227/2026-18', 'COMANDO DO EXERCITO', '160157', 'MT'])
    expect(r.dataEncerramentoProposta).toBe('2026-10-30T10:00:00')
    expect(r.source).toContain('14.133')
  })

  it('normaliza o formato legado do Compras.gov', () => {
    const r = normalizarCompras({ co_processo: '12/2026', tx_objeto: 'Link', no_orgao: 'MINISTERIO X', co_uasg: 123, dt_fim_proposta: '2026-11-01', id_compra: 'abc' }, 'modulo-legado/3_consultarPregoes')
    expect([r.processo, r.objetoCompra, r.orgaoEntidade?.razaoSocial, r.unidadeOrgao?.codigoUnidade, r.dataEncerramentoProposta, r.numeroControlePNCP]).toEqual(['12/2026', 'Link', 'MINISTERIO X', '123', '2026-11-01', 'abc'])
  })

  it('reconhece fonte não ativada e cruza o registro com a oportunidade do Radar', () => {
    expect(fonteNaoAtivada(new Error('ConLicitações ainda não está configurado no ambiente seguro.'))).toBe(true)
    expect(fonteNaoAtivada(new Error('Compras.gov.br respondeu HTTP 500'))).toBe(false)
    const ops = [{ id: 7, codigo: '2026-0007', processo: '14/2026', uasg: '806030', orgao: 'SERPRO' }, { id: 8, codigo: '2026-0008', processo: '99/2026', uasg: '1', orgao: 'Outro' }] as never[]
    expect(oportunidadeDe({ processo: '14/2026' }, ops)).toBe('2026-0007')
    expect(oportunidadeDe({ processo: '500/2026', unidadeOrgao: { codigoUnidade: '806030' }, orgaoEntidade: { razaoSocial: 'SERPRO' } }, ops)).toBe('2026-0007')
    expect(oportunidadeDe({ processo: '500/2026', objetoCompra: 'link de internet' }, ops)).toBeNull()
  })

  it('monta o link oficial do PNCP com ano e sequencial na ordem correta', () => {
    expect(pncpUrl('12345678000199-1-000123/2026'))
      .toBe('https://pncp.gov.br/app/editais/12345678000199/2026/000123')
  })
})
