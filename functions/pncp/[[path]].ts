type Context = { request: Request; params: { path?: string | string[] } }

const COMPRAS_ALLOWED = new Set([
  'modulo-legado/1_consultarLicitacao',
  'modulo-legado/3_consultarPregoes',
  'modulo-contratacoes/1_consultarContratacoes_PNCP_14133',
])

/** Proxy de leitura restrito para PNCP e Compras.gov.br, evitando CORS no navegador. */
export const onRequest = async ({ request, params }: Context): Promise<Response> => {
  if (request.method !== 'GET') return new Response('Método não permitido', { status: 405, headers: { allow: 'GET' } })
  const path = [params.path].flat().filter(Boolean).join('/')
  const incoming = new URL(request.url)
  const isComprasGov = path.startsWith('comprasgov/')
  const upstreamPath = isComprasGov ? path.slice('comprasgov/'.length) : path
  const allowed = isComprasGov
    ? COMPRAS_ALLOWED.has(upstreamPath)
    : upstreamPath === 'consulta/v1/contratacoes/proposta'
  if (!allowed) return new Response('Rota de consulta não permitida', { status: 404 })
  const base = isComprasGov ? 'https://dadosabertos.compras.gov.br/' : 'https://pncp.gov.br/api/'
  const target = new URL(base + upstreamPath)
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value))
  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(isComprasGov ? 20_000 : 12_000),
    })
    const headers = new Headers()
    headers.set('content-type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
    headers.set('cache-control', 'public, max-age=60, s-maxage=60')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return Response.json(
      { error: isComprasGov ? 'Não foi possível consultar o Compras.gov.br agora.' : 'Não foi possível consultar o PNCP agora.', fonte: isComprasGov ? 'Compras.gov.br' : 'PNCP', retryable: true },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}
