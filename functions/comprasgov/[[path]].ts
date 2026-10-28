type Context = { request: Request; params: { path?: string | string[] } }

const ALLOWED = new Set([
  'modulo-legado/1_consultarLicitacao',
  'modulo-legado/3_consultarPregoes',
  'modulo-contratacoes/1_consultarContratacoes_PNCP_14133',
])

/** Proxy de leitura restrito à API oficial de Dados Abertos do Compras.gov.br. */
export const onRequest = async ({ request, params }: Context): Promise<Response> => {
  if (request.method !== 'GET') {
    return new Response('Método não permitido', { status: 405, headers: { allow: 'GET' } })
  }

  const path = [params.path].flat().filter(Boolean).join('/')
  if (!ALLOWED.has(path)) {
    return new Response('Rota Compras.gov.br não permitida', { status: 404 })
  }

  const incoming = new URL(request.url)
  const target = new URL('https://dadosabertos.compras.gov.br/' + path)
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value))

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const headers = new Headers()
    headers.set('content-type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
    headers.set('cache-control', 'public, max-age=60, s-maxage=60')
    headers.set('x-radar-source', 'compras-gov-dados-abertos')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return Response.json(
      { error: 'Não foi possível consultar a API de Dados Abertos do Compras.gov.br.', fonte: 'Compras.gov.br', retryable: true },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}
