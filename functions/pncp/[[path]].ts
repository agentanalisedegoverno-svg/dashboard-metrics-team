type Context = { request: Request; params: { path?: string | string[] } }

/**
 * Proxy restrito de leitura para a API pública do PNCP.
 * Usa a mesma origem do Radar para evitar falhas de CORS no navegador.
 * Não consulta nem altera o banco de dados do Radar.
 */
export const onRequest = async ({ request, params }: Context): Promise<Response> => {
  if (request.method !== 'GET') {
    return new Response('Método não permitido', { status: 405, headers: { allow: 'GET' } })
  }

  const path = [params.path].flat().filter(Boolean).join('/')
  // Expor somente a rota pública que este módulo utiliza; não criar proxy aberto.
  if (path !== 'consulta/v1/contratacoes/proposta') {
    return new Response('Rota PNCP não permitida', { status: 404 })
  }

  const incoming = new URL(request.url)
  const target = new URL('https://pncp.gov.br/api/' + path)
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value))

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    const headers = new Headers()
    headers.set('content-type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
    headers.set('cache-control', 'public, max-age=60, s-maxage=60')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return Response.json(
      { error: 'Não foi possível consultar o PNCP agora.', fonte: 'PNCP', retryable: true },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}
