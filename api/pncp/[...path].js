const COMPRAS_ALLOWED = new Set([
  'modulo-legado/1_consultarLicitacao',
  'modulo-legado/3_consultarPregoes',
  'modulo-contratacoes/1_consultarContratacoes_PNCP_14133',
])

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).send('Método não permitido')
  }

  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean)
  const path = segments.join('/')
  const isComprasGov = path.startsWith('comprasgov/')
  const upstreamPath = isComprasGov ? path.slice('comprasgov/'.length) : path
  const allowed = isComprasGov
    ? COMPRAS_ALLOWED.has(upstreamPath)
    : upstreamPath === 'consulta/v1/contratacoes/proposta'
  if (!allowed) return res.status(404).send('Rota de consulta não permitida')

  const base = isComprasGov ? 'https://dadosabertos.compras.gov.br/' : 'https://pncp.gov.br/api/'
  const target = new URL(base + upstreamPath)
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path' || value === undefined) continue
    for (const entry of Array.isArray(value) ? value : [value]) target.searchParams.append(key, String(entry))
  }
  try {
    const upstream = await fetch(target, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(isComprasGov ? 20000 : 12000),
    })
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60')
    const body = await upstream.text()
    return res.status(upstream.status).send(body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(502).json({
      error: isComprasGov ? 'Não foi possível consultar o Compras.gov.br agora.' : 'Não foi possível consultar o PNCP agora.',
      fonte: isComprasGov ? 'Compras.gov.br' : 'PNCP',
      retryable: true,
    })
  }
}
